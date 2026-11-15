# エクスポートテンプレート

書き出しテンプレートは、エクスポートダイアログの設定を保存して再利用するためのものです。どのページを書き出すかは保存しません。巻、章、ページ範囲、位置合わせは書き出し時に選びます。

利用者向けの説明は[エクスポート](/ja/guide/export)にあります。

## 保存場所

| ファイル | 内容 |
| --- | --- |
| `data/templates/export.json` | テンプレートの配列。各要素は交換ファイルと同じエンベロープを持ちます。 |
| `<名前>.mnexp` | 共有やバックアップ用の単体テンプレート。 |

ダイアログは `GET /api/export-templates` で配列を読み、`POST /api/export-templates` で保存、`DELETE /api/export-templates?id=…` で削除します。`.mnexp` の入出力は交換用のエンドポイントを使います。

| メソッド | パス | 用途 |
| --- | --- | --- |
| `POST` | `/api/exchange/export-template/export` | テンプレートを 1 つ書き出す。本文は `{ "templateId": "…" }`（`{ "id": "…" }` も可）。 |
| `POST` | `/api/exchange/export-template/import` | `.mnexp` を取り込む。本文は `{ "data": "<ファイル本文>" }`。`id` / `name` / `createdAt` がなければ補い、同じ `id` が既にあれば取り込んだ側で置き換えます。 |

## カスタマイズできるフィールド

| フィールド | 型 | 画面の範囲 | 意味 |
| --- | --- | --- | --- |
| `template` | `two-column` \| `stack` \| `compare-wide` | — | ページ構成。`two-column` は左に画像・右にノート、`stack` は言語ごとに積み、`compare-wide` は横広の画像グリッド。 |
| `title` | string | — | 書き出したページの見出し。 |
| `languages` | string[] | — | 含める言語と表示順。ライブラリにある任意の言語 id を受け付けます。 |
| `embedImages` | boolean | — | 画像をファイル参照ではなく data URL として埋め込みます。 |
| `showPanelBoxes` | boolean | — | 画像の上にコマ枠を描きます。 |
| `includeNotes` | boolean | — | 文書にノートを含めます。 |
| `onlyWithNotes` | boolean | — | ノートが 1 つもないページを飛ばします。 |
| `print` | boolean | — | 印刷向けのページを生成し、開いたときにブラウザーの印刷（PDF 保存）を呼び出します。 |
| `noteFilterTags` | string[] | — | 指定タグのいずれかを持つノートだけを表示。空配列なら絞り込みません。 |
| `pageWidthRatio` | number | 28–75 | 画像列の幅を内容幅に対するパーセントで指定。 |
| `columnGap` | number | 0–64 | 列の間隔（ピクセル）。 |
| `fontScale` | number | 0.8–1.4 | ノート文字の倍率。`1` で 100%。 |
| `columns` | number | 1–4 | コマ比較レイアウトで 1 行に並べるコマ数。 |

`volume`、`chapter`、`pageIndices`、`offsets` は実行時の `ExportConfig` に含まれますが、テンプレートには保存しません。

## 完全な `.mnexp`

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
    "noteFilterTags": ["語気"],
    "pageWidthRatio": 52,
    "columnGap": 24,
    "fontScale": 1.1,
    "columns": 1
  }
}
```

保存時の `config` は部分オブジェクトです。ダイアログから保存したテンプレートには管理下の全フィールドが入りますが、手書きのファイルはキーを省いても既定値で補えます（`two-column`、`漫画比較メモ`、`ja`/`zh`/`en`、`pageWidthRatio` 46、`columnGap` 28、`fontScale` 1、`columns` 1）。

## テンプレートの適用

- **ダイアログから。** エクスポートを開き、一覧からテンプレートを選び、必要ならページ範囲を調整します。保存すると現在の構成が新しいテンプレートとして残ります。
- **ファイルから。** 交換ダイアログ → **取り込み** → `.mnexp` を選択。すぐ一覧に出ます。同じ `id` がある場合は、取り込んだ側が既存を置き換えます。
- **API から。** `POST /api/export` は完全な `ExportConfig` を受け取ります。テンプレートの `config` に今回の範囲を足して送ります。

```json
{
  "volume": "点兔第14卷",
  "chapter": "172",
  "pageIndices": [0, 1, 2],
  "template": "two-column",
  "title": "漫画比較メモ",
  "languages": ["ja", "zh"],
  "embedImages": false,
  "offsets": { "zh": { "x": 0.01, "y": 0, "scale": 1.02 } },
  "showPanelBoxes": false,
  "includeNotes": true,
  "onlyWithNotes": false,
  "noteFilterTags": ["語気"],
  "pageWidthRatio": 52,
  "columnGap": 24,
  "fontScale": 1.1,
  "columns": 1
}
```

## 未知のフィールド

`shared/format.ts` の `exportConfigSpec` は未知のキーを許可するため、将来の版が書いたテンプレートも今の版を通って欠けずに残ります。現在の画面が知らないキーは描画されませんが、削除もされません。`print` がその例で、書き出し側は理解していますが、古い資料には載っていませんでした。

## テンプレートが効かないように見えるとき

| 症状 | 考えられる原因 |
| --- | --- |
| 取り込んだのに一覧にない | 一覧はダイアログを開いたときに 1 度だけ読みます。開き直してください。API はファイル全体を検証し、`config` が不正ならフィールドパス付きのエラーを返します。 |
| `languages` の順が違う | 書き出しはテンプレートの順ですが、選択した巻に実在する言語だけに絞られます。 |
| プレビューと改ページが違う | `pageWidthRatio`、`columnGap`、`fontScale` は印刷 / PDF 出力に効きます。画面のプレビューは近似です。 |
| 同じ名前が 2 つある | 同じ `id` の取り込みは置き換えです。2 つ見えるならファイル内の `id` が異なります。取り込み後にダイアログで名前を変えてください。 |
