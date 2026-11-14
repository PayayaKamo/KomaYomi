# Panel Workbench

The panel workbench is where a page becomes structured data. Detection is a starting point; the workbench is built for correcting it.

<figure class="shot">
  <img src="/shots/panels.svg" alt="Panel workbench with four detected panels (placeholder)">
  <figcaption>Placeholder image. Detected panels are shown as numbered boxes over the page.</figcaption>
</figure>

## Automatic detection

Click **Auto detect**. The server runs the built-in XY-cut detector (`xycut-1.3`) on the selected base language and returns normalized rectangles.

Detection priority when a page is opened or re-detected:

1. **Declarative layout template** bound to the page, chapter or volume (`data/layouts/*.json`).
2. **A matching plugin** in `plugins/` or `data/plugins/`.
3. **Built-in XY-cut detection**.

The toolbar records which source produced the result: *Auto*, *Template* or *Plugin*, plus the detector version and the last edit summary.

The detector filters out common noise:

- very small regions (under ~0.6% of the page area),
- near-empty regions,
- extremely thin strips that are not real panels,
- the narrow vertical *あらすじ* / author-note strip that hugs the left or right page edge. This filter is deliberate: on real samples it would otherwise become a false panel. If your material has a legitimate narrow edge panel, draw it manually.

<Badge type="warning" text="Planned" /> WebP pixel decoding for detection. JPEG and PNG are supported.

## Manual editing

| Operation | How |
| --- | --- |
| Add a panel | Double-click empty space, or click **Add panel**. |
| Move | Drag the box body. |
| Resize | Drag one of eight handles. |
| Nudge | Focus a panel and use the arrow keys; hold `Shift` for a larger step. |
| Multi-select | `Ctrl`-click or `Shift`-click boxes. |
| Merge | Select two or more panels and click **Merge**; the result gets `source: "merged"`. |
| Delete | Select panels and press `Delete`, or click **Delete**. |
| Numeric edit | With one panel selected, type `X` / `Y` / `W` / `H` as percentages. |
| Generate a grid | Set rows, columns and gap, then click **Generate grid**. |

All coordinates are stored normalized to `0..1` relative to the page, so panels remain correct at any display size or export resolution.

## Numbering and reading direction

- Toggle **Numbers** to show panel indices. Order follows the page's reading direction.
- Reading direction is stored per page: `rtl` (right-to-left, top-to-bottom), `ltr` (left-to-right, top-to-bottom) or `ttb` (right-to-left, vertical columns).
- A panel may carry an explicit `number` overriding automatic reading order; otherwise numbering is derived from `rect` and direction.
- The same ordering drives the compare reader and the HTML export.

## Saving

Two save modes, chosen in the toolbar and remembered in the browser:

- **Auto** — edits are debounced and written automatically.
- **Confirm** — edits stay dirty until you click the save check; leaving the page with unsaved changes triggers a browser warning.

Every save updates lightweight metadata in the page JSON: `editCount`, `lastEditedAt` and a short `lastEditSummary` such as `格数 4→5` or `调整格框`. This is an edit counter, not an audit log.

## Panel templates

A panel template captures the panel rectangles of the current page.

1. Give the template a name and click **Save current page as template**.
2. Select it and choose **Apply to this page** or **Apply to chapter**.
3. Applying to a chapter asks for confirmation because existing panels are overwritten.

When the new page has the same number of panels as the old one, panel-scoped notes are remapped by reading order. When the count differs, panel notes are dropped rather than silently attached to the wrong panel. Page-scoped notes are always kept.

Templates are stored under `data/templates/` (panel templates) and can be listed from the CLI with `templates`.

## Layout templates

Panel templates copy rectangles from one page. **Layout templates** are declarative: they describe a grid of rows and cells, and the server expands it into rectangles. They are better for a fixed magazine layout applied to many pages.

You can capture the current page as a layout, bind it to a page/chapter/volume, and apply it in bulk. See [Layout Templates & Plugins](/extending) for the JSON shape and the CLI.

## Manual JSON access

Click **Copy JSON path** to copy the on-disk path of the current page, typically `data/pages/<volume>/<chapter>/<index>.json`. Editing the JSON directly is supported: the server normalizes values on read (clamps rectangles, drops dangling group references, repairs missing ids).

::: tip A safe correction workflow
Auto-detect → fix obvious boxes → merge splash-page panels → save → compare. Avoid re-running detection after hand edits unless you are willing to lose them.
:::
