# データ形式

KomaYomi が保存するものはすべてプレーンな JSON またはプレーンな画像ファイルです。このページではディスク上の契約を文書化し、スクリプトから扱ったり、差分を取ったり、手で修復したりできるようにします。

## ファイル構成

| パス | 内容 |
| --- | --- |
| `raw/<volume>/<language>/<chapter>/*.jpg` | ページ画像（入力、変更されません）。 |
| `data/pages/<volume>/<chapter>/<index>.json` | ページごとに1つのページドキュメント（`index` は 0 始まり）。 |
| `data/templates/panels/<id>.json` | 保存されたコマテンプレート。 |
| `data/templates/export.json` | 保存されたエクスポートテンプレート（1つの配列で、各要素が独自のエンベロープを持ちます）。 |
| `data/presets/align/<id>.json` | 保存された位置合わせプリセット。 |
| `data/layouts/<id>.json` | 宣言的レイアウトテンプレート。 |
| `data/library.json` | 手動の言語ディレクトリ対応付け。 |
| `data/cache/thumbs/` | サムネイルキャッシュ（削除して問題ありません）。 |
| `data/backups/` | インポートした `.mnproj` ファイルのコピー。 |
| `data/project-link.json` | ディスクから開き、書き戻し先になる `.mnproj`。アーカイブには含まれません。 |
| `exports/` | 生成された HTML、PNG、バックアップ ZIP、プロジェクトファイル。 |

書き込みはアトミックです。サーバーは `<file>.tmp` を書いてから対象にリネームします。クラッシュしても古いファイルは無傷で残ります。

## エンベロープ

プロジェクトのマニフェストを除き、保存・交換される JSON ファイルはすべて同じ4つのキーで始まります。

```json
{
  "$schema": "https://manga-memo.dev/schemas/page.schema.json",
  "schemaVersion": 2,
  "kind": "page",
  "appVersion": "1.0.1"
}
```

| キー | 意味 |
| --- | --- |
| `$schema` | その形式の正規 URL。情報用で、アプリが取得することはありません。 |
| `schemaVersion` | 整数のバージョン。キーがないファイルは v0 として読み込まれます。 |
| `kind` | 判別子: `page`、`mnproj`、`mntpl`、`mnexp`、`mntp`、`mnalign`、`mnlayout`、`mnconfig`、`mnstorage`、`mnhistory`。 |
| `appVersion` | ファイルを生成したビルド。診断用で、移行の選択には使いません。 |

`.mnproj` 内の `manifest.json` だけが例外です。`$schema`、`schemaVersion`、`appVersion` を持ちますが、`kind` は持ちません。アーカイブ自体が形式を示すためです。

## ページドキュメント

パス: `data/pages/<volume>/<chapter>/<pageIndex>.json`

```json
{
  "$schema": "https://manga-memo.dev/schemas/page.schema.json",
  "schemaVersion": 2,
  "kind": "page",
  "appVersion": "1.0.1",
  "volume": "点兔第14卷",
  "chapter": "172",
  "pageIndex": 0,
  "panels": [
    {
      "id": "p1",
      "rect": { "x": 0.04, "y": 0.03, "w": 0.44, "h": 0.31 },
      "source": "auto",
      "number": 1
    }
  ],
  "notes": [
    {
      "id": "n1712345678901",
      "scope": "panel",
      "panelId": "p1",
      "type": "background",
      "text": "**原文**：……\n\n翻訳はより硬い表現。",
      "tags": ["语气", "待确认"],
      "source": { "title": "参照ページ", "url": "https://example.com" },
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
  "lastEditSummary": "コマ枠を調整；注釈を変更",
  "groups": [{ "id": "g1", "name": "見開き大ゴマ", "panelIds": ["p2", "p3"], "number": 1 }],
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
      "text": null,
      "fontSize": null,
      "createdAt": "2026-05-12T10:00:00.000Z",
      "updatedAt": "2026-05-12T10:00:00.000Z"
    }
  ],
  "annotationsVisible": true,
  "updatedAt": "2026-05-12T10:05:00.000Z"
}
```

### フィールドリファレンス

