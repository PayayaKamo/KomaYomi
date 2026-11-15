# サーバーと CLI のメッセージコード

KomaYomi は、`server/` と `scripts/` が出すユーザー向けの文言を 1 つの三言語カタログ（`server/messages/catalog.ts`）にまとめています。ドメイン側のコードは**安定したコードとパラメーター**だけを投げ、テキストは境界で、リクエスト（HTTP）または実行（CLI）ごとに交渉された言語で生成されます。

`ERR_*` / `WARN_*` / `STATUS_*` は公開 API です。クライアントやスクリプトが照合する可能性があるため、コード名の変更は破壊的変更になります。追加は破壊的ではありません。

- カタログ：`server/messages/catalog.ts`
- 言語の交渉：`server/messages/index.ts`
- エラー型：`server/errors.ts`

## HTTP レスポンスの約束

エラー応答はすべて従来の `error` 文字列（現在のクライアントが読んでいるもの）を残し、構造化フィールドを追加します。

```json
{
  "error": "ページが見つかりません：点兔第14卷 / 172 99 ページ",
  "message": "ページが見つかりません：点兔第14卷 / 172 99 ページ",
  "code": "ERR_PAGE_NOT_FOUND",
  "params": { "volume": "点兔第14卷", "chapter": "172", "page": 99 },
  "lang": "ja"
}
```

| フィールド | 意味                                                       |
| ---------- | ---------------------------------------------------------- |
| `error`    | ローカライズされたテキスト（後方互換のため残しています）。 |
| `message`  | `error` と同じテキスト。新しい契約向けのクライアント用。   |
| `code`     | 本書に載っている安定した機械可読コード。                   |
| `params`   | テキストに埋め込む値。翻訳はしません。                     |
| `lang`     | `error` / `message` に実際に使われた言語。                 |

`sendJson` は `Content-Language: <lang>` と `Vary: Accept-Language` も設定します。

成功レスポンスに含まれる警告は `string[]` のまま（そのリクエストの言語でローカライズ）なので、既存の UI コードはそのまま動きます。`POST /api/detect` はさらに、自分で生成した警告について `warningCodes: [{ "code": "WARN_…", "params": { … } }]` を返します。

### 言語の交渉

優先度は高い順に：

1. `?lang=ja` クエリパラメーター（`en` / `zh` / `ja`。`ja-JP` のような地域タグも可）。
2. `Accept-Language` ヘッダー。q 値を考慮します（`ja;q=0.9, en;q=0.4`）。
3. 環境変数：`KOMAYOMI_LANG`、次に `MANGA_LOCALE`、最後に `LC_ALL` / `LANG`。
4. 英語。

```bash
curl -s 'http://127.0.0.1:5173/api/page?volume=V&chapter=1&index=999' \
  -H 'Accept-Language: ja-JP,ja;q=0.9'
# → {"error":"ページが見つかりません：V / 1 999 ページ","code":"ERR_PAGE_NOT_FOUND",…}
```

## CLI

`scripts/manga-cli.ts` も同じカタログを描画します。

```bash
node scripts/manga-cli.ts report --lang ja
KOMAYOMI_LANG=zh node scripts/manga-cli.ts layouts
LANG=ja_JP.UTF-8 node scripts/manga-cli.ts report
```

- `--lang en|zh|ja` が優先。地域タグは正規化されます（`zh-CN`、`ja_JP`）。
- 指定がない場合、CLI は `KOMAYOMI_LANG` → `MANGA_LOCALE` → `LC_ALL`/`LANG` の順に従い、最後は英語になります。
- `--content-lang ja` はどの言語の画像を読むかを選びます（以前は役割が重複していた `--lang` が担っていました）。`--image-lang` も別名として使えます。
- エラーは stderr に `Error: <ローカライズされたメッセージ>` と出て、終了コード 1 になります。

## エラーコード

### リクエスト・ルーティング・ファイル

