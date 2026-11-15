# カスタマイズ開発

このセクションは、KomaYomi を使うだけでなく中身を変えたい人向けです。特定の雑誌に合わせたコマ検出プラグインを足す、フォルダー判定を調整する、書き出しレイアウトを配布する、アプリ本体を改造する——どれもここから始められます。記載したプロトコルとフィールドはすべてソースと突き合わせています。食い違いを見つけたら、コードのほうが正しいと考えてください。

漫画を読んでノートを取るだけなら、[ガイド](/ja/guide/introduction) から読むのが早いです。

## このセクションの構成

| ページ | 答えること |
| --- | --- |
| このページ | フロントエンド、サーバー、共有層の役割と、ローカル版だけが持つ機能。 |
| [データ形式](/ja/development/data-formats) | JSON エンベロープ、ページ文書、`library.json`、`.mnproj`、`.mntpl`、`.mnexp`、移行と未知フィールドの扱い。 |
| [コマ分割プラグイン](/ja/development/plugins) | プラグインの実際の契約、そのまま動く例、試し方、エラーコード。 |
| [フォルダー判定ルール](/ja/development/folder-rules) | プレースホルダー、省略可能な階層、ワイルドカード、`ignore`、`extensions`、よくある構成の完全な例。 |
| [エクスポートテンプレート](/ja/development/export-templates) | 保存できるフィールド、完全な `.mnexp`、適用方法。 |
| [ビルドとパッケージング](/ja/development/build) | 開発サーバー、本番ビルド、単体サーバー、Electron、Docker、静的オンライン版の違い。 |
| [コントリビュート](/ja/development/contributing) | ブランチとコミット規約、検査コマンド、最小の機能追加例。 |

## リポジトリの構成

| パス | 役割 |
| --- | --- |
| `src/` | React 18 のフロントエンド。ライブラリのサイドバー、コマ調整ワークベンチ、比較リーディング、ノート、エクスポートダイアログ、各種ダイアログ、多言語文言。 |
| `server/` | Node の HTTP API とローカル機能一式。ライブラリ走査、コマ検出、レイアウトテンプレート、プラグイン、位置合わせプリセット、エクスポート、バックアップ、保存、履歴。 |
| `shared/` | フロントとサーバーの共有部分。ドメイン型、JSON エンベロープと移行、コマ順序、Markdown 描画。 |
| `electron/` | Electron メインプロセスとデータフォルダーの処理。 |
| `scripts/` | バッチ CLI（`manga-cli.ts`）、サーバーバンドル、i18n スキャン、検出ベースライン。 |
| `plugins/` | 任意のコマ分割プラグイン。`data/plugins/` に置いてもかまいません。 |
| `docs/` | この VitePress サイト。独自の `package.json` を持ちます。 |
| `raw/`、`data/`、`exports/` | 画像、JSON、生成物。いずれもコミットしません。 |

## 三つの層

### フロントエンド `src/`

Vite でビルドする React のシングルページアプリです。`src/App.tsx` が全体の枠（上部バー、サイドバー、ステージ、ノート列、分割バー）を持ち、機能ごとの部品は `src/components/` にあります。バックエンドと話すのは `src/api.ts` だけで、すべて相対パス `/api/...` への `fetch` です。そのためフロントエンドは、Vite で動いているのか、単体サーバーなのか、Electron なのかを知りません。

ライブラリ、現在のページ文書、保存済みテンプレートといったサーバー側の状態は `src/api.ts` で読み、明示的に書き戻します。通常利用でブラウザー内のデータベースは使いません。

### サーバー `server/`

ルーティング関数は一つだけです。`server/app.ts` の `createMangaHandler({ rootDir })` が `pathname` と `method` を見て各モジュールへ渡します。同じハンドラーが三つのホストで動きます。

| ホスト | 入口 | アクセス方法 |
| --- | --- | --- |
| 開発・プレビュー | `server/plugin.ts` | Vite のミドルウェアとして `127.0.0.1:5173` に同居。別プロセスは不要。 |
| 単体サーバー / Docker | `server/standalone.ts` | `npm start`、ポート `3921`。`RAW_DIR`、`DATA_DIR`、`EXPORT_DIR` で場所を変更。 |
| デスクトップ | `dist-server/app.mjs` | `scripts/build-server.mjs` が束ね、`electron/main.cjs` が読み込む。 |

モジュールは意図的に狭く切っています。`library.ts` は走査とページのまとめ、`dirRules.ts` はパスパターンからページ記録、`detect.ts` は XY-cut 検出、`plugins.ts` はプラグイン実行、`layouts.ts` は宣言的グリッドの展開、`storage.ts` はページの読み書き、`schemaStore.ts` は移行と原子的な書き込み、`export.ts` と `exportDocx.ts` は文書生成、`project.ts` と `backup.ts` はプロジェクトと ZIP を担当します。

