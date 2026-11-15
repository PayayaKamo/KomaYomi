# フォルダー判定ルール（開発者向け）

フォルダー判定ルールは、巻・言語・章・ページがパスのどの階層にあるかを示します。`server/dirRules.ts` の走査器は「パスの階層を受け取り、ページ記録を返す」純粋な関数で、保存と HTTP は `server/library.ts` が担当します。画面から操作したいだけなら、先に[フォルダー判定ルール](/ja/guide/folder-rules)を読んでください。

## ルールの保存場所

ルールは `data/library.json` の `rules` 配列に入ります（`kind` は `mnconfig`）。配列がない、または空のときは内蔵ルールが使われます。

```json
{
  "id": "volume-language-chapter-page",
  "name": "{volume}/{language}/{chapter}/{page}",
  "pattern": "{volume}/{language}/{chapter}/{page}"
}
```

ダイアログの**既定に戻す**がこの形を書き戻し、**ルールを保存**が配列全体を検証してから再走査します。

## プレースホルダー

| プレースホルダー | 別名 | 意味 |
| --- | --- | --- |
| `{series}` | `{seriesName}`、`{work}` | 巻の上にあるシリーズのフォルダー。 |
| `{volume}` | `{vol}`、`{book}` | サイドバーに表示される巻。 |
| `{chapter}` | `{chap}`、`{ch}`、`{episode}` | 章のフォルダー。 |
| `{language}` | `{lang}`、`{locale}` | 言語として認識されるフォルダー。 |
| `{page}` | `{file}`、`{image}`、`{img}` | 画像ファイル。すべてのルールに必須。 |

別名は大文字小文字を区別しません（`{seriesName}` と `{seriesname}` は同じ）。ルールには `{page}` が必要で、`{language}` がない場合は既定の `language` を宣言する必要があります。

`{series}` と `{volume}` の両方が一致すると、巻 id は `"<シリーズ> / <巻>"` になります。同名の巻を持つシリーズが混ざるのを防ぐためです。

## 省略可能な階層とワイルドカード

| 書き方 | 挙動 |
| --- | --- |
| `{chapter}?` | その階層がなくてもよい。まず 1 階層消費を試し、次に飛ばすことを試します。 |
| `*` または `**` | 関心のない 1 階層だけに一致。2 つは完全に同じ意味です。 |
| 通常の文字列 | フォルダー名と一致する必要があります。大文字小文字は区別しません。 |

「0 階層以上」のワイルドカードはありません。深さが可変なら、深さごとにルールを書き、具体的なものから広いものへ並べます。

## `ignore`、`extensions`、`language`

| フィールド | 挙動 |
| --- | --- |
| `ignore` | 決して入らないフォルダー名。大文字小文字を区別しません。有効な全ルールの和集合を使うため、1 つのルールで無視したフォルダーは走査全体で無視されます。 |
| `extensions` | 対象の画像拡張子。先頭のドットは有無どちらでもよく、小文字＋ドットに正規化されます。こちらも有効な全ルールの和集合で、`extensions` を省いたルールは既定の一覧（`.jpg`、`.jpeg`、`.png`、`.webp`、`.gif`、`.avif`、`.bmp`）を加えます。 |
| `language` | `{language}` のないパターン用の既定 id。`{language}` があるときは無視されます。パス区切りは使えません。 |
| `enabled` | `false` にするとファイルには残したまま使いません。 |
| `id` | 安定した識別子。省略すると `rule-<n>` が付き、重複は拒否されます。 |

`ignore` と `extensions` は有効な全ルールの和集合なので、「一般ルールは `.jpg` だけ、狭いルールは `.png` だけ」といった排他はできません。拡張子を変えたいときは各ルールに書きます。一般ルールの一覧も合流する点に注意してください。

## 一致と順序

- ルールは上から順に試し、最初に完全一致したものが使われます。
- パターンは走査ルートに固定されます。ダイアログがサブフォルダーをプレビューするときは、その部分木に対して評価します。
- `{language}` の階層では `normalizeLang` を通します（`ja`、`jp`、`日本語`、`zh-cn`、`cn`、`english` など）。未知のフォルダーは、巻設定で対応付けない限り一致しません。
- `{chapter}` のないルールでは、その巻の全ページが単一の章 `全一話` に入ります。
- `ignore` はルール適用より前に、ディレクトリをたどる段階で確認します。

## よくある構成の完全なルール

### 1. 既定: 巻 / 言語 / 章 / ページ

```text
raw/
  点兔第14卷/
    raw-ja/
      172/
        001.jpg
    raw-zh/
      172/
        001.jpg
```