| コード                      | HTTP | 意味                                 | よくある原因                                 | 対処                                         |
| --------------------------- | ---- | ------------------------------------ | -------------------------------------------- | -------------------------------------------- |
| `ERR_INTERNAL`              | 500  | サーバー内部エラー：{detail}         | バグ、データディレクトリが読めない、未捕捉の例外 | `detail` とサーバーログを確認します。     |
| `ERR_INVALID_JSON`          | 400  | リクエスト本文が有効な JSON ではありません：{detail} | ファイルを手で編集した、`Content-Type` が違う | JSON を送る。アップロード前に検証する。 |
| `ERR_BODY_TOO_LARGE`        | 413  | リクエストボディが大きすぎます（上限 {limit} MB） | 非常に大きな `.mnproj` を取り込んだ | ディスクへストリームするファイル用エンドポイントで取り込む。 |
| `ERR_UNTRUSTED_HOST`        | 403  | 信頼できないホストです：{host}       | DNS リバインディング、明示しない外部公開 | `127.0.0.1`/`localhost` でアクセスする。LAN 公開は明示的に有効化する。 |
| `ERR_UNTRUSTED_ORIGIN`      | 403  | クロスサイトの書き込みをブロックしました：{origin} | 別サイトからローカル API へのリクエスト | アプリ自身のオリジンだけを許可し、第三者ページに埋め込まない。 |
| `ERR_UNSUPPORTED_CONTENT_TYPE` | 415 | 未対応の Content-Type です：{type} | `text/plain` やフォーム送信            | `Content-Type: application/json` を送る。   |
| `ERR_UNKNOWN_ENDPOINT`      | 404  | 不明な API エンドポイント：{path}    | 古いクライアント、打ち間違い、base URL の誤り | このリポジトリの `server/app.ts` でパスを確認する。 |
| `ERR_FILE_NOT_FOUND`        | 404  | ファイルが見つかりません：{path}     | ファイルが移動・削除された                   | もう一度エクスポートする。                   |
| `ERR_EXPORT_FILE_NOT_FOUND` | 404  | エクスポートファイルが見つかりません：{path} | エクスポート先が空になった           | その話をもう一度エクスポートする。           |

### 画像とサムネイル

| コード                        | HTTP | 意味                                                   | よくある原因                     | 対処                                     |
| ----------------------------- | ---- | ------------------------------------------------------ | -------------------------------- | ---------------------------------------- |
| `ERR_IMAGE_NOT_FOUND`         | 404  | 画像が見つかりません：{path}                           | `raw/` の構成が違う、名前を変えた | `raw/<巻>/<言語>/<話>/` を確認する。     |
| `ERR_THUMB_SOURCE_MISSING`    | 404  | サムネイルの元画像が見つかりません：{src}              | ライブラリ表示後にページ画像が消えた | ライブラリを再読み込みする。         |
| `ERR_THUMB_FETCH_FAILED`      | 502  | サムネイルの取得に失敗しました：{detail}               | リモート元がオフライン、URL の誤り | 「設定 → ストレージ」でリモート元を確認する。 |
| `ERR_THUMB_UNSUPPORTED`       | 415  | この画像形式のサムネイルはまだ作成できません           | AVIF/HEIC など特殊な形式         | JPEG/PNG/WEBP に変換する。               |
| `ERR_UNSUPPORTED_IMAGE_FORMAT`| 415  | 未対応の画像形式です（{format} / {ext}）               | 画像でないファイル、未対応コーデック | 対応形式の画像に差し替える。         |
| `ERR_REMOTE_UNAVAILABLE`      | 503  | リモート素材が一時的に利用できません（{detail}）。キャッシュ済みのページは閲覧できます | ネットワーク共有がオフライン、WebDAV 停止 | キャッシュ済みページは読める。オンラインに戻って再試行する。 |

### ライブラリ・ページ・巻

