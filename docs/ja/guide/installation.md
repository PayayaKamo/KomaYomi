# インストールと起動

KomaYomi は、**ローカルの Node サーバーが支えるブラウザアプリ**としても、**Electron のデスクトップウィンドウ**としても動作します。どちらも同じサーバーコードと同じデータディレクトリを使います。

## 要件

- **Node.js 20 以上**（サーバーバンドルの対象は Node 20 で、リポジトリは Node 22+ で開発されています）。
- npm（Node に同梱）。
- 任意: Electron の依存関係は `npm install` の一部としてインストールされます。

ホストされたサービスもアカウントもありません。アプリは `127.0.0.1` でのみ待ち受けます。

## インストール

リポジトリのルートで:

```bash
npm install
```

## 開発モードで起動

```bash
npm run dev
```

`http://127.0.0.1:5173` で Vite が起動します（5173 が使用中ならポートが変わります）。API は Vite のミドルウェアプラグインが提供するため、2つ目のプロセスを起動する必要はありません。

## デスクトップアプリとして起動

```bash
npm run desktop
```

このコマンドは3つのことを行います:

1. `npm run build` — 型チェックを行い、フロントエンドを `dist/` にビルドします。
2. `npm run server:build` — esbuild でサーバーを `dist-server/app.mjs` にバンドルします。
3. `electron .` — ローカル HTTP サーバーからバンドル済みの静的ファイルを読み込むウィンドウを開きます。

デスクトップのデータディレクトリ:

- ソースから実行する場合（`npm run desktop`）、リポジトリのフォルダを使い、`raw/`、`data/`、`exports/` をコードの隣に保ちます。
- パッケージ済みビルドでは、Electron の `userData` ディレクトリ内の `library` フォルダが既定となり、初回起動時にフォルダの選択を求めます。
- `Ctrl+Shift+D` でデータディレクトリを切り替えます（再起動が必要です）。
- 環境変数 `MANGA_DATA_DIR` はデータディレクトリを上書きします。
- `MANGA_PORT` は内部ポートを固定します。指定しない場合は空きポートが選ばれます。

<Badge type="warning" text="予定" /> 配布可能なインストーラー（`.exe` / `.dmg`）はまだ設定されていません。`electron-builder` は開発依存関係として存在しますが、リポジトリに `build` 設定やパッケージングスクリプトはありません。

## ビルド成果物

| コマンド | 出力 | 用途 |
| --- | --- | --- |
| `npm run build` | `dist/` | 静的フロントエンド。 |
| `npm run server:build` | `dist-server/app.mjs` | Electron が使うバンドル済み Node サーバー。 |
| `npm run preview` | — | ビルド済みフロントエンドを Vite preview で配信します。API ミドルウェアは開発サーバーの機能なので、API にアクセスするにはデスクトップアプリか `npm run dev` を使ってください。 |
| `npm run typecheck` | — | TypeScript のプロジェクトチェック。 |

## データディレクトリの構成

```text
raw/                       # your images (gitignored)
  <volume>/<language>/<chapter>/01.jpg
data/
  pages/<volume>/<chapter>/0.json     # one page JSON, 0-based index
  templates/                          # panel templates and export templates
  presets/                            # alignment presets
  layouts/*.json                      # declarative layout templates
  library.json                        # manual language-directory mapping
  cache/thumbs/                       # thumbnail cache (safe to delete)
  backups/                            # project import backups (gitignored)
exports/                   # generated HTML, PNG, backups, .mnproj (gitignored)
```

`npm run dev` は画像を `/raw/...`、生成ファイルを `/exports/...` 経由で配信します。どちらのフォルダも静的ディレクトリ一覧としては公開されません。

## ポートとホスト

- 開発 UI: `127.0.0.1:5173`。
- ドキュメントサイト（このサイト）: `docs/` から起動した場合 `127.0.0.1:5174`。
- Electron ウィンドウは一時的な localhost ポートと通信します。

## 初回起動

1. `raw/<volume>/<ja|zh|en>/<chapter>/<pages>` に従って、少なくとも1巻を `raw/` に置きます。
2. アプリを開きます。サイドバーに巻と話が一覧表示されます。
3. ページを選択します。初回に開くとページが自動検出され、保存されます。
4. 言語フォルダが認識されない場合は、巻の設定を開いてディレクトリを手動で対応付けてください。

命名規則とスキャナーが受け付ける言語の別名は [ライブラリ](/ja/guide/gallery) を参照してください。

## ドキュメントサイト

ドキュメントは `docs/` にあり、独自の依存関係を持ちます:

```bash
cd docs
npm install
npm run docs:dev     # http://127.0.0.1:5174
npm run docs:build   # static output in docs/.vitepress/dist
npm run docs:preview # preview the production build
```

リポジトリのルートからは `npm --prefix docs run docs:dev` も使えます。
