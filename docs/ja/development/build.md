# ビルドとパッケージング

同じコードから四つの形を作れます。ローカルサーバー付きのブラウザー版、単体サーバー、Electron デスクトップ版、そして別リポジトリの静的オンライン版です。ここではコマンドと、コードを変えるときに実際に効いてくる違いをまとめます。

## 必要なもの

- Node.js 22 以上と npm。
- バッチ CLI は Node の TypeScript 対応に依存します。Node 22.6–23.5 では `--experimental-strip-types` が必要、Node 23.6 以降は既定で有効、Node 26 なら `.ts` の入口をそのまま実行できます。
- デスクトップのパッケージングは既定で Windows x64（`electron-builder.yml`）。サーバー自体は Node が動く環境ならどこでも動きます。

## コマンド

| コマンド | 内容 | 出力 |
| --- | --- | --- |
| `npm run dev` | Vite 開発サーバーと API ミドルウェアを `127.0.0.1:5173` で起動（使用中なら次の空きポート）。 | なし |
| `npm run build` | 型検査とフロントエンドのビルド。 | `dist/` |
| `npm run preview` | 同じ API ミドルウェアでビルド結果をプレビュー。 | — |
| `npm run server:build` | esbuild で `server/app.ts` と `server/standalone.ts` を束ねる。 | `dist-server/app.mjs`、`dist-server/standalone.mjs` |
| `npm start` | 束ねた単体サーバーを実行。 | `0.0.0.0:3921` |
| `npm run desktop` | ビルド、サーバー束ね、Electron 起動。 | ウィンドウ |
| `npm run dist:win` | NSIS インストーラーとポータブル版。 | `release/` |
| `npm run dist:dir` | 未パッケージのフォルダー。デスクトップ版の確認用。 | `release/win-unpacked/` |
| `npm run docker:up` | コンテナをビルドして起動（ローカルフォルダーをマウント）。 | `http://127.0.0.1:3921` |
| `npm run docs:dev` | ドキュメントの開発サーバー。サイトルートで配信（`DOCS_BASE=/`）。 | `127.0.0.1:5174` |
| `npm run docs:build` | ドキュメントをビルド。リンク切れがあると失敗。 | `docs/.vitepress/dist/` |

## ローカル開発

```bash:no-line-numbers
npm install
npm run dev
```

別プロセスは不要です。`server/plugin.ts` が `createMangaHandler` を Vite のミドルウェアとして `configureServer` と `configurePreviewServer` の両方に差し込みます。`/api/library` はページと同じイベントループで処理されるので、サーバー側の `console.log` は Vite を動かしているターミナルに出ます。

フロントエンドは Vite が `src/` から配信し、サーバーはリポジトリ直下の `raw/` と `data/` を読み書きします。

## 本番ビルド

```bash:no-line-numbers
npm run build
npm run server:build
npm start
```

`npm run build` は最初に `tsc -b` を走らせるので、型エラーがあればそこで止まります。`server:build` は `platform: node`、`format: esm`、`target: node20` で束ね、`pngjs` と `jpeg-js` が内部で `require` を呼ぶため `createRequire` のバナーを差し込みます。

`npm start` は `dist/` が存在する前提です。なければ `server/standalone.ts` が `CLI_MISSING_STATIC_DIR` で終了します。設定は環境変数だけです。

| 変数 | 既定値 | 用途 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 待ち受けアドレス。 |
| `PORT` | `3921` | 待ち受けポート。 |
| `RAW_DIR` | `<cwd>/raw` | 漫画画像。 |
| `DATA_DIR` | `<cwd>/data` | JSON データ。 |
| `EXPORT_DIR` | `<cwd>/exports` | 生成物。 |
| `STATIC_DIR` | `<cwd>/dist` | ビルド済みフロントエンド。 |
| `MANGA_LOCALE` | 自動 | UI 言語のヒント: `en`、`zh`、`ja`。 |
| `LOG_LEVEL` | `info` | `debug`、`info`、`warn`、`error`。 |

## デスクトップ

```bash:no-line-numbers
npm run desktop
npm run dist:win
```

`electron/main.cjs` が `dist-server/app.mjs` を同一プロセスで読み込み、`dist/` を配信してウィンドウを開きます。データは同梱しません。初回起動でライブラリのフォルダーを尋ね、`%APPDATA%/manga-memo/config.json` に記憶します。`raw/`、`data/`、`exports/` は自分の場所に残ります。

パッケージ設定は `electron-builder.yml` です。同梱するのは `dist/`、`dist-server/`、`electron/`、`package.json` だけで、束ねたサーバーが依存を含むため `node_modules` は入れません。

## Docker

```bash:no-line-numbers
docker compose up --build
```

コンテナは `dist-server/standalone.mjs` を実行し、ホストの `raw/`、`data/`、`exports/` をマウントします。ローカルマシン向けで、アカウントも認証もありません。ポートを外部へ公開しないでください。

## 静的オンライン版

静的オンライン版は別プロジェクトです: `https://github.com/PayayaKamo/KomaYomi-online`。ブラウザーだけで動く部分集合から作られています。ページ形式とプロジェクトファイルの読み込みは共有しますが、フォルダー走査、コマ検出、プラグイン、WebDAV はサーバープロセスが必要なため使えません。保存内容は IndexedDB に入ります。

機能を足すときは、どちらの形に属するかを最初に決めます。

| 変更 | ローカルサーバー版 | 静的オンライン版 |
| --- | --- | --- |
| ページ文書へのフィールド追加 | `shared/` とサーバーの正規化を変更。 | `shared/` にあれば動く。 |
| 検出器やプラグインのフック追加 | `server/detect.ts`、`server/plugins.ts`。 | 利用不可。 |
| ダイアログやビューの追加 | `src/components/`。 | 既存 API だけなら移植しやすい。 |
| ファイルシステム、プロセス、ネットワーク | サーバーのみ。 | 利用不可。 |

## 検出ベースラインの更新

```bash:no-line-numbers
node scripts/manga-cli.ts regress
node scripts/manga-cli.ts regress --update
```

1 つ目は現在のコマ数と `scripts/detect-baseline.json` を比べ、`--update` はベースラインを書き換えます。コミット前に差分を確認してください。ベースラインの更新は「新しい数が正しい」と約束する行為です。

## プルリクエストの前

```bash:no-line-numbers
npm run lint
npm run typecheck
npm test
npm run i18n:scan
npm run docs:build
```

`i18n:scan` は既定で非厳格、CI は `src/` に増えた中国語の直書きを失敗として扱います。`docs:build` はリンク切れで失敗するので、三言語のページ名変更の漏れを見つける一番安い方法です。
