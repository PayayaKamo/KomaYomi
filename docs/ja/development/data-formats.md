# データ形式（開発者向け）

KomaYomi は状態をすべて JSON としてディスクに保存します。このページは、スクリプトを書いたり形式自体を変えたりする人向けのリファレンスです。共通のエンベロープ、よく触る構造、そして古いファイルを新しいコードでも開けるようにするルールをまとめます。

利用者向けの概要は[プロジェクトファイルと形式](/ja/guide/project-files)にあります。実行時に実際に効いている検証器は `shared/format.ts` です。

## エンベロープ

交換ファイルと保存ファイルは同じヘッダーを持ちます。

```json
{
  "$schema": "https://manga-memo.dev/schemas/page.schema.json",
  "schemaVersion": 1,
  "kind": "page",
  "appVersion": "0.1.0"
}
```

| キー | 意味 |
| --- | --- |
| `$schema` | 形式の正規 URL。説明用で、アプリが取得することはありません。 |
| `schemaVersion` | 整数のバージョン。キーがなければ v0 として扱います。 |
| `kind` | 形式の識別子: `page`、`mnproj`、`mntpl`、`mnexp`、`mntp`、`mnalign`、`mnlayout`、`mnconfig`、`mnstorage`、`mnhistory`。 |
| `appVersion` | 生成したビルド。調査用で、移行の選択には使いません。 |

例外が一つあります。`.mnproj` の `manifest.json` は `$schema`、`schemaVersion`、`appVersion` だけを持ち、`kind` はありません。ZIP 自体が形式を示すためです。

## 形式一覧

| `kind` | 保存場所 | 拡張子 | 内容 |
| --- | --- | --- | --- |
| `page` | `data/pages/<巻>/<章>/<番号>.json` | 書き出し時は `.mnpage.json` | コマ、ノート、オフセット、グループ、注釈、編集情報。 |
| `mnconfig` | `data/library.json` | — | 巻の上書き、フォルダールール、言語順、履歴上限、自動バックアップ。 |
| `mnproj` | `.mnproj` ZIP 内の `manifest.json` | `.mnproj` | プロジェクト名、保存方式、言語マッピング、画像一覧、ノート数。 |
| `mntpl` | 書き出したレイアウトテンプレート | `.mntpl` | 行・列グリッド、余白、間隔、列の重み、ページ単位の上書き。 |
| `mnexp` | `data/templates/export.json` の要素 | `.mnexp` | エクスポートダイアログの設定。 |
| `mntp` | `data/templates/panels/<id>.json` | — | 保存したコマ矩形と読み方向。 |
| `mnalign` | `data/presets/align/<id>.json` | — | ページまたは章の位置合わせオフセット。 |
| `mnlayout` | `data/layouts/<id>.json` | — | 巻・章・ページに紐づく宣言的レイアウト。 |
| `mnstorage` | `data/storage.json` | — | 保存先、認証情報、キャッシュ上限。 |
| `mnhistory` | `data/history/<巻>/<章>/<番号>.json` | — | セッションをまたぐページのスナップショット。 |

## ページ文書

1 ページ 1 ファイル、番号は 0 始まりです。矩形と座標はページに対して正規化され、`0..1` の範囲になります。

```json
{
  "$schema": "https://manga-memo.dev/schemas/page.schema.json",
  "schemaVersion": 1,
  "kind": "page",
  "appVersion": "0.1.0",
  "volume": "点兔第14卷",
  "chapter": "172",
  "pageIndex": 0,
  "panels": [
    { "id": "p1", "rect": { "x": 0.04, "y": 0.03, "w": 0.44, "h": 0.31 }, "source": "auto", "number": 1 },
    { "id": "p2", "rect": { "x": 0.52, "y": 0.03, "w": 0.44, "h": 0.31 }, "source": "manual", "number": 2 }
  ],
  "notes": [
    {
      "id": "n1712345678901",
      "scope": "panel",
      "panelId": "p1",
      "text": "**原文**：……\n\n翻訳はもう少し硬め。",
      "tags": ["語気", "要確認"],
      "source": { "title": "参考ページ", "url": "https://example.com" },
      "createdAt": "2026-05-12T10:00:00.000Z",
      "updatedAt": "2026-05-12T10:05:00.000Z"
    }
  ],
  "offsets": {
    "ja": { "x": 0, "y": 0, "scale": 1 },
    "zh": { "x": 0.01, "y": -0.005, "scale": 1.02 }
  },
  "alignMode": "panel",
  "panelOffsets": {
    "p1": { "zh": { "x": 0.01, "y": 0, "scale": 1 } }
  },
  "gridStep": 1,
  "readingDirection": "rtl",
  "detectorVersion": "xycut-1.3",
  "detectedAt": "2026-05-12T09:59:00.000Z",
  "detectSource": "auto",
  "editCount": 7,
  "lastEditedAt": "2026-05-12T10:05:00.000Z",
  "lastEditSummary": "コマ枠を調整、注釈を編集",
  "groups": [{ "id": "g1", "name": "見開き", "panelIds": ["p2", "p3"], "number": 1 }],
  "annotations": [
    {
      "id": "a1",
      "kind": "arrow",
      "scope": "panel",
      "panelId": "p1",
      "points": [{ "x": 0.1, "y": 0.2 }, { "x": 0.8, "y": 0.7 }],
      "color": "#c2410c",
      "width": 3,
      "opacity": 0.9,
      "createdAt": "2026-05-12T10:00:00.000Z",
      "updatedAt": "2026-05-12T10:00:00.000Z"
    }
  ],
  "annotationsVisible": true,
  "updatedAt": "2026-05-12T10:05:00.000Z"
}
```