| コード                        | HTTP | 意味                                                       | よくある原因                       | 対処                                                |
| ----------------------------- | ---- | ---------------------------------------------------------- | ---------------------------------- | --------------------------------------------------- |
| `ERR_VOLUME_NOT_FOUND`        | 404  | 巻が見つかりません：{volume}                               | フォルダ名の変更、URL の期限切れ   | ライブラリを更新し、巻 id を確認する。              |
| `ERR_CHAPTER_NOT_FOUND`       | 404  | 話が見つかりません：{volume} / {chapter}                   | 話番号の誤り、空の巻               | `/api/library` の `chapters` を確認する。           |
| `ERR_PAGE_NOT_FOUND`          | 404  | ページが見つかりません：{volume} / {chapter} {page} ページ | 番号は 0 始まり、ページ一覧が古い  | ライブラリが返す `page.index` を使う。              |
| `ERR_PAGE_CORRUPT`            | 422  | ページの保存データが破損しています                         | 書き込み中断、JSON の手編集        | ページは読み取り専用になります。バックアップから復元するか、ファイルを削除してください。次回書き込み時に `.corrupt.bak` を残します。 |
| `ERR_HISTORY_CORRUPT`         | 422  | 版履歴が破損しています                                     | 書き込み中断、JSON の手編集        | バックアップから履歴を復元してください。ページ自体は開けます。次回保存時に `.corrupt.bak` を残します。 |
| `ERR_LIBRARY_CONFIG_CORRUPT`  | 500  | `library.json` を解析できません                            | 書き込み中断、JSON の手編集        | 設定を変更する前にバックアップから復元してください。自動リセットはされません。 |
| `ERR_MISSING_VOLUME_CHAPTER`  | 400  | 巻と話の指定が不足しています                               | クライアントの送信漏れ             | `volume` と `chapter` の両方を送る。                |
| `ERR_MISSING_VOLUME`          | 400  | 巻名が指定されていません                                   | 対象なしの破壊的操作               | `volume` を渡す。                                   |
| `ERR_MISSING_VOLUME_DIRS`     | 400  | 巻名または言語ディレクトリ設定が不足しています             | ディレクトリなしで巻を作成         | `{ volume, dirs }` を送る。                         |
| `ERR_UNKNOWN_DIRECTION`       | 400  | 未対応の読む方向です                                       | 削除された値、または打ち間違い     | 画面に残っている 7 つの読み方向のいずれかを使う。   |
| `ERR_PREPROCESS_NO_BACKUP`    | 404  | 復元できる前回の前処理結果がありません                     | 前処理が未実行、または復元済み     | 先に前処理を実行してから復元する。                  |
| `ERR_URL_NOT_HTTP`            | 400  | http(s) のリンクのみ対応しています                         | `file://` や相対 URL              | `http(s)` の URL にする。                           |
| `ERR_PAGE_NO_IMAGES`          | 400  | このページにはどの言語の画像もありません                   | 話フォルダが空、命名の不一致       | そのページ番号のファイルを確認する。                |
| `ERR_PAGE_NO_PANELS`          | 400  | このページにはまだ切り出せるコマがありません               | コマ分割前のページでレイアウトを取得 | 先にコマ分割してから再試行する。                  |
| `ERR_PAGE_SHAPE`              | 400  | ページ JSON はオブジェクトである必要があります             | 違うファイルを選んだ               | KomaYomi が出力した `.mnpage.json` を取り込む。     |
| `ERR_PAGE_TARGET_MISSING`     | 400  | ページ JSON に巻 / 話がなく、読み込み先も指定されていません | 対象を選ばずに取り込み           | 先に巻 / 話を選んでから取り込む。                   |
| `ERR_PAGE_INDEX_INVALID`      | 400  | ページ JSON に有効な pageIndex（0 始まり）がありません     | 手で編集したファイル               | 0 始まりの `pageIndex` を追加する。                 |
| `ERR_PAGE_NOT_SAVED`          | 400  | このページには保存された注釈がまだありません。先に保存してから書き出してください | 保存せずに書き出した | 先にページを保存する。                              |
| `ERR_UNSAFE_SEGMENT`          | 400  | 巻名または話番号に安全でない文字が含まれています           | `/`、`..`、制御文字                | フォルダ名に使える普通の名前にする。                |
| `ERR_DIR_UNSAFE`              | 400  | ディレクトリ名に .. は使用できません                       | ルール入力の不備                   | `..` を含まない相対パスにする。                     |
| `ERR_DIR_NAME_EMPTY`          | 400  | ディレクトリ名を入力してください                           | 空のまま送信                       | 名前を入力する。                                    |
| `ERR_DIR_NAME_INVALID`        | 400  | ディレクトリ名「{name}」に使用できない文字が含まれています（\\ / : * ? " < > \| は不可） | Windows のパスを貼り付けた | 使用できない文字を削る。               |
| `ERR_DIR_NOT_FOUND`           | 400  | ディレクトリが見つかりません：{path}                       | 選択後にフォルダが移動した         | フォルダを選び直す。                                |
| `ERR_DIR_NOT_IN_VOLUME`       | 400  | 「{dir}」は {volume} のサブディレクトリではありません      | ディレクトリ一覧が古い             | 巻の設定を再読み込みする。                          |
| `ERR_VOLUME_EXISTS`           | 409  | raw/ に同名のディレクトリ「{name}」が既にあります。別の名前を指定するか、先に削除してください | 同じ元を二重に追加 | 古い項目を消すか、別名にする。                      |
| `ERR_LINK_CREATE_FAILED`      | 500  | ディレクトリリンクの作成に失敗しました：{detail}           | 権限不足、リンク非対応のファイルシステム | リンク対応のファイルシステムを使うか、ファイルをコピーする。 |
| `ERR_REAL_DIRECTORY`          | 409  | これは実ディレクトリです。画像を誤って消さないよう raw/ で手動削除してください | 巻フォルダがリンクではない | 本当に消すなら `raw/` で手動削除する。              |
| `ERR_HISTORY_VERSION_NOT_FOUND`| 404 | そのページ版は存在しません（保持件数により削除された可能性があります） | 履歴が整理された、リンクが古い | ページ履歴を更新する。残したいならもう一度保存する。 |

### テンプレートとプリセット

| コード                              | HTTP | 意味                                                     | よくある原因                 | 対処                                        |
| ----------------------------------- | ---- | -------------------------------------------------------- | ---------------------------- | ------------------------------------------- |
| `ERR_PANEL_TEMPLATE_EMPTY`          | 400  | テンプレートにコマがありません                           | 空のページから取得           | コマ分割してからテンプレートを保存する。    |
| `ERR_LAYOUT_NOT_FOUND`              | 404  | レイアウトテンプレートが見つかりません：{layoutId}       | 名前変更・削除               | `/api/layouts` を再取得する。               |
| `ERR_LAYOUT_SAVE_INVALID`           | 400  | レイアウトテンプレートに grid.rows がないため保存できません | 手で編集した JSON         | `grid.rows` / `grid.cols` を残す。          |
| `ERR_ALIGN_PRESET_MISSING_FIELDS`   | 400  | 整列プリセットに名前・巻・話が必要です                   | フォームの一部だけ送信       | `name`、`volume`、`chapter` を送る。        |
| `ERR_ALIGN_PRESET_NOT_FOUND`        | 404  | 整列プリセットが見つかりません：{presetId}               | プリセットが削除された       | `/api/align-presets` を再取得する。         |
| `ERR_EXPORT_TEMPLATE_NOT_FOUND`     | 404  | エクスポートテンプレートが見つかりません：{templateId}   | 削除済み、id の誤り          | `/api/export-templates` を再取得する。      |