| フィールド | 型 | 備考 |
| --- | --- | --- |
| `$schema`、`schemaVersion`、`kind`、`appVersion` | 上記参照 | エンベロープ。`kind` は `page`。 |
| `volume`, `chapter` | string | フォルダ名と一致する必要があります。 |
| `pageIndex` | number | 0 始まり。 |
| `panels` | `Panel[]` | 後述。座標は `0..1` にクランプされ、幅／高さは最小 `0.005` です。 |
| `notes` | `Note[]` | `scope` は `page` または `panel` で、コマのノートには `panelId` が必要です。`type` はノートの種類です。文字列の `text` を持たない行は破棄されます。 |
| `offsets` | `Record<Lang, AlignOffset>` | ページ単位の位置合わせ。`scale` は `0.2..4` にクランプされます。 |
| `alignMode` | `page \| panel \| anchors \| grid` | 無効な値は `page` になります。 |
| `panelOffsets` | `Record<panelId, Record<Lang, AlignOffset>>` | コマ単位の位置合わせ。 |
| `gridStep` | number | パーセント。`0.1..10` にクランプされ、既定は `1`。 |
| `readingDirection` | `rtl \| ltr \| ttb \| horizontal-rl \| horizontal-lr \| vertical-rl \| vertical-lr` | 無効な値は `rtl` になります。削除された `continuous-vertical` を含む古いファイルも `rtl` として読み込まれます。 |
| `detectorVersion` | string | 例: `xycut-1.3`、`layout:<id>`、`plugin:<name>`。 |
| `detectedAt` | ISO string | 最後の検出時刻。 |
| `detectSource` | `auto \| template \| plugin \| manual` | どの経路がコマを生成したか。 |
| `editCount` | number | 書き込みのたびに増えます。監査ログではありません。 |
| `lastEditedAt`, `lastEditSummary` | string | 人間が読める変更の概要。 |
| `groups` | `PanelGroup[]` | 読み込み時にぶら下がったコマ id が削除され、空のグループは破棄されます。 |
| `annotations` | `Annotation[]` | 無効な点は破棄されます。 |
| `annotationsVisible` | boolean | `false` にすると UI とエクスポートで注釈レイヤーを隠します。データは保持されます。 |
| `updatedAt` | ISO string | 書き込み時にサーバーが設定します。 |

### コマ

```json
{
  "id": "p1",
  "rect": { "x": 0.04, "y": 0.03, "w": 0.44, "h": 0.31 },
  "source": "auto",
  "number": 1
}
```

- `id` はページ内でローカルで、一意でなければなりません。
- `x`、`y`、`w`、`h` はページに対して正規化されています。
- `source` は `auto`、`manual`、`merged` のいずれかです。
- `number` は任意です。読み順を使う場合は省略します。

### ノート

| フィールド | 型 | 備考 |
| --- | --- | --- |
| `id` | string | ページ内で一意。 |
| `scope` | `page \| panel` | |
| `panelId` | string \| null | コマスコープでは必須。 |
| `type` | string \| undefined | 種類の id: 組み込み（`background`、`vocab`、`rant`）、言語別（`lang:<code>`、例 `lang:ja`）、または `noteTypes` のカスタム id。schema 2 より前のファイルにはなく、移行時に `background` が入ります。 |
| `text` | string | Markdown。生の HTML はエスケープされます。 |
| `tags` | string[] | |
| `source` | `{ title?, url?, text? }` | `text` は自由形式の出典ラベルです。 |
| `images` | `{ id, name, dataUrl }[]` | ノートに添付したスクリーンショット。ノートエディタで貼り付け、ドラッグ＆ドロップ、追加ができます。400 KB を超える画像は長辺 1600 px に縮小されます。 |
| `createdAt`, `updatedAt` | ISO string | |

### 注釈の種類

`arrow`、`rect`、`ellipse`、`highlight`、`text`、`badge`、`mosaic`、`pen`。

座標は注釈のスコープ（ページの枠またはコマの枠）に対する相対値です。フリーハンドのペンストロークは `points` の折れ線全体を使い、矢印は最初と最後の点を使います。