```json
[
  {
    "id": "default",
    "name": "巻 / 言語 / 章 / ページ",
    "pattern": "{volume}/{language}/{chapter}/{page}"
  }
]
```

### 2. 巻の上にシリーズ、章は省略可、余計なフォルダーを無視

```text
raw/
  きらら/
    点兔第14卷/
      ja/
        172/
          001.jpg
      zh/
        172/
          001.jpg
    covers/
```

```json
[
  {
    "id": "series-volume-language-chapter-page",
    "name": "シリーズ / 巻 / 言語 / 任意の章 / ページ",
    "pattern": "{series}/{volume}/{language}/{chapter}?/{page}",
    "ignore": ["covers", "_extras"],
    "extensions": [".jpg", ".jpeg", ".png"]
  }
]
```

巻は `きらら / 点兔第14卷` として表示されます。章フォルダーのない巻も同じルールで一致します。

### 3. 言語が先頭

```text
raw/
  ja/
    volume-01/
      01/
        001.jpg
  zh/
    volume-01/
      01/
        001.jpg
```

```json
[
  {
    "id": "language-volume-chapter-page",
    "name": "言語 / 巻 / 章 / ページ",
    "pattern": "{language}/{volume}/{chapter}/{page}"
  }
]
```

### 4. 単一言語のフラットなコレクション

```text
raw/
  侦探漫画 第01卷/
    第01话/
      001.jpg
```

```json
[
  {
    "id": "flat-japanese",
    "name": "フラット構成、常に日本語",
    "pattern": "{volume}/{chapter}/{page}",
    "language": "ja"
  }
]
```

### 5. 固定の出版社フォルダー

```text
raw/
  manga/
    volume-01/
      ja/
        01.jpg
```

```json
[
  {
    "id": "publisher-prefix",
    "name": "固定の manga/ プレフィックス",
    "pattern": "manga/{volume}/{language}/{page}"
  }
]
```

通常の文字列の階層は実在しなければなりません。プレビューが空になる一番よくある原因がこれです。

### 6. 1 階層をワイルドカードで飛ばす

```text
raw/
  volume-01/
    scans/
      ja/
        01.jpg
```

```json
[
  {
    "id": "wildcard-level",
    "name": "巻と言語の間に未知のフォルダーが 1 つ",
    "pattern": "{volume}/*/{language}/{page}"
  }
]
```

`*` はちょうど 1 階層だけを消費し、繰り返しません。

## 検証エラー

`validateRules` は配列全体を拒否し、次のいずれかのコードを返します。

| コード | 意味 |
| --- | --- |
| `ERR_RULES_NOT_ARRAY` | 空でない配列ではありません。 |
| `ERR_RULE_NOT_OBJECT` | 要素がオブジェクトではありません。 |
| `ERR_RULE_PATTERN_MISSING` | `pattern` がありません。 |
| `ERR_RULE_PATTERN_ABSOLUTE` | 絶対パス、または `..` を含みます。 |
| `ERR_RULE_PAGE_MISSING` | `{page}` がありません。 |
| `ERR_RULE_LANGUAGE_MISSING` | `{language}` も `language` の既定値もありません。 |
| `ERR_RULE_LANGUAGE_INVALID` | `language` にパス区切りが含まれます。 |
| `ERR_RULE_DUPLICATE_ID` | `id` が重複しています。 |
| `ERR_RULE_UNKNOWN_PLACEHOLDER` | `{...}` が別名表にありません。 |
| `ERR_RULE_EMPTY` | 前後のスラッシュを除くと空です。 |
| `ERR_RULE_PARSE` | 走査中に保存済みルールを解析できませんでした。 |

どのルールにも一致しないファイルは黙って捨てられません。走査結果には `unmatched` 一覧が付き、`WARN_RULE_LEVEL_MISMATCH`、`WARN_RULE_NO_LANGUAGE`、`WARN_UNKNOWN_LANGUAGE_DIR`、`WARN_NO_RULE_MATCHED` などの理由が入ります。ダイアログはプレビューの下にこれを表示します。

## 運用中のライブラリでルールを変える

ページデータは巻 id と章 id をキーに保存されます: `data/pages/<巻>/<章>/<番号>.json`。ルールを変えるとどちらの id も変わり得て、既存のコマやノートは付いてきません。注釈を始める前にルールを確定してください。どうしても後から変える場合は、先にバックアップを取り、変更後にいくつかのページを開いて確認します。

## 関連ページ

- [フォルダー判定ルール](/ja/guide/folder-rules) — ダイアログの操作と落とし穴。
- [データ形式](/ja/development/data-formats) — `library.json` とページのパス。
- [マッチャーのソース](https://github.com/PayayaKamo/KomaYomi/blob/main/server/dirRules.ts)。
