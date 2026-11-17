# Export

Export turns a chapter of panels and notes into something you can actually carry: an HTML study document, PNG images for slides, a `.docx` for people who live in Word, or a print view for the PDF crowd.

<figure class="shot">
  <img src="/assets/screenshots/export-dialog.webp" alt="Export dialog with layout templates, scope, languages, image mode and a live preview">
  <figcaption>The export dialog. The left column configures the document; the right side previews the layout and can be resized by dragging the divider.</figcaption>
</figure>

## The problem it solves

Your notes live inside the app, glued to panels. Reviewing them on a tablet, printing them, or dropping a comparison into a slide deck all need a portable artifact that keeps the page image and the matching notes together — without uploading anything.

## Opening the dialog

Press `E`, or click **Export** in the top bar. The dialog always exports the page or chapter you are looking at.

## HTML export

### Title and scope

| Control | What it does |
| --- | --- |
| **Title** | Document title, also used for the suggested file name. |
| **Current page** | Exports only the open page. |
| **Whole chapter (n pages)** | Exports every annotated page in the chapter. |
| **Only pages with notes** | Skips pages without notes; useful for a study-notes collection. |
| **Languages** | Which languages appear in the document. |

### Image mode

| Mode | Behaviour |
| --- | --- |
| **Sibling `.files` folder** (default) | The HTML references images in a folder next to it. Smaller and faster to load. Copy both together. |
| **Bundle into a single file** | Images are inlined as data URLs. One file to share, but a full chapter can be tens of megabytes. |

**Draw panel borders on the original image** overlays the panel rectangles on the exported artwork. This is independent of annotations.

**Only export notes with these tags** filters notes by tag; **Clear filters** removes the selection.

### Layout

Three built-in layout templates:

| Template | Result |
| --- | --- |
| **Image left, notes right** | Manga page on the left, page and panel notes on the right. |
| **Image top, notes below** | The image spans the full width and notes unfold underneath. |
| **Panel comparison** | Each panel shows several languages side by side with its notes. |

Layout templates can be saved under a custom name, exported as JSON and imported again. They live in `data/templates/export.json`. The layout controls are:

| Control | Effect |
| --- | --- |
| **Image column width** | Width of the image column, in percent. |
| **Column gap** | Space between image and notes. |
| **Font size** | Base font scale for the document. |
| **Columns per row** | Number of page blocks per row. |

The layout is remembered automatically. You can also drag the divider in the live preview to set the image width.

<figure class="shot">
  <img src="/assets/screenshots/export-template-custom.webp" alt="Template controls in the export dialog: save the current layout under a name, import JSON, and apply / export / delete saved templates">
  <figcaption>Template controls: save the current layout under a name, import JSON, then apply, export or delete saved templates.</figcaption>
</figure>

### Generating

1. Choose scope, languages, image mode and layout.
2. Click **Generate HTML**.
3. When it finishes, the dialog reports how many pages were exported and where the file went.
4. Use **Open HTML** to open it in the browser, or **Download HTML** to save a copy. With the default image mode, copy the `.files` folder as well.

Files are written to the project's `exports/` folder. The HTML opens directly from disk.

### Printing

The generated HTML includes print styles: backgrounds are removed, the page width is unconstrained, and page blocks avoid breaking mid-image. Open the file in a browser and use the normal **Print** command to produce a PDF via the browser's print dialog.