### インポート / エクスポートファイル

| コード                              | HTTP | 意味                                                     | よくある原因               | 対処                                                     |
| ----------------------------------- | ---- | -------------------------------------------------------- | -------------------------- | -------------------------------------------------------- |
| `ERR_EXCHANGE_EMPTY_FILE`           | 400  | {label}ファイルの内容を受信できませんでした              | ファイル入力が空           | 空でないファイルを選ぶ。                                 |
| `ERR_EXCHANGE_INVALID_JSON`         | 400  | {label}が有効な JSON ではありません。別のファイルを選んだ可能性があります | ファイルの選択ミス | `.mntpl` / `.mnexp` / `.mnpage.json` を選ぶ。             |
| `ERR_EXCHANGE_VALIDATION`           | 400  | {label}の形式が正しくありません：{errors}                | 古い形式、手編集           | 示されたフィールドを直すか、再エクスポートする。         |
| `ERR_EXCHANGE_VOLUME_REQUIRED`      | 400  | 先に紐付ける巻を選択してください                         | 巻を選ばずテンプレートを適用 | 先に巻を選ぶ。                                         |
| `ERR_EXCHANGE_CHAPTER_REQUIRED`     | 400  | 話 / ページに紐付けるには有効な話番号が必要です          | `scope=chapter/page` なのに chapter なし | `chapter` を渡す。                            |
| `ERR_EXCHANGE_PAGE_INDEX_REQUIRED`  | 400  | 単一ページに紐付けるには 0 始まりのページ番号が必要です  | `scope=page` なのに `pageIndex` なし | `pageIndex` を渡す。                             |
| `ERR_EXPORT_TEMPLATE_SHAPE`         | 400  | エクスポートテンプレートは JSON オブジェクト（または data/templates/export.json の配列）である必要があります | JSON の形が違う | オブジェクト（または配列）にする。             |
| `ERR_EXPORT_EMPTY`                  | 400  | 書き出せるページがありません（先にコマ分割かノートを追加してください） | 範囲内にコマもノートもない | コマやノートを足すか、ページ範囲を広げる。               |
| `ERR_PROJECT_EMPTY`                 | 400  | プロジェクトファイルの内容を受信できませんでした         | `.mnproj` が空             | プロジェクトを再エクスポートする。                       |
| `ERR_PROJECT_IMAGE_ENTRY`           | 400  | プロジェクトファイル内の画像項目に巻 / 話 / ファイル名がありません | manifest の破損    | プロジェクトを再エクスポートする。                       |
| `ERR_MANIFEST_INVALID_JSON`         | 400  | manifest.json が有効な JSON ではありません。.mnproj プロジェクトファイルではない可能性があります | `.mnproj` でない、または破損 | アーカイブの中身を確認する。               |
| `ERR_MANIFEST_NOT_OBJECT`           | 400  | manifest.json の構造が正しくありません（JSON オブジェクトが必要です） | manifest の破損 | プロジェクトを再エクスポートする。                     |
| `ERR_MANIFEST_NO_INVENTORY`         | 400  | プロジェクトファイルに inventory（巻・話の一覧）がありません | 古すぎる、または破損した書き出し | 現行バージョンで再エクスポートする。               |
| `ERR_MANIFEST_INCOMPLETE`           | 400  | プロジェクト manifest のデータが不完全です：{errors}    | 必須フィールドの欠落       | 示されたパスを直すか、再エクスポートする。               |
| `ERR_MANIFEST_MISSING`              | 400  | アーカイブに manifest.json がありません。.mnproj プロジェクトファイルではない可能性があります | `.mnproj` でない | 正しいアーカイブを選ぶ。                   |
| `ERR_LIBRARY_NOT_OBJECT`            | 400  | library.json が JSON オブジェクトではありません         | 設定の手編集               | 有効な設定を戻すか、空のライブラリから始める。           |
| `ERR_SCHEMA_TOO_NEW`                | 409  | このファイルは新しいバージョンの KomaYomi で作成されています（schema v{found}、対応 v{supported}）。更新するまで読み取り専用です | 新しい KomaYomi を使った | アプリを更新してから書き込む。まずは読み取り専用で開ける。 |
| `ERR_SCHEMA_MIGRATION`              | 500  | {file} を schema v{from} から移行できません：{detail}   | ファイルの破損、想定外の旧版 | バックアップから戻す。`detail` とファイルを添えて報告する。 |
| `ERR_BACKUP_NOT_KOMAYOMI`           | 400  | アーカイブに data/ ディレクトリがありません。KomaYomi のバックアップではない可能性があります | KomaYomi のバックアップでない | 本アプリが作ったバックアップを選ぶ。 |