任意の `anchor` はページ座標のロケーターです: `{ "x": 0.5, "y": 0.4 }`、`w` / `h` があれば矩形になります。注釈はそこを指し、`showLeader` は注釈とロケーターを結ぶ引き出し線の有無を制御します（既定は `true` で、JSON では通常省略されます）。

## バージョンのルール

### ページドキュメント

- `schemaVersion` は現在 **2** です。キーがないファイルは v0 として扱われ、読み込み時に移行されます。エンベロープが追加され、旧 `version` キーは削除されます。
- **v1 → v2** でノートの種類が加わります。`type` を持たないノートはすべて `background` になり、本文・タグ・画像は変わりません。アップグレード後のドキュメントを書き込む前に、バージョン 1 の元ファイルが `<file>.v1.bak`（例: `3.json.v1.bak`）として隣に残ります。
- **より高い**スキーマバージョンは書き込み時に `ERR_SCHEMA_TOO_NEW` で拒否され、古いビルドが新しいファイルを黙ってダウングレードすることはありません。
- 読み込み時には値が**正規化**されます。無効な数値は既定値になり、矩形はクランプされ、ぶら下がったグループ参照は削除され、欠けた id は生成されます。
- **トップレベル**の未知フィールドは `preserveUnknown` により読み込み → 書き込みで保持されます。`id` を持つオブジェクト配列は id でマージされ、それ以外の配列は新しい値で置き換わります。
- `panels`、`notes`、`groups`、`annotations` といった既知の子オブジェクトは書き込み時にフィールド単位で再構築されるため、その**内部**の未知フィールドは保持される保証がありません。
- 解析できないページ JSON は存在しないものとしては扱われません。サーバーは `ERR_PAGE_CORRUPT` を返し、元のバイト列を `<file>.corrupt-<timestamp>.bak` として保存し、復元に使えるバックアップを一覧します。
- 移行はバージョンごとに連鎖します（`0 → 1 → 2`）。各ステップはフィールドの追加や名前変更のみで、ユーザーの内容を削除しません。

### ページ書き込みの保護

- **アトミックな置き換え** — 新しい JSON は同じディレクトリの一時ファイルに書き込まれ、フラッシュしてからページにリネームされます。クラッシュしても古いファイルは無傷です。
- **置き換え前の検証** — 保存のたびにページスキーマで検証します。失敗したドキュメントは `ERR_PAGE_SAVE_INVALID` で拒否され、何も書き込まれません。
- **バックアップのローテーション** — 置き換えの前に直前のページを `.bak` にコピーします。`KOMAYOMI_PAGE_BACKUPS` で保持する世代数を指定できます（既定 3、1〜20 にクランプ）。
- **同時書き込み** — ページごとに書き込みロックがあります。2 人目の書き込みは `ERR_PAGE_BUSY` を受け取り、10 秒を超えたロックは古いものとして回収されます。
- **破損ファイル** — 解析できないページは `ERR_PAGE_CORRUPT` を返し（上記）、その場で上書きされません。
- **バージョン移行** — v1 ページをアップグレードするときは元ファイルを `<file>.v1.bak` として残すため、移行前の状態は失われません。

### プロジェクトパッケージ

- `schemaVersion` は現在 **2** です。
- **v1 → v2** はマニフェストのエンベロープだけを更新します。ノートの種類は `config/library.json`（または `data/library.json`）にあり、マニフェストには入りません。
- **より高い**バージョンを宣言するパッケージは、明確なエラーで拒否されます。まずアプリをアップグレードしてください。
- バージョン **0** のパッケージ（初期の実験）はインポート時に移行されます。トップレベルの `images`、`file` フィールド、フラットな `langDirs` マップが現在のマニフェスト形状に変換されます。
- 欠けている任意のフィールドは既定値で埋められ、無効な画像はインポートを中断するのではなく破棄されます。

## プロジェクトパッケージ（`.mnproj`）

`.mnproj` ファイルは ZIP です:

```text
manifest.json
pages/<volume>/<chapter>/<index>.json
templates/...
presets/...
config/library.json          (optional)
assets/<sha1>.<ext>          (packaged mode only)
```

### マニフェスト

