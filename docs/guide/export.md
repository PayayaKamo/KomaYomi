# Export

The export dialog turns a page or a whole chapter into something you can read, print or share. Open it with `E` or the **Export** button.

<figure class="shot">
  <img src="/shots/export.svg" alt="Export dialog with template, scope, language and image options (placeholder)">
  <figcaption>Placeholder image. The left column configures the export; the right side previews the layout.</figcaption>
</figure>

## Export formats

| Format | Where it is produced | Output |
| --- | --- | --- |
| **HTML** | Server (`POST /api/export`) | An `.html` file plus a sibling `.files/` image folder, or one self-contained file. |
| **PNG** | Browser canvas | A downloaded image for the page, the selected panel, or a multilingual collage. |
| **Backup ZIP** | Server | A zip of `data/` for safekeeping. See [Remote Storage & Backup](/remote-backup). |
| **`.mnproj` project** | Server | A portable project package with or without images. See [Remote Storage & Backup](/remote-backup). |

<Badge type="warning" text="Planned" /> PDF export, Word (`.docx`) export and a vocabulary-list export. Only HTML and PNG are implemented today.

## HTML layout templates

| Template | Layout |
| --- | --- |
| **Image left, notes right** (`two-column`) | Page image on the left, page and panel notes on the right. |
| **Image top, notes bottom** (`stack`) | Full-width image with notes below. |
| **Panel comparison** (`compare-wide`) | Panel-by-panel rows, each language side by side, with that panel's notes underneath. |

The panel comparison template uses the `columns` setting to decide how many panels per row.

## Options

**Scope** — current page or the whole chapter. In chapter scope, pages without panel data are skipped with a warning.

**Languages** — any subset of `JA`, `ZH`, `EN`. At least one is required.

**Image mode**

- **Folder (default)** — images are copied to `<name>.files/` and the HTML references them with relative paths. Smaller and faster to generate.
- **Single file** — images are embedded as data URLs. Easy to send to someone, but a whole chapter can reach tens of megabytes.

**Annotations** — include notes, filter by tags, and optionally only export pages that have notes.

**Panel boxes** — draw the detected panel rectangles and their numbers on the page image.

**Layout** — image column width, column gap, font scale and panel columns.

**Alignment** — the per-language `{ x, y, scale }` offsets from the compare reader are applied when cropping, so the export matches what you saw.

## Output location

Generated files are written under `exports/` at the repository root. The dialog shows the resulting path and a download link. In the browser app, `/exports/...` is served by the local server.

::: tip Sharing an export
For the folder mode, copy the `.html` file **and** the sibling `.files` directory together. Opening the HTML alone will show missing images. For single-file mode, copy only the HTML.
:::

## PNG export

Three modes, all rendered in the browser and downloaded directly:

| Mode | Content |
| --- | --- |
| **Page** | The full page in the current preferred language. |
| **Panel** | The selected panel in the current preferred language. Requires a selected panel. |
| **Collage** | The selected languages side by side, each with a language label. If a panel is selected, that panel is used; otherwise the page. |

PNG mode is intended for slides and documents: drop the image into PowerPoint or Word without re-cropping. The output uses the page image resolution and the alignment offsets.

## Export templates

Layout-only settings can be saved as a named export template:

- **Save** the current layout with a name.
- **Apply** a saved template to the current dialog.
- **Export** a template to a file and **import** it on another machine.
- **Delete** a template you no longer need.

Templates are stored in `data/templates/export.json`. The most recent layout is also remembered in the browser, so reopening the dialog keeps your last settings.

## Notes in the output

- Page-scoped notes appear under "page notes".
- Panel-scoped notes appear beside their panel (or in the panel row for the comparison template).
- Tags are rendered as chips and are filterable at export time.
- Sources are included in the note body when present.
- Markdown is rendered with the same renderer used in the app, so headings, lists, tables, code and quotes survive the export.

## Print

The generated HTML includes print styles: each page starts on a new sheet, and panels and notes avoid page breaks inside a block. Use the browser's **Print → Save as PDF** if you need a PDF today; a native PDF exporter is <Badge type="warning" text="Planned" />.