### ストレージとリモートバックアップ

| コード                         | HTTP | 意味                                   | よくある原因                   | 対処                                          |
| ------------------------------ | ---- | -------------------------------------- | ------------------------------ | --------------------------------------------- |
| `ERR_UNSAFE_PATH`              | 400  | 不正なパスです：{path}                 | 細工されたリクエスト、設定の誤り | きれいな相対パスだけを使う。                |
| `ERR_PATH_ESCAPE`              | 400  | パスがストレージのルート外を指しています：{path} | シンボリックリンクの脱出、細工 | 設定した保存先の中に収める。         |
| `ERR_STORAGE_READONLY`         | 403  | このストレージは読み取り専用です：{name} | 読み取り専用のバックアップ先へ書き込み | 書き込める保存先にするか、読み取り専用を解除する。 |
| `ERR_NOT_A_DIRECTORY`          | 400  | ディレクトリではありません：{path}     | フォルダの場所にファイルがある | ファイルを移動する。                          |
| `ERR_STORAGE_CONFIG_MISSING`   | 400  | ストレージ設定が不足しています         | 設定フォームが空               | 設定オブジェクトを送る。                      |
| `ERR_REMOTE_SOURCE_MISSING`    | 400  | リモート素材ディレクトリがまだ設定されていません | 未設定のまま同期を要求 | 「設定 → ストレージ」で元を設定する。         |
| `ERR_STORAGE_TARGET_NOT_FOUND` | 404  | ストレージターゲットが見つかりません：{targetId} | 保存先が削除された、タブが古い | ストレージ設定を再読み込みする。  |
| `ERR_STORAGE_LIST_FAILED`      | 503  | ディレクトリを一覧できません：{detail} | 共有がオフライン、権限不足     | 接続と認証情報を確認する。                    |
| `ERR_SECRETS_DECRYPT_FAILED`   | 500  | 保存された認証情報を復号できません | `.secret.key` の交換・消失、ファイルの改変 | 対応する `.secret.key` を戻すか、認証情報ファイルを削除してパスワードを再入力する。ファイルは変更されない。 |
| `ERR_BACKUP_UPLOAD_FAILED`     | 503  | バックアップのアップロードに失敗しました：{detail} | WebDAV のエラー、ディスク満杯 | `detail` と保存先を確認する。                 |
| `ERR_AUTO_BACKUP_FAILED`       | 500  | 定期バックアップに失敗しました：{detail} | 実行時に保存先が書けない、ディスク満杯 | `detail` を確認する。バックアップ先一覧に失敗情報が残る。 |

### プラグイン

| コード                 | HTTP | 意味                               | よくある原因                   | 対処                                              |
| ---------------------- | ---- | ---------------------------------- | ------------------------------ | ------------------------------------------------- |
| `ERR_PLUGIN_NO_EXPORT` | 200* | panels 関数がエクスポートされていません | プラグインの書き損じ      | `plugins/*.mjs` から `panels` をエクスポートする。 |
| `ERR_PLUGIN_LOAD`      | 200* | プラグインを読み込めませんでした   | 構文エラー、依存関係の欠落、読み込み時の例外 | モジュールを修正する。警告に元のエラーが残る。 |
| `ERR_PLUGIN_RUN_FAILED` | 200* | プラグインの実行中にエラーが発生しました | 入力の未処理、実行時バグ | プラグイン内で例外を捕まえる。検出は自動検出に戻る。 |
| `ERR_PLUGIN_BAD_RESULT` | 200* | 配列でも `{ panels }` でもない値を返しました | 戻り値の書き間違い | 矩形の配列か `{ panels: [...] }` を返す。 |
| `ERR_PLUGIN_TIMEOUT`   | 504* | プラグインが {ms}ms でタイムアウトしました | 大きなページで遅いアルゴリズム | プラグインを速くする。サーバーは自動検出に戻る。   |
| `ERR_PLUGIN_NO_PANELS` | 200* | プラグインがコマを返しませんでした | しきい値が厳しすぎる           | 1 つ以上返すか、自動検出に任せる。                 |
| `ERR_PLUGIN_NONE`      | 200* | 一致するプラグインがありません     | プラグインがない、`match` が合わない | プラグインを追加するか、CLI で `--auto` を付ける。 |

\* プラグインの失敗は通常 `warnings`（および `warningCodes`）として返り、検出は自動検出に戻るため、HTTP 呼び出し自体は成功します。

### アーカイブ（`.mnproj`、バックアップ）