```json
{
  "$schema": "https://manga-memo.dev/schemas/mnproj.schema.json",
  "schemaVersion": 2,
  "appVersion": "1.0.1",
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
        "sha1": "…",
        "size": 245678,
        "path": "raw/点兔第14卷/raw-ja/172/001.jpg"
      }
    ]
  },
  "notes": { "pages": 18, "noteCount": 42, "annotationCount": 0, "text": "optional user memo" }
}
```

他のすべての形式と異なり、マニフェストには `kind` がありません。`.mnproj` アーカイブ自体が形式を示すためです。

### ストレージモード

| モード | 画像 | サイズ | 可搬性 |
| --- | --- | --- | --- |
| `reference` | マニフェストにパスと SHA-1 のみ。 | 小さい。 | 元の画像が必要です。SHA-1 またはファイル名でフォルダを再リンクできます。 |
| `packaged` | `assets/<sha1>.<ext>` に重複排除して格納。 | 大きい。 | 自己完結。インポートすると画像が `raw/` に書き込まれます。 |

インポートはファイルごとに競合を確認し、**上書き**、**マージ**、**スキップ**を提示します:

- **マージ** は、入力側のページにコマ／注釈がない場合に既存のものを保持し、ノートを id で統合し（同じ id は入力側が優先）、既存のノートを決して削除しません。
- インポートの前に必ず `data/` のスナップショットが書き込まれ、元のパッケージも `data/backups/projects/` に保持されます。

### 開いているプロジェクトファイルへの書き戻し

デスクトップ版でディスクから `.mnproj` を開くと、そのパスが `data/project-link.json` に記録され、以降の保存は作業コピーを再パッケージしてそのファイルを置き換えます。置き換えはアトミックです（同じディレクトリの一時ファイルに書いてフラッシュし、リネームで上書き）ので、途中で中断しても元のファイルが残ります。`<ファイル名>.bak` には前回の内容が残り（大きなアーカイブでは最大10分に1回更新）、開いたときの `manifest.createdAt` と manifest のメモは保持されます。読み取り専用モードでは決して書き込みません。関連付けを解除する（「書き戻しを停止」、別のプロジェクトのインポート、バックアップの復元）とファイルは変更されず、エクスポートは常に `exports/` に別コピーを作るだけで、開いているプロジェクトを変更しません。

## レイアウトテンプレート

パス: `data/layouts/<id>.json`

```json
{
  "$schema": "https://manga-memo.dev/schemas/mnlayout.schema.json",
  "schemaVersion": 1,
  "kind": "mnlayout",
  "appVersion": "0.1.0",
  "id": "layout-1712345678901",
  "name": "四格等分",
  "scope": "page",
  "volume": "点兔第14卷",
  "chapter": "172",
  "pageIndex": 3,
  "readingDirection": "rtl",
  "margin": { "top": 0.02, "right": 0.02, "bottom": 0.02, "left": 0.02 },
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
  "notes": "172話の大半のページに使用"
}
```

- `scope` は `page`、`chapter`、`volume` のいずれかで、リゾルバーは最も狭い一致を優先します。
- `cells[].span` により、セルを複数の列にまたがらせられます。
- `row.height` は相対的な重みです。
- `pageOverrides` のキーは 1 始まりのページ番号です。
- `margin` と `gap` は比率で、`colWeights` は既定で等幅です。
- テンプレートとしてエクスポートすると `.mntpl` ファイルになります。中身は同じで、`kind` が `mntpl`、`scope` が `template` になり、`volume` / `chapter` / `pageIndex` は削除されます。

## コマテンプレートと位置合わせプリセット

**コマテンプレート** — 1つのページから矩形をコピーします:

```json
{
  "$schema": "https://manga-memo.dev/schemas/mntp.schema.json",
  "schemaVersion": 1,
  "kind": "mntp",
  "appVersion": "0.1.0",
  "id": "tpl-…",
  "name": "四格无缝隙",
  "volume": "点兔第14卷",
  "chapter": "172",
  "panels": [{ "x": 0.02, "y": 0.02, "w": 0.47, "h": 0.47 }],
  "readingDirection": "rtl",
  "createdAt": "2026-05-12T10:00:00.000Z"
}
```