手で書く前に覚えておきたい点:

- `panels[].id` はページ内で一意なら十分です。`source` は `auto`、`manual`、`merged` のいずれかで、`number` は省略できます。
- `notes[].scope` は `page` か `panel`。コマのノートには `panelId` が必要です。`text` が文字列でないノートは捨てられます。
- `offsets[lang].scale` は `0.2..4` に丸められます。`gridStep` はパーセントで、`0.1..10` の範囲です。
- `readingDirection` は `rtl`、`ltr`、`ttb`、`horizontal-rl`、`horizontal-lr`、`vertical-rl`、`vertical-lr`。削除された `continuous-vertical` は `rtl` として読みます。
- 注釈の `kind` は `arrow`、`rect`、`ellipse`、`highlight`、`text`、`badge`、`mosaic`、`pen`。手書きはすべての点を、矢印は最初と最後の点を使います。
- `groups[].panelIds` には順序があり、その順序が書き出し順と比較リーディングの送り順になります。存在しないコマを指す id は読み込み時に外されます。

## `data/library.json`

```json
{
  "$schema": "https://manga-memo.dev/schemas/mnconfig.schema.json",
  "schemaVersion": 1,
  "kind": "mnconfig",
  "appVersion": "0.1.0",
  "volumes": {
    "点兔第14卷": {
      "title": "点兔 第14巻",
      "series": "ご注文はうさぎですか？",
      "dirs": { "ja": "raw-ja", "zh": "raw-zh" },
      "defaultDirection": "rtl",
      "chapters": {
        "172": {
          "title": "第172話",
          "order": [0, 1, 2],
          "excluded": [12],
          "kinds": { "0": "cover" },
          "hidden": false,
          "pageOffsets": { "zh": { "from": 5, "to": 6 } }
        }
      }
    }
  },
  "rules": [
    {
      "id": "volume-language-chapter-page",
      "pattern": "{volume}/{language}/{chapter}/{page}"
    },
    {
      "id": "series-volume-language-chapter-page",
      "pattern": "{series}/{volume}/{language}/{chapter}/{page}"
    }
  ],
  "langOrder": ["ja", "zh", "en"],
  "historyLimit": 50,
  "autoBackup": { "enabled": true, "intervalHours": 24, "keep": 7 }
}
```

- `volumes` は上書きだけを持ち、ディスク上のフォルダー名は変えません。`title` と `series` はサイドバーの表示、`defaultDirection` はその巻の新しいページが継承する閲覧方向です。
- `chapters` は話 ID をキーにします。`hidden: true` はフォルダーとページデータを残したままライブラリから外し、`pageOffsets` はある言語の `from` ページ目を参照版の `to` ページ目に合わせます。
- `rules` は上から順に試し、空なら 2 つの内蔵ルールに戻ります。書き方は[フォルダー判定ルール](/ja/development/folder-rules)へ。
- `langOrder` はあくまで優先順です。走査で見つかった言語は設定済みの後ろに並びます。
- `historyLimit` の既定値は 50 で、`5..200` に制限されます。
- `autoBackup` は省略可能です。アプリまたはサーバーが動いている間だけ実行されます。

## `.mnproj` プロジェクト

`.mnproj` は ZIP です。参照方式はパスとハッシュだけを持ち、同梱方式は画像のバイト列も含みます。

```text
manifest.json
pages/<巻>/<章>/<番号>.json
history/<巻>/<章>/<番号>.json
templates/...
presets/...
config/library.json          （任意）
assets/<sha1>.<ext>          （同梱方式のみ）
```

参照方式の manifest:

```json
{
  "$schema": "https://manga-memo.dev/schemas/mnproj.schema.json",
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "createdAt": "2026-05-12T10:00:00.000Z",
  "updatedAt": "2026-05-12T10:00:00.000Z",
  "storageMode": "reference",
  "name": "点兔第14巻 学習ノート",
  "language": {
    "volumes": { "点兔第14卷": { "ja": "raw-ja", "zh": "raw-zh" } },
    "resolved": { "点兔第14卷": { "ja": "raw-ja", "zh": "raw-zh" } }
  },
  "inventory": {
    "volumes": [
      {
        "volume": "点兔第14卷",
        "languages": ["ja", "zh"],
        "langDirs": { "ja": "raw-ja", "zh": "raw-zh" },
        "chapters": [{ "chapter": "172", "pages": 18, "images": 36 }]
      }
    ],
    "pageCount": 18,
    "images": [
      {
        "volume": "点兔第14卷",
        "chapter": "172",
        "pageIndex": 0,
        "lang": "ja",
        "name": "001.jpg",
        "sha1": "9f2c…",
        "size": 245678,
        "path": "raw/点兔第14卷/raw-ja/172/001.jpg"
      }
    ]
  },
  "notes": { "pages": 18, "noteCount": 42, "annotationCount": 0, "text": "任意のメモ" }
}
```

同梱方式では、各画像の `path` が `asset: "assets/<sha1>.<ext>"` に変わり、取り込み時にその画像が `raw/` へ書き出されます。

取り込み時はファイルごとに衝突を判定し、**上書き**、**統合**、**スキップ**から選べます。統合は既存のコマと注釈を残し、ノートは id で和集合を取り（同じ id は取り込む側が優先）、ローカルにしかないノートは削除しません。

## `.mntpl` レイアウトテンプレート

レイアウトを書き出すと巻・章・ページの紐づけが外れ、再利用できるテンプレートになります。

```json
{
  "$schema": "https://manga-memo.dev/schemas/mntpl.schema.json",
  "schemaVersion": 1,
  "kind": "mntpl",
  "appVersion": "0.1.0",
  "id": "four-panel",
  "name": "四分割",
  "scope": "template",
  "readingDirection": "rtl",
  "margin": { "top": 0.03, "right": 0.03, "bottom": 0.03, "left": 0.03 },
  "gap": 0.012,
  "colWeights": [1, 1],
  "grid": {
    "cols": 2,
    "rows": [
      { "height": 1, "cells": [{}, {}] },
      { "height": 1, "cells": [{}, {}] }
    ]
  },
  "pageOverrides": {
    "2": { "gap": 0.02 }
  },
  "createdAt": "2026-05-12T10:00:00.000Z",
  "notes": "第172話の大半のページ用"
}
```

`data/layouts/<id>.json` に保存されるレイアウト（`kind: "mnlayout"`）もグリッドの書き方は同じですが、`scope: "page" | "chapter" | "volume"` と `volume`、`chapter`、`pageIndex` を持ち、検出時に自動で適用されます。`pageOverrides` のキーは**1 始まり**のページ番号です。

## `.mnexp` エクスポートテンプレート

完全なテンプレートは次のとおりです。`data/templates/export.json` の中身にも、単体の `.mnexp` ファイルにも同じ形で入ります。

```json
{
  "$schema": "https://manga-memo.dev/schemas/mnexp.schema.json",
  "schemaVersion": 1,
  "kind": "mnexp",
  "appVersion": "0.1.0",
  "id": "exp-1712345678901",
  "name": "左に画像、右にノート",
  "createdAt": "2026-05-12T10:00:00.000Z",
  "config": {
    "template": "two-column",
    "title": "漫画比較メモ",
    "languages": ["ja", "zh"],
    "embedImages": false,
    "showPanelBoxes": false,
    "includeNotes": true,
    "onlyWithNotes": false,
    "noteFilterTags": [],
    "pageWidthRatio": 46,
    "columnGap": 28,
    "fontScale": 1,
    "columns": 1
  }
}
```

`template` は `two-column`、`stack`、`compare-wide` のいずれかです。出力範囲（`volume`、`chapter`、`pageIndices`）と `offsets` は書き出し時に選ぶもので、テンプレートには保存しません。各フィールドは[エクスポートテンプレート](/ja/development/export-templates)にまとめました。

## バージョン、移行、未知フィールド

### 交換ファイルを読む

`prepareExchange(kind, value)` は次の順で進みます。

1. `checkSchemaVersion` — 現在より新しい `schemaVersion` はエラーにし、ダウングレードはしません。
2. `0 → 1 → … → 現在` の移行。1 段につき 1 関数で、`shared/format.ts` と `shared/migrations.ts` にあります。
3. `finalizeEnvelope` — `$schema`、`schemaVersion`、`kind`、`appVersion` を書きます。
4. 全体の検証。エラーには `manifest.volumes[2].chapters: required` のようなパスが付きます。