| コード                       | HTTP | 意味                                       | よくある原因           | 対処                                |
| ---------------------------- | ---- | ------------------------------------------ | ---------------------- | ----------------------------------- |
| `ERR_ZIP_TOO_SMALL`          | 400  | 有効なアーカイブではありません（ファイルが小さすぎます） | アップロードの切断 | もう一度アップロードする。        |
| `ERR_ZIP_NO_EOCD`            | 400  | 有効なアーカイブではありません（セントラルディレクトリが見つかりません） | zip でない、または切断 | 完全な `.mnproj` / バックアップを使う。 |
| `ERR_ZIP_CORRUPT_DIR`        | 400  | アーカイブのディレクトリが破損しています   | アーカイブの破損       | 作り直す。                          |
| `ERR_ZIP_ENTRY_CORRUPT`      | 400  | アーカイブ内の項目が破損しています：{name} | アーカイブの破損       | 作り直す。                          |
| `ERR_ZIP_UNSUPPORTED_METHOD` | 400  | 未対応の圧縮方式 {method}（{name}）        | 7-Zip や旧式の圧縮     | deflate で圧縮し直す。              |
| `ERR_ZIP_ENTRY_SIZE`         | 400  | アーカイブ内の項目サイズが一致しません：{name} | アーカイブの破損   | 作り直す。                          |

### ディレクトリ規則

