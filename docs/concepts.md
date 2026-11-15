# Core Concepts

Five objects explain almost everything in KomaYomi. They are also the five things people mix up most often, so the definitions here are worth a slow read.

## Volume → chapter → page

```text
raw/<volume>/<language>/<chapter>/<page images>
```

- A **volume** is a top-level folder: one book, one magazine issue, one collection.
- A **chapter** is a folder inside a language directory. Chapters are unioned across languages.
- A **page** is the *n*-th image after natural sorting within a chapter. Pages are paired across languages by position, not by filename.

Each page has a stable identity: `(volume, chapter, pageIndex)` with a **0-based** `pageIndex` in JSON and a 1-based number in the UI.

## Panel

A **panel** is a rectangle on a page, stored normalized to `0..1`:

```json
{ "id": "p1", "rect": { "x": 0.05, "y": 0.04, "w": 0.42, "h": 0.30 }, "source": "auto" }
```

- `source` is `auto`, `manual` or `merged`.
- `number` optionally overrides automatic reading order.
- Panel ids are local to the page (`p1`, `p2`, …).
- Panels are language-independent: one set of rectangles applies to every language of that page.

## Group

A **group** is a named collection of panel ids, used for content that spans several panels, such as a double-page spread or a large illustration.

```json
{ "id": "g1", "name": "跨页大图", "panelIds": ["p2", "p3"], "number": 1 }
```

Groups are part of the page JSON and are preserved by reads, writes, imports and exports. Create them in the panel workbench by selecting panels and clicking **Group**; colour, name, order, merge, split and delete are editable in the **Groups** panel. See [Panel Workbench](/guide/panels#groups).

## Note

A **note** is Markdown text attached to a page or a panel, with tags and an optional source. It is the primary annotation object.

## Annotation

An **annotation** is a vector overlay on a page or panel: arrow, rectangle, ellipse, highlight, text, badge, mosaic or freehand pen. Coordinates are normalized to the scope box.

```json
{
  "id": "a1",
  "kind": "arrow",
  "scope": "panel",
  "panelId": "p2",
  "points": [{ "x": 0.1, "y": 0.2 }, { "x": 0.8, "y": 0.7 }],
  "color": "#c2410c",
  "width": 3
}
```

The data model, normalization and project import/export support annotations, including a page-level `annotationsVisible` switch. The panel workbench exposes drawing tools for arrows, rectangles, ellipses, highlights, freehand pen, text, badges and mosaic blocks; annotations are preserved by imports and exports.

## Alignment

**Alignment** is a per-language transform applied in the compare reader and at export:

```json
{ "x": 0.02, "y": -0.01, "scale": 1.05 }
```

- `x`, `y` are fractions of the panel width/height.
- `scale` is clamped to `0.2..4`.
- Offsets can be stored per page (`offsets`) or per panel (`panelOffsets`).
- The page selects one `alignMode`: `page`, `panel`, `anchors` or `grid`.
- `gridStep` is a percentage (0.1–10, default 1).

## Reading direction

`readingDirection` is one of:

| Value | Meaning |
| --- | --- |
| `rtl` | Right-to-left, top-to-bottom (default for Japanese manga). |
| `ltr` | Left-to-right, top-to-bottom. |
| `ttb` | Vertical columns, right-to-left. |

It determines panel numbering and the order of notes in the export.

## Language codes

The app ships with three built-in languages: `ja` (日本語), `zh` (中文) and `en` (English). A library may detect more at scan time — any language folder is accepted, and its normalized folder name becomes the language id. A volume can have as many languages as you map; the UI disables languages a page does not have.

## Page document

Everything above is persisted in a single **page document** (`PageDoc`) per page, with `schemaVersion: 1`. See [Data Formats](/data-format) for every field.

## Project package

A **`.mnproj` project** is a zip containing the page documents, templates, presets and manifest, plus either image references or the images themselves. It is how you move work between machines. See [Remote Storage & Backup](/remote-backup).

## Mental model

```text
Library
└── Volume (raw/<volume>)
    └── Chapter (raw/<volume>/<lang>/<chapter>)
        └── Page (paired by index)
            ├── Panel[]  ──────────┐
            ├── Note[] (page|panel)│
            ├── Group[]            │  all in one page JSON
            ├── Annotation[]       │
            └── Alignment offsets ─┘
```

The image files are read-only inputs. All work is in `data/` — your scans stay yours, untouched.