4 段すべて通るまで書き込みません。取り込みが失敗しても中途半端なファイルは残りません。

### `data/` の保存ファイルを読む

これらのファイルを読み書きするのは `server/schemaStore.ts` だけです。

- 古いファイルは読み込み時に移行し、その場で書き戻します。その前に元のバイト列を `<ファイル名>.v<旧バージョン>.bak` へ一度だけ退避します。
- 検証は緩め（`strict: false`）です。任意フィールドが一つ足りないだけで利用者を締め出してはいけません。
- 新しいビルドのファイルはそのまま返しますが、書き込みは HTTP `409` と `ERR_SCHEMA_TOO_NEW` で拒否します。
- 書き込みは原子的です。同じ場所の一時ファイルに書いてからリネームします。

### 未知フィールドは往復しても残る

`preserveUnknown(previous, next)` は、ディスク上の値とこれから書く値を統合します。

- 未知のオブジェクトキーは再帰的にコピー。
- `id` を持つオブジェクトの配列は `id` ごとに統合。
- それ以外の配列は新しい値で置き換え、順序と削除は書き込む側の判断。

これにより「新しいビルドで開き、古いビルドで保存し、また新しいビルドで開く」という往復で、古い側が知らないフィールドが失われません。

ページ文書には注意点があります。`server/storage.ts` の `normalizeDoc` は `preserveUnknown` の前にコマ、ノート、注釈をフィールド単位で作り直します。既存オブジェクトの未知フィールドは統合で残りますが、**新しく作った**コマやノートに付けたフィールドは、`normalizeDoc` が知らない限り書かれません。型を足すだけでは足りません。

### 履歴とバージョン

v2 はまだありません。呼び出し側を触らずに v2 を足せるように移行を書いています。値を消すだけならバージョンを上げる必要はありません。`continuous-vertical` は削除され、`rtl` として読まれます。

コンテンツ言語の id は実行時の文字列で、固定の列挙ではありません。`ja`、`zh`、`en` には表示名がありますが、それ以外の id も言語として扱い、汎用のラベルで表示します。`library.langOrder`、巻の `langDirs`、ページの `files`、書き出しの `languages` は任意の id を受け付けます。

## 形式を安全に変える

任意フィールドの追加にバージョン更新は不要です。

1. `shared/types.ts` の型に任意フィールドとして足す。
2. `shared/format.ts` の対応する spec に任意フィールドとして足す（`required` には入れない）。
3. コマ、ノート、注釈に属するなら、`server/storage.ts` の `normalizeDoc` でも残すようにする。
4. 利用者が入出力する形式なら `shared/schemas/*.json` も更新する。
5. `tests/unit/formats.test.ts` に「古いファイルが読める」「書き込み後もフィールドが残る」を追加する。

次の場合は `schemaVersion` を上げ、移行を追加します。

- 既存フィールドの意味や型が変わる。
- 任意だったフィールドが必須になる。
- データ構造を組み替える必要がある（キーを入れ子へ移すなど）。

新しい形式を足すときは:

1. `shared/format.ts` の `SCHEMA_URLS`、`FORMAT_LABEL`、`FORMAT_EXTENSION`、`CURRENT_SCHEMA_VERSION` に追加。
2. 同じファイルに spec を追加。
3. `MIGRATIONS` に v0 を追加。
4. 利用者が取り込めるなら `shared/schemas/<kind>.schema.json` を追加。
5. 読み書きは必ず `server/schemaStore.ts` の `readStoredFile` / `writeStoredFile` を通す。

## 壊れたファイルの復旧

1. アプリを止めて、上書きされないようにする。
2. 移行後のファイルの隣にある `<ファイル名>.json.v0.bak` を探す。
3. 現在のファイルをバックアップで置き換え、元の名前に戻す。

バックアップはバージョンごとに一度だけ書かれ、アプリが削除することはありません。プロジェクトや書き出しには含まれず、git でも無視されます。

## 挙動を固定しているテスト

`npm test` が、壊れやすい部分を押さえています。

- v0 → v1 のページ移行（古い `version` キーの削除を含む）と、繰り返し実行しても結果が変わらないこと。
- manifest v0 の `images`、`langDirs`、`pageCount` を `inventory` へ畳むこと。
- トップレベルと入れ子の未知フィールドが読み書き往復後も残ること。
- 最初のその場移行の前に `.v0.bak` が作られること。
- 新しいスキーマのファイルが読み取り専用で開き、書き込みが `ERR_SCHEMA_TOO_NEW` になること。
- 取り込み時に新しい `schemaVersion` を拒否すること。