| コード                          | HTTP | 意味                                                        | よくある原因                   | 対処                                          |
| ------------------------------- | ---- | ----------------------------------------------------------- | ------------------------------ | --------------------------------------------- |
| `ERR_RULE_EMPTY`                | 400  | パターンが空です                                            | 空の行                         | パターンを入れるか、行を削除する。            |
| `ERR_RULE_UNKNOWN_PLACEHOLDER`  | 400  | 不明なプレースホルダー {name}                               | `{volume}` を `{vol}` と書いた | `{volume}`、`{language}`、`{chapter}`、`{page}` だけを使う。 |
| `ERR_RULES_NOT_ARRAY`           | 400  | ルールは空でない配列である必要があります                    | すべて消した                   | 1 つ以上残す。                                |
| `ERR_RULE_NOT_OBJECT`           | 400  | {index} 番目のルールがオブジェクトではありません            | JSON の手編集                  | オブジェクトの配列を送る。                    |
| `ERR_RULE_PATTERN_MISSING`      | 400  | {index} 番目のルールに pattern がありません                  | ルールの書きかけ               | `pattern` を足す。                            |
| `ERR_RULE_PATTERN_ABSOLUTE`     | 400  | {index} 番目のルールは相対パスで、.. を含められません       | 絶対パスを貼り付けた           | 相対パターンにする。                          |
| `ERR_RULE_PAGE_MISSING`         | 400  | {index} 番目のルールには {page} プレースホルダーが必要です  | ページの段を忘れた             | `{page}` を足す。                             |
| `ERR_RULE_LANGUAGE_INVALID`     | 400  | {index} 番目のルールの language 値「{value}」が無効です（パス区切り文字は使用できません） | language に `/` や `\` | `ja` のような言語コードを書く。               |
| `ERR_RULE_LANGUAGE_MISSING`     | 400  | {index} 番目のルールには {language} プレースホルダーか language の既定値が必要です | どちらもない | `{language}` か `language` を足す。           |
| `ERR_RULE_DUPLICATE_ID`         | 409  | ルール id が重複しています：「{id}」                        | コピー＆ペースト               | 一意な id にする。                            |
| `ERR_RULE_PARSE`                | 400  | ルール「{rule}」を解析できません：{detail}                  | `config/dir-rules.json` の破損 | 直す。直らない場合ライブラリは既定ルールに戻る。 |

## 警告コード

警告は成功レスポンスに添えられます。サーバー自身が生成した警告では、レスポンスに `warningCodes` も入ります。

| コード                            | 意味                                                                 | よくある原因                   |
| --------------------------------- | -------------------------------------------------------------------- | ------------------------------ |
| `WARN_DETECT_FROM_LAYOUT`         | レイアウトテンプレート「{name}」でコマ分割しました                   | その巻 / 話 / ページにレイアウトを紐付けている |
| `WARN_DETECT_FROM_PLUGIN`         | プラグイン {plugin} でコマ分割しました                               | プラグインが一致した           |
| `WARN_PLUGIN_FAILED_FALLBACK`     | プラグイン {plugin} が失敗しました（{detail}）。自動検出に切り替えました | プラグインのエラーやタイムアウト |
| `WARN_TITLE_FETCH_FAILED`         | タイトルを取得できませんでした（ネットワーク制限の可能性）。手動で入力できます | ネットワーク制限、ホスト遮断 |
| `WARN_PAGE_SKIPPED_NO_PANELS`     | {page} ページにはまだコマデータがありません。スキップしました        | 検出したが保存していない       |
| `WARN_EXPORT_AUTODETECTED`        | コマデータが無かった {count} ページを自動検出しました                | 書き出し前にコマ分割していない |
| `WARN_PAGE_SKIPPED_NO_CONTENT`    | {page} ページにはまだコマもノートもありません。スキップしました      | 書き出せる内容がない           |
| `WARN_PAGE_IMAGE_UNREADABLE`      | {page} ページの {lang} 画像を読み込めません                          | 画像の破損、未対応コーデック   |
| `WARN_DIR_RULES_FALLBACK`         | ディレクトリ判定ルールが無効です（{detail}）。既定のルールに戻しました | `config/dir-rules.json` の破損 |
| `WARN_UNRECOGNIZED_DIRS`          | 認識できないディレクトリ：{dirs}（「巻の設定」で言語を指定できます） | 変わったフォルダ名             |
| `WARN_LANGUAGE_PAGE_COUNT`        | 言語ごとのページ数が異なります：{counts}（番号順に対応付け、欠けたページは表示時に示します） | ある言語のページ欠け |
| `WARN_MIXED_EXTENSIONS`           | {lang}：この話の中で拡張子が統一されていません：{exts}              | `.jpg` と `.png` の混在        |
| `WARN_MISSING_PAGE`               | {lang}：{page} ページがありません                                    | 番号の抜け                     |
| `WARN_FILENAME_MISMATCH`          | {lang}：ファイル名 {name} が {page} ページの番号と一致しません       | 9 ページ目が `page-010.jpg`    |
| `WARN_NO_LANGUAGE_DIRS`           | 言語ディレクトリを認識できませんでした。「ディレクトリ判定」ルールを確認するか、ここで言語ディレクトリを指定してください | どのルールにも合わない |
| `WARN_SAME_NAME_VOLUME`           | 同名のディレクトリが既にあり、自動的に認識しました                   | 同じ元の二重追加               |
| `WARN_EMPTY_VOLUME_CREATED`       | 空のディレクトリを作成しました。raw/巻名/言語/話番号/01.jpg の形で画像を追加してください | 画像なしで巻を作成 |
| `WARN_NO_LANGUAGE_DIR_DETECTED`   | 言語ディレクトリを認識できなかったため単一巻として追加しました。「巻の設定」で指定できます | フラットな構成 |
| `WARN_VOLUME_ALREADY_IN_LIBRARY`  | 「{name}」は既にライブラリにあるため自動的に認識しました              | 重複追加                       |
| `WARN_VOLUME_DIR_REMOVED`         | ディレクトリが存在しないため、ライブラリ設定から削除しました         | アプリ外でフォルダを削除       |
| `WARN_IMAGE_PATH_INVALID`         | 画像パスを解決できません：{path}                                     | manifest の URL が壊れている   |
| `WARN_IMAGE_MISSING`              | 画像が存在しないためスキップしました：{path}                         | `.mnproj` が不完全             |
| `WARN_PAGE_JSON_INVALID`          | ページ JSON を解析できません：{path}                                 | ページファイルの破損           |
| `WARN_ENTRY_JSON_INVALID`         | JSON を解析できないためスキップしました：{name}                      | アーカイブ内の設定が破損       |
| `WARN_SUSPICIOUS_PATH`            | 疑わしいパスをスキップしました：{name}                               | `../` を含む項目               |
| `WARN_UNKNOWN_ENTRY`              | 不明な項目を無視しました：{name}                                     | 余分なファイル                 |
| `WARN_SNAPSHOT_FAILED`            | 復元前のスナップショットに失敗しました：{detail}                     | ディスク満杯、権限不足         |
| `WARN_PROJECT_COPY_FAILED`        | 元のプロジェクトファイルを保存できませんでした：{detail}             | ディスク満杯、権限不足         |
| `WARN_JSON_MERGE_FALLBACK`        | {name} を結合できません（JSON 解析に失敗）。既存の内容を保持しました | アーカイブ内の JSON が不正     |
| `WARN_LIBRARY_MERGE_FALLBACK`     | config/library.json を結合できません。既存の設定を保持しました       | アーカイブ内の JSON が不正     |
| `WARN_RELINK_DIR_MISSING`         | 再リンク先のディレクトリが存在しないか、フォルダではありません：{dir} | 元フォルダの移動              |
| `WARN_UNSAFE_IMAGE_PATH`          | 安全でない画像パスのためスキップしました：{volume}/{chapter}/{name}  | 細工されたアーカイブ           |
| `WARN_IMAGE_OVERWRITE_SKIPPED`    | raw/ に同名で内容の異なる画像が既にあるため上書きしませんでした：{volume}/{chapter}/{name} | 素材の衝突 |
| `WARN_RULE_LEVEL_MISMATCH`        | ルール「{rule}」の階層と一致しません                                 | 階層が 1 つ多い / 少ない       |
| `WARN_RULE_NO_LANGUAGE`           | ルールに {language} セグメントも language の既定値もありません       | ルールが不完全                 |
| `WARN_UNKNOWN_LANGUAGE_DIR`       | 言語ディレクトリ「{dir}」を認識できません（巻の設定で手動指定できます） | `jp`、`cn`、独自名          |
| `WARN_NO_RULE_MATCHED`            | どのルールにも一致しませんでした                                     | 未対応の構成                   |

## その他のメッセージコード

これらもローカライズされますが、診断情報ではなくデータです。

- `STATUS_STORAGE_*` — `GET /api/storage` と `POST /api/storage/test` が返すストレージ検査結果（`online`、`message`）：

  | コード                           | 意味                                             |
  | -------------------------------- | ------------------------------------------------ |
  | `STATUS_STORAGE_LOCAL_OK`        | ローカルディレクトリにアクセスできます           |
  | `STATUS_STORAGE_NETWORK_OK`      | ネットワーク共有にアクセスできます               |
  | `STATUS_STORAGE_WEBDAV_OK`       | WebDAV にアクセスできます                        |
  | `STATUS_STORAGE_DIR_NOT_CREATED` | 対象ディレクトリはまだ存在しません。最初の書き込み時に作成します |
  | `STATUS_STORAGE_ACCESS_FAILED`   | アクセスできません：{detail}                     |
  | `STATUS_STORAGE_TIMEOUT`         | 接続がタイムアウトしました                       |
  | `STATUS_STORAGE_UNREACHABLE`     | 接続できません                                   |

- `HISTORY_*` — ページ文書に保存される `lastEditSummary` の値（そのページを保存したリクエストの言語で書かれます）：`HISTORY_CREATED`、`HISTORY_PANELS`、`HISTORY_PANEL_RECTS`、`HISTORY_NOTES`、`HISTORY_NOTE_EDIT`、`HISTORY_DIRECTION`、`HISTORY_GROUPS`、`HISTORY_ANNOTATIONS`、`HISTORY_ALIGN_MODE`、`HISTORY_OFFSETS`、`HISTORY_SAVE`、`HISTORY_DETECTED`。

- `EXPORT_*` — 書き出した HTML 内の文言：`EXPORT_DIRECTION_RTL`、`EXPORT_DIRECTION_LTR`、`EXPORT_DIRECTION_TTB`、`EXPORT_PAGE_NOTES`、`EXPORT_PANEL_NO`、`EXPORT_EMPTY_PANELS`、`EXPORT_EMPTY_IMAGE`、`EXPORT_EMPTY_NOTES`、`EXPORT_PAGE_ALT`、`EXPORT_CHAPTER_LINE`、`EXPORT_AT`、`EXPORT_FOOTER`。

- `LANG_NAME_JA`、`LANG_NAME_ZH`、`LANG_NAME_EN`、`LABEL_*`、`DEFAULT_NAME_*` — 表示名と既定タイトル。

- `CLI_*` — CLI 専用の行：`CLI_USAGE`、`CLI_ERROR`、`CLI_REPORT_SUMMARY`、`CLI_REPORT_HISTOGRAM`、`CLI_REPORT_HISTOGRAM_ITEM`、`CLI_REPORT_NARROW`、`CLI_REGRESS_BASELINE`、`CLI_REGRESS_RESULT`、`CLI_DETECT_SKIPPED`、`CLI_DETECT_SKIPPED_EXISTING`、`CLI_DETECT_PAGE`、`CLI_DETECT_WRITTEN`、`CLI_DETECT_PREVIEW`、`CLI_DETECT_WARNING_SUFFIX`、`CLI_DETECT_DONE`、`CLI_LAYOUT_APPLIED`、`CLI_LAYOUT_NONE`、`CLI_LAYOUT_ROW`、`CLI_PLUGIN_NONE`、`CLI_PLUGIN_ROW`、`CLI_PLUGIN_ROW_ERROR`、`CLI_PLUGIN_FAILED`、`CLI_TEMPLATE_APPLIED`、`CLI_TEMPLATE_NONE`、`CLI_TEMPLATE_ROW`、`CLI_ALIGN_APPLIED`、`CLI_ALIGN_NONE`、`CLI_ALIGN_ROW`、`CLI_NO_RESULT`。

- CLI 専用のエラー：`CLI_TEMPLATE_ARGS_REQUIRED`（`--template/--volume/--chapter` の不足）、`CLI_TARGET_CHAPTER_MISSING`、`CLI_MISSING_STATIC_DIR`。

## メッセージの追加・変更

1. `server/messages/catalog.ts` の `MESSAGES` にコードを追加し、**3 言語すべて**を書きます（`en` はフォールバックなので必須です）。
2. ユーザー向けのテキストは `t('CODE', { param })`、失敗は `throw new AppError('CODE', { param }, status)` を使います。翻訳済みの断片を連結せず、値は必ずパラメーターで渡します。
3. 上記の該当する表に 1 行追加します（`WARN_*` は警告表へ）。
4. `npm run typecheck`、`npm run lint`、`npm run format:check` を実行します。カタログのキー型は `MESSAGES` から導出されるため、打ち間違いはそのままコンパイルエラーになります。