### 共有層 `shared/`

`shared/` は Node 専用 API にも DOM にも依存できません。依存すると、どちらか一方の環境で使えなくなります。

| ファイル | 内容 |
| --- | --- |
| `types.ts` | `PageDoc`、`Panel`、`Note`、`Annotation`、読み方向、エクスポート設定、ライブラリ型。 |
| `format.ts` | `$schema` / `schemaVersion` エンベロープ、形式ごとの検証、移行の振り分け、`preserveUnknown`。 |
| `migrations.ts` | 純粋な v0 → v1 移行。ディスクには触れません。 |
| `panelOrder.ts` | 表示・エクスポート・CLI が共有する読み順とグループ順。 |
| `markdown.ts` | Markdown 描画。生の HTML はエスケープします。 |
| `schemas/*.json` | 読むための JSON Schema ミラー。実行時の正はコード側の検証器です。 |

## リクエストの流れ

**ライブラリを読む。** サイドバーが `GET /api/library` を呼びます。`server/app.ts` が受け取り、`server/library.ts` が `data/library.json` を読み、`server/dirRules.ts` でルールを解釈し、`raw/`（またはマップされたリモート先）をたどって 巻 → 章 → ページ にまとめて JSON を返します。書き込みはありません。

**ページを保存する。** ワークベンチがページ文書全体を `PUT /api/page` で送ります。`server/app.ts` が基本構造を確認したあと、`server/storage.ts` の `writePageDoc` が次の順で処理します。

1. 新しいスキーマで書かれたファイルは拒否（`409`、`ERR_SCHEMA_TOO_NEW`）。
2. 矩形、ノート、オフセット、id を正規化。
3. `preserveUnknown` で前の版の未知フィールドを統合。
4. `server/schemaStore.ts` 経由で原子的に書き込み。
5. 呼び出し側が不要と言わない限り、版のスナップショットを記録。

**コマを検出する。** `POST /api/detect` は、そのページ・章・巻に紐づくレイアウトテンプレート、一致する最初のプラグイン、内蔵検出器の順に試します。結果は `detectSource` と `detectorVersion` と一緒に保存されるので、あとからどの矩形が誰のものか分かります。

## ローカル版だけの機能

デスクトップ版とローカルサーバー版はファイルとプロセスに触れます。そのため次の機能は静的オンライン版にはありません。

| 機能 | ローカル Web / デスクトップ | 静的オンライン版 |
| --- | --- | --- |
| `raw/` のフォルダー走査 | あり | なし。ブラウザーはフォルダーツリーをたどれません。 |
| 自動コマ検出 | あり | 未移植。 |
| レイアウトテンプレートとプラグイン | あり | なし。どちらもサーバープロセスで動きます。 |
| WebDAV / ネットワーク保存と画像キャッシュ | あり | なし。 |
| バックアップ ZIP、プロジェクト入出力 | あり | プロジェクトは開けますが、フォルダーのバックアップはありません。 |
| データの保存先 | 画像の隣の `data/` | ブラウザーの IndexedDB |

静的オンライン版は別リポジトリで、まだ開発中です: `https://github.com/PayayaKamo/KomaYomi-online`。このリポジトリが作るのはローカル版だけです。共有範囲は[ビルドとパッケージング](/ja/development/build#静的オンライン版)にまとめました。

## 知っておくとよい約束事

- サーバーは純粋な ESM TypeScript で、開発時は Node の型ストリップが直接実行します。import には `.ts` 拡張子が必要です。
- データベースはありません。保存されるのはすべて JSON ファイルで、書き込みは原子的です。
- 利用者向けのメッセージは `server/messages/catalog.ts`、画面の文言は `src/i18n/` にあります。コンポーネントに中国語を直書きすると `npm run i18n:scan` が指摘します。
- ドキュメントは三言語で同構成です。ページを足すときは `docs/<page>.md`、`docs/zh/<page>.md`、`docs/ja/<page>.md` をそろえ、`docs/.vitepress/config.mts` のナビとサイドバーにも追加します。

## どこから読むか

- ディスク上のページの見つけ方を変える: [フォルダー判定ルール](/ja/development/folder-rules)。
- 特定の雑誌だけ検出方法を変える: [コマ分割プラグイン](/ja/development/plugins)。
- KomaYomi のデータを読み書きするツールを作る: [データ形式](/ja/development/data-formats)。
- アプリ本体を変える: [コントリビュート](/ja/development/contributing)。
