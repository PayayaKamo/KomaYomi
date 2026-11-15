# Folder Rules

Folder rules describe where the volume, language, chapter and page sit inside a path. The scanner in `server/dirRules.ts` is a pure "path segments in, page records out" function; `server/library.ts` owns persistence and the HTTP layer. If you want the user-facing walkthrough, read [Folder Detection Rules](/guide/folder-rules) first.

## Where rules are stored

Rules live in `data/library.json` as a `rules` array (kind `mnconfig`). When the array is missing or empty, the built-in rule applies:

```json
{
  "id": "volume-language-chapter-page",
  "name": "{volume}/{language}/{chapter}/{page}",
  "pattern": "{volume}/{language}/{chapter}/{page}"
}
```

The dialog's **Restore defaults** writes that shape back; **Save rules** validates the whole array before anything is rescanned.

## Placeholders

| Placeholder | Aliases | Meaning |
| --- | --- | --- |
| `{series}` | `{seriesName}`, `{work}` | A series folder above the volume. |
| `{volume}` | `{vol}`, `{book}` | The volume shown in the sidebar. |
| `{chapter}` | `{chap}`, `{ch}`, `{episode}` | A chapter folder. |
| `{language}` | `{lang}`, `{locale}` | A folder recognised as a language. |
| `{page}` | `{file}`, `{image}`, `{img}` | The image file. Required in every rule. |

Aliases are case-insensitive (`{seriesName}` and `{seriesname}` are the same). A rule must contain `{page}`, and must contain `{language}` unless it declares a fallback `language`.

When both `{series}` and `{volume}` match, the volume id becomes `"<series> / <volume>"`, which keeps two series with identically named volumes apart.

## Optional segments and wildcards

| Syntax | Behaviour |
| --- | --- |
| `{chapter}?` | The segment may be missing. The matcher first tries to consume a segment, then tries skipping it. |
| `*` or `**` | Matches exactly one segment you do not care about. Both spellings are identical. |
| Literal text | Must equal the folder name, case-insensitively. |

There is no "zero or more segments" wildcard. If a tree has a variable depth, write one rule per depth and order them from most specific to most general.

## `ignore`, `extensions` and `language`

| Field | Behaviour |
| --- | --- |
| `ignore` | Folder names that are never descended into, matched case-insensitively. The union of every enabled rule is used, so a folder ignored by one rule is ignored for the whole scan. |
| `extensions` | Accepted image extensions, with or without a leading dot. Normalized to lower case with a dot. The union of every enabled rule is used; a rule that omits `extensions` contributes the default list (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.avif`, `.bmp`). |
| `language` | Fallback id for patterns without `{language}`. Ignored when the pattern has a `{language}` segment. Path separators are rejected. |
| `enabled` | `false` keeps a rule in the file without using it. |
| `id` | Stable identifier. Generated as `rule-<n>` when omitted; duplicates are rejected. |

Because `ignore` and `extensions` are unioned across active rules, you cannot use one general rule with `.jpg` and a narrow rule with `.png` to make `.png` exclusive. Put the extension list on every rule that needs a different one, and keep the general rule's list in mind.

## Matching and ordering

- Rules are tried in order; the first full match wins.
- The pattern is anchored to the scanned root. When the dialog previews a subfolder, the pattern is evaluated against that subtree.
- Inside a `{language}` segment, folder names are normalised through `normalizeLang` (`ja`, `jp`, `日本語`, `zh-cn`, `cn`, `english`, and so on). An unknown directory stays unmatched unless it is mapped in volume settings.
- A rule without `{chapter}` puts every page of the volume into the single chapter `全一话`.
- `ignore` is checked while walking, before any rule is applied.

## Complete rule sets for common layouts

### 1. Default: volume / language / chapter / page

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
    "name": "Volume / language / chapter / page",
    "pattern": "{volume}/{language}/{chapter}/{page}"
  }
]
```

### 2. Series above the volume, optional chapter, ignored extras

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
    "name": "Series / volume / language / optional chapter / page",
    "pattern": "{series}/{volume}/{language}/{chapter}?/{page}",
    "ignore": ["covers", "_extras"],
    "extensions": [".jpg", ".jpeg", ".png"]
  }
]
```

Volumes appear as `きらら / 点兔第14卷`. A volume without a chapter folder matches the same rule.

### 3. Language first

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
    "name": "Language / volume / chapter / page",
    "pattern": "{language}/{volume}/{chapter}/{page}"
  }
]
```

### 4. Flat single-language collection

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
    "name": "Flat folders, always Japanese",
    "pattern": "{volume}/{chapter}/{page}",
    "language": "ja"
  }
]
```

### 5. A literal publisher folder

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
    "name": "Literal manga/ prefix",
    "pattern": "manga/{volume}/{language}/{page}"
  }
]
```

The literal segment must exist. This is the most common reason a preview looks empty.

### 6. Wildcard for one ignored level

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
    "name": "One unknown folder between volume and language",
    "pattern": "{volume}/*/{language}/{page}"
  }
]
```

`*` consumes exactly one segment; it does not repeat.

## Validation errors

`validateRules` rejects the whole array and reports one of these codes:

| Code | Meaning |
| --- | --- |
| `ERR_RULES_NOT_ARRAY` | The value is not a non-empty array. |
| `ERR_RULE_NOT_OBJECT` | An entry is not an object. |
| `ERR_RULE_PATTERN_MISSING` | An entry has no `pattern`. |
| `ERR_RULE_PATTERN_ABSOLUTE` | The pattern is absolute or contains `..`. |
| `ERR_RULE_PAGE_MISSING` | The pattern has no `{page}`. |
| `ERR_RULE_LANGUAGE_MISSING` | No `{language}` and no `language` fallback. |
| `ERR_RULE_LANGUAGE_INVALID` | The `language` value contains a path separator. |
| `ERR_RULE_DUPLICATE_ID` | Two rules share an `id`. |
| `ERR_RULE_UNKNOWN_PLACEHOLDER` | A `{...}` name is not in the alias table. |
| `ERR_RULE_EMPTY` | The pattern is empty after trimming slashes. |
| `ERR_RULE_PARSE` | A stored rule could not be parsed during a scan. |

Files that match no rule are not silently discarded: the scan returns an `unmatched` list with a reason such as `WARN_RULE_LEVEL_MISMATCH`, `WARN_RULE_NO_LANGUAGE`, `WARN_UNKNOWN_LANGUAGE_DIR` or `WARN_NO_RULE_MATCHED`. The dialog shows that list under the preview.

## Changing rules on a live library

Page data is keyed by volume id and chapter id: `data/pages/<volume>/<chapter>/<index>.json`. A rule change can rename either id, and existing panels and notes will not follow. Apply rules before annotating a collection. If you must change them later, run **Backup** first and open a few migrated pages afterwards.

## Related

- [Folder Detection Rules](/guide/folder-rules) — the dialog walkthrough and pitfalls.
- [Data formats](/development/data-formats) — `library.json` and page paths.
- [Library source](https://github.com/PayayaKamo/KomaYomi/blob/main/server/dirRules.ts) — the matcher itself.
