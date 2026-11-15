# Export Templates

An export template stores the settings of the export dialog so you can reuse a layout without re-typing it. A template never stores which pages to export — volume, chapter, page range and offsets are chosen at export time.

For the end-user view of exporting, see [Export](/guide/export).

## Where templates live

| File | Contents |
| --- | --- |
| `data/templates/export.json` | An array of template objects, each with the same envelope as an exchange file. |
| `<name>.mnexp` | One template, exported for sharing or backup. |

The dialog reads the array through `GET /api/export-templates` and writes it through `POST /api/export-templates` (save) and `DELETE /api/export-templates?id=…`. Import and export of `.mnexp` files go through the exchange endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/exchange/export-template/export` | Download one template as `.mnexp`; body is `{ "templateId": "…" }` (or `{ "id": "…" }`). |
| `POST` | `/api/exchange/export-template/import` | Import an uploaded `.mnexp`; body is `{ "data": "<file text>" }`. Missing `id` / `name` / `createdAt` are filled in, and an existing `id` is replaced by the imported template. |

## Fields you can customize

| Field | Type | UI range | Meaning |
| --- | --- | --- | --- |
| `template` | `two-column` \| `stack` \| `compare-wide` | — | Page layout. `two-column` puts images left and notes right; `stack` stacks languages; `compare-wide` uses a wide image grid. |
| `title` | string | — | Heading at the top of the exported page. |
| `languages` | string[] | — | Languages included, in display order. Any language id found in the library is accepted. |
| `embedImages` | boolean | — | Inline images as data URLs instead of linking files. |
| `showPanelBoxes` | boolean | — | Draw panel outlines over each image. |
| `includeNotes` | boolean | — | Include notes in the document. |
| `onlyWithNotes` | boolean | — | Skip pages that have no notes. |
| `print` | boolean | — | Emit a print-ready page that opens the browser print dialog (Save as PDF). |
| `noteFilterTags` | string[] | — | Show only notes carrying one of these tags; empty means no tag filter. |
| `pageWidthRatio` | number | 28–75 | Image column width as a percentage of the content width. |
| `columnGap` | number | 0–64 | Gap between columns, in pixels. |
| `fontScale` | number | 0.8–1.4 | Note text scale. `1` is 100%. |
| `columns` | number | 1–4 | Panels per row in the panel-compare layout. |

`volume`, `chapter`, `pageIndices` and `offsets` are part of the runtime `ExportConfig` but are deliberately excluded from saved templates.

## A complete `.mnexp`

```json
{
  "$schema": "https://manga-memo.dev/schemas/mnexp.schema.json",
  "schemaVersion": 1,
  "kind": "mnexp",
  "appVersion": "0.1.0",
  "id": "exp-1712345678901",
  "name": "Left image, notes right",
  "createdAt": "2026-05-12T10:00:00.000Z",
  "config": {
    "template": "two-column",
    "title": "漫画对照批注",
    "languages": ["ja", "zh"],
    "embedImages": false,
    "showPanelBoxes": false,
    "includeNotes": true,
    "onlyWithNotes": false,
    "noteFilterTags": ["语气"],
    "pageWidthRatio": 52,
    "columnGap": 24,
    "fontScale": 1.1,
    "columns": 1
  }
}
```

`config` is partial in storage: a template saved from the dialog contains every field it controls, but a hand-written file may omit keys and let the defaults fill them (`two-column`, `漫画对照批注`, `ja`/`zh`/`en`, `pageWidthRatio` 46, `columnGap` 28, `fontScale` 1, `columns` 1).

## Applying a template

- **In the dialog.** Open Export, pick a template from the list, then adjust the page range if needed. Saving stores the current layout under a name.
- **By file.** Exchange dialog → **Import** → choose the `.mnexp`. It appears in the template list immediately. If a template with the same `id` exists, the import replaces it.
- **By API.** `POST /api/export` accepts a full `ExportConfig`; build it from the template's `config` plus the scope you want:

```json
{
  "volume": "点兔第14卷",
  "chapter": "172",
  "pageIndices": [0, 1, 2],
  "template": "two-column",
  "title": "漫画对照批注",
  "languages": ["ja", "zh"],
  "embedImages": false,
  "offsets": { "zh": { "x": 0.01, "y": 0, "scale": 1.02 } },
  "showPanelBoxes": false,
  "includeNotes": true,
  "onlyWithNotes": false,
  "noteFilterTags": ["语气"],
  "pageWidthRatio": 52,
  "columnGap": 24,
  "fontScale": 1.1,
  "columns": 1
}
```

## Unknown fields

`exportConfigSpec` in `shared/format.ts` allows unknown keys, so a template written by a future version survives a round trip through this one. The current UI ignores keys it does not render; they are not deleted. `print` is a good example of a field the exporter understands even though older docs did not list it.

## When a template seems to do nothing

| Symptom | Likely cause |
| --- | --- |
| Imported template does not appear | The dialog list is loaded once; reopen the dialog. The API validates the whole file and rejects a malformed `config` with a field path. |
| `languages` shows an unexpected order | The export uses the template order, filtered to languages that exist in the selected volume. |
| Pagination differs from the preview | `pageWidthRatio`, `columnGap` and `fontScale` affect print/PDF output; the on-screen preview approximates them. |
| The same name appears twice | Imports with a colliding `id` keep the name and add a suffix, so two templates can share a label. Rename in the dialog after import. |
