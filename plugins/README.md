# Directory rules & panel plugins

KomaYomi reads two kinds of user extensions from this folder:

| Folder / file                              | Purpose                                                 |
| ------------------------------------------ | ------------------------------------------------------- |
| **Directory rules** (configured in the UI) | Describe where page images live. No code required.      |
| `plugins/*.mjs`                            | Custom panel splitting (how a page is cut into panels). |

Directory _rules_ are stored in `data/library.json` and edited in the app
(**目录识别… / Directory rules…** in the sidebar footer). Panel _plugins_ are
plain ES modules in this folder.

---

## 1. Directory rules

A rule is a path pattern with placeholders. Rules are tried in order; the first
rule that matches a file wins. Unmatched images are listed in the preview panel
with a reason, so a folder that silently disappears can be diagnosed.

Supported placeholders:

| Placeholder  | Meaning                  | Aliases                       |
| ------------ | ------------------------ | ----------------------------- |
| `{series}`   | Series folder (optional) | `{seriesName}`, `{work}`      |
| `{volume}`   | Volume / book folder     | `{vol}`, `{book}`             |
| `{chapter}`  | Chapter folder           | `{chap}`, `{ch}`, `{episode}` |
| `{language}` | Language folder          | `{lang}`, `{locale}`          |
| `{page}`     | Image file               | `{file}`, `{image}`, `{img}`  |

Extras:

- `?` after a placeholder makes the segment optional: `{chapter}?`.
- `*` matches any single segment.
- `ignore: ["_extras"]` skips those folders entirely while walking.
- `extensions: [".jpg", ".png"]` narrows the accepted files.
- `language: "ja"` is the fallback language for flat structures that have no
  language folder.

Language folders are recognised from common spellings: `ja/jp/日/日本語/日文`,
`zh/zh-cn/cn/tw/中文/繁中`, `en/en-us/us/english/英文`, and more. Unknown
language folders are reported; the volume settings dialog lets you map them by
hand.

### Examples

All examples are arrays, ready to paste into the editor.

**1. One volume, one chapter, three languages**

```json
[{ "id": "vol-lang-page", "name": "Volume / Language / Page", "pattern": "{volume}/{language}/{page}" }]
```

**2. Series with many volumes (series / volume / chapter / language / page)**

```json
[
  {
    "id": "series-vol-ch-lang-page",
    "name": "Series / Volume / Chapter / Language / Page",
    "pattern": "{series}/{volume}/{chapter}/{language}/{page}"
  }
]
```

**3. Language first**

```json
[{ "id": "lang-ch-page", "name": "Language / Chapter / Page", "pattern": "{language}/{chapter}/{page}" }]
```

**4. Language in the middle (common for scanned releases)**

```json
[
  {
    "id": "vol-ch-lang-page",
    "name": "Volume / Chapter / Language / Page",
    "pattern": "{volume}/{chapter}/{language}/{page}"
  }
]
```

**5. Flat folder, single language** — no language segment at all

```json
[
  {
    "id": "flat-ja",
    "name": "Flat folder (Japanese)",
    "pattern": "{volume}/{chapter}?/{page}",
    "language": "ja",
    "ignore": ["_extras", "covers"]
  }
]
```

**6. Several rules, most specific first** — a library that mixes layouts

```json
[
  { "id": "series", "pattern": "{series}/{volume}/{chapter}/{language}/{page}" },
  { "id": "default", "pattern": "{volume}/{language}/{chapter}/{page}" }
]
```

Notes:

- `volume` (or `series / volume`) becomes the volume id used for
  `data/pages/<volume>/<chapter>/<page>.json`. Renaming the folder therefore
  disconnects existing annotations for that volume — rename through the app, or
  move the matching JSON folder too.
- The default rule `{volume}/{language}/{chapter}/{page}` matches the historical
  `raw/<volume>/<language>/<chapter>/<page>` layout, so existing libraries keep
  working with no configuration.
- Editing rules previews results live; nothing is written until **Save rules**.

---

## 2. Panel plugins

Drop a `.mjs`, `.js` or `.cjs` file into this folder (or into
`data/plugins/`). Files are loaded in alphabetical order; the first plugin whose
`match` rules pass is used. A plugin may also be placed in `data/plugins/`,
which is not version controlled.

```js
// plugins/example-2x2-grid.mjs
export default {
  name: 'example-2x2-grid',
  // All fields are optional; string = case-insensitive substring, RegExp = test()
  match: { volume: /example/i, chapter: 'Ch01', file: /^0/ },
  panels({ width, height, volume, chapter, pageIndex, filename }) {
    const gap = 0.01;
    const w = (1 - gap) / 2;
    const h = (1 - gap) / 2;
    return [
      { x: 0, y: 0, w, h },
      { x: w + gap, y: 0, w, h },
      { x: 0, y: h + gap, w, h },
      { x: w + gap, y: h + gap, w, h },
    ];
  },
};
```

- `panels(info)` returns `PanelRect[]` or `{ panels, warnings }`.
- `PanelRect` is `{ x, y, w, h }` in `0..1` page coordinates; values are clamped.
- `info` = `{ width, height, volume, chapter, pageIndex, filename }`.
- The function may be `async`.
- If it throws, times out (2500 ms) or returns no panels, KomaYomi falls back to
  the built-in detector and shows a visible warning — a broken plugin never
  leaves the page blank.
- Priority when splitting a page: page layout template > chapter/volume template
  > plugin > automatic detector.

The CLI can re-run a specific plugin in bulk:

```bash
node scripts/manga-cli.ts detect --volume "<volume>" --chapter "<chapter>" --plugin example-2x2-grid --apply
```

> Panel plugins execute with the same privileges as the app. Only install
> plugins you trust.