**位置合わせプリセット**:

```json
{
  "$schema": "https://manga-memo.dev/schemas/mnalign.schema.json",
  "schemaVersion": 1,
  "kind": "mnalign",
  "appVersion": "0.1.0",
  "id": "preset-…",
  "name": "172話 全体オフセット",
  "scope": "chapter",
  "volume": "点兔第14卷",
  "chapter": "172",
  "mode": "page",
  "offsets": { "zh": { "x": 0.01, "y": 0, "scale": 1 } },
  "panelOffsets": {},
  "gridStep": 1,
  "createdAt": "2026-05-12T10:00:00.000Z"
}
```

## エクスポートテンプレート

パス: `data/templates/export.json`

名前付きテンプレートの配列で、それぞれがエクスポート設定の一部を保存します:

```json
[
  {
    "$schema": "https://manga-memo.dev/schemas/mnexp.schema.json",
    "schemaVersion": 1,
    "kind": "mnexp",
    "appVersion": "0.1.0",
    "id": "exp-…",
    "name": "左图右注-紧凑",
    "createdAt": "2026-05-12T10:00:00.000Z",
    "config": {
      "template": "two-column",
      "languages": ["ja", "zh"],
      "embedImages": false,
      "pageWidthRatio": 46,
      "columnGap": 28,
      "fontScale": 1,
      "columns": 1
    }
  }
]
```

完全なエクスポート設定には `title`、`volume`、`chapter`、`pageIndices`、`offsets`、`showPanelBoxes`、`includeNotes`、`onlyWithNotes`、`noteFilterTags`、`print` も含まれます。`print` が `true` のとき、書き出した HTML は読み込み時にブラウザの印刷ダイアログを開き、ファイル名に `-print` が付きます。

## バックアップ ZIP

バックアップは、すべてのエントリに `data/` が前置された ZIP です:

```text
data/pages/...
data/templates/...
data/presets/...
data/library.json
data/.backup-meta.json
```

サムネイルキャッシュ（`data/cache/`）と `.tmp` / `.log` ファイルは除外されます。復元は `data/` 以下の同名ファイルを上書きしますが、バックアップにないページを削除することはありません。現在のデータのスナップショットが先に書き込まれます。

## `data/library.json`

```json
{
  "$schema": "https://manga-memo.dev/schemas/mnconfig.schema.json",
  "schemaVersion": 1,
  "kind": "mnconfig",
  "appVersion": "1.0.1",
  "noteTypes": [
    { "id": "proofread", "name": "校正", "color": "#3f9e7a" }
  ],
  "volumes": {
    "点兔第14卷": {
      "title": "ご注文はうさぎですか？ 第14巻",
      "series": "ご注文はうさぎですか？",
      "dirs": { "ja": "raw-ja", "zh": "raw-zh" },
      "defaultDirection": "rtl",
      "chapters": {
        "第1話": {
          "hidden": false,
          "pageOffsets": {
            "zh": { "from": 5, "to": 6 }
          }
        }
      }
    }
  }
}
```

ここに入るのは手動の上書きだけです。エントリのない巻でも自動の言語検出は実行されます。`title` は表示名、`series` はサイドバーのシリーズ名、`dirs` は言語とフォルダーの対応、`defaultDirection` はその巻の新しいページが継承する閲覧方向です。`chapters` は話 ID（フォルダー名）をキーにし、`hidden: true` はファイルを残したままライブラリから外し、`pageOffsets` はある言語の `from` ページ目を参照版の `to` ページ目に合わせます。`appVersion` は書き込んだアプリのバージョン記録で、読み込み時の検証には使われません。

`noteTypes` はカスタムのノート種類を保持します。各項目は `id`、`name`、`#rrggbb` 形式の `color` を持ちます。組み込みの種類（`background`、`vocab`、`rant`）と言語ごとの種類（`lang:<code>`）は暗黙で、ここには書き込まれません。ノートパネルで追加した種類だけが並びます。一覧から種類を削除してもノートは残り、背景知識にフォールバックします。このファイル自体は `schemaVersion: 1` のままです。