::: tip Printing to PDF
Choose **PDF (print)** in the export dialog — the print view opens with the browser print dialog, where you pick **Save as PDF**. See [PDF and Word](#pdf-and-word).
:::

## PNG export

The **Export PNG** section produces images directly, without a document:

| Mode | Content |
| --- | --- |
| **Whole page** | The page image with panel borders and annotations. |
| **Current panel** | The selected panel, cropped and aligned. |
| **Trilingual collage** | The selected languages placed side by side for the same panel (or the whole page when no panel is selected). |

Options:

- **Include annotations (n)** — draws the annotation layer into the PNG. The count shows how many marks will be included.
- **Output size** — keeps the source pixels by default; it can also fit Xiaohongshu 3:4 (1080×1440), 1:1, 4:3 and long notes (1080 wide), Instagram 4:5 and 9:16, Pinterest 2:3, 800-wide webtoon strips, and B5 / A4 / A5 at 300 dpi for print. Artwork is scaled with white margins and never cropped, and the choice is remembered.
- Whole-page and current-panel PNG use the **primary (base) language**; the collage uses the selected compare languages.
- **Current panel** is disabled until a panel is selected in the workbench.

PNGs are generated in the browser and land in the browser's download folder. They paste straight into slides, documents or chat.

<figure class="shot">
  <img src="/assets/screenshots/export-options.webp" alt="Export dialog with the scope, language chips, image mode, PNG modes and layout sliders">
  <figcaption>The export dialog with the PNG modes visible. Whole page and current panel use the primary language; the trilingual collage uses the selected languages.</figcaption>
</figure>

<figure class="shot">
  <img src="/assets/screenshots/export-png-modes.webp" alt="The three PNG outputs from one page: whole page, current panel and trilingual collage, with their pixel sizes">
  <figcaption>The three PNG outputs from one page: whole page, current panel and trilingual collage (annotations unchecked for this run).</figcaption>
</figure>

## Share images

The **Share images** section of the export dialog renders ready-to-post images in the common social aspect ratios, so a finished page does not need a second trip through an image editor.

| Preset | Output |
| --- | --- |
| **Cover · 1080×1440 JPEG** | Standard feed cover, JPEG quality 88. |
| **Cover HD · 1242×1656 JPEG** | Slightly larger cover, JPEG quality 90. |
| **Single panel · 1080×1440 JPEG** | One image per detected panel, in reading order, quality 85. |
| **Language compare · 1080×1440 PNG** | Every enabled language side by side in one PNG. |
| **Long page · 1080×3240 max JPEG** | Tall pages are split into strips; the top 1080×1440 is also saved as a cover. |

- **Scope** follows the dialog: the current page or the whole chapter. Progress is reported as `n / total pages`, and skipped pages are listed with a reason (no image in the selected language, no detected panels) rather than failing silently.
- **Language** picks the artwork for the single-panel and cover presets; the compare preset uses all enabled languages.
- **Add page / language bar** draws a small label inside the bottom safe area, never at the edge, so the image still reads correctly when a platform crops it.
- **Bake in annotations** composites the annotation layer, including anchors and leaders, before rendering. Turn it off for clean artwork.
- Files are written to `exports/<batch>/` in the desktop app and to the browser download folder in the web build. Warnings appear when a batch exceeds the 18-image post limit or a single file is about to pass 20 MB.

<figure class="shot">
  <img src="/assets/screenshots/export-share.webp" alt="Share images section of the export dialog with cover, cover HD, single panel, language compare and long page presets">
  <figcaption>Share images: platform-sized presets straight from the dialog — a 1080×1440 cover, one image per panel in reading order, a language compare image and long pages split into strips, with an optional page / language bar and baked annotations.</figcaption>
</figure>

## PDF and Word

The export dialog has three output formats: **HTML**, **Word document** and **PDF (print)**.

### Word (`.docx`)

1. Press `E` and choose **Word document**.
2. Set the scope, languages and note tag filter as usual.
3. Click **Generate Word**, then **Download .docx**.

The document keeps the page images and turns page and panel notes into editable Word text. Annotations are **baked into the page images by default**: the browser composites the vector layer onto each page PNG before generating, so the `.docx` shows the marked artwork. If a composited image does not arrive (the export was interrupted, or the page has no image in the selected languages), that page falls back to the original image and the result carries a `WARN_EXPORT_ANNOTATIONS_UNBAKED` warning. Clear **Include annotations** to always export the untouched pages.

### PDF (print)

1. Choose **PDF (print)** and click **Generate print view**.
2. The print view opens in a new tab and brings up the browser print dialog.
3. Choose **Save as PDF**.

Images are fitted to one page and notes stay with their page. Backgrounds are removed, the page width is unconstrained and page blocks avoid breaking mid-image.

### Plain text / Markdown

Use **Copy page context** or the **Rendered / Source** toggle on a note; the note body is Markdown.

## Export templates

An export template (`.mnexp`) stores the layout and style settings so the same look can be reused or shared. Export and import templates through **Exchange files…** in the sidebar. Imported templates are validated and the original file is backed up under `data/backups/exchange/`.

## Common pitfalls

- **The HTML has broken images.** With the default mode, the `.files` folder must travel with the HTML. Move them together.
- **A single-file export is enormous.** That is expected: every image is inlined. Use the `.files` mode for a whole chapter.
- **A page is missing from the export.** It has no notes and **Only pages with notes** is on, or it has no images in the selected languages.
- **Panel borders are not in the PNG.** PNG export uses the annotation toggle; enable **Include annotations**, and remember that panel borders are drawn from the panel rectangles, not from annotations.
- **Print output is cropped.** Set the browser print scale to “Fit to page” and enable background graphics only if you need the shading.
- **Word ignored the layout.** Paste the rendered HTML rather than the Markdown source; Word keeps HTML tables and images but not the two-column drag width.
- **The `.docx` or PDF button is missing.** Both are in the export dialog: choose **Word document** or **PDF (print)** at the top. Word bakes annotations into the images by default; a `WARN_EXPORT_ANNOTATIONS_UNBAKED` warning means a page did not receive its composited image — generate again.
- **The output folder is not writable.** In a packaged desktop build, `exports/` lives inside the chosen library folder.

<figure class="shot">
  <img src="/assets/screenshots/export-result.webp" alt="Exported HTML opened in a browser: manga pages on the left and page and panel notes on the right">
  <figcaption>The exported HTML opened in a browser: manga on the left, page and panel notes on the right.</figcaption>
</figure>

## Related

- [Notes](/guide/notes) — what ends up in the document.
- [Project Files & Formats](/guide/project-files) — writing back to the opened `.mnproj` or saving a copy.
- [Keyboard Shortcuts](/guide/shortcuts) — `E` opens this dialog.
