# Introduction

KomaYomi — **Manga Learner** — is a local-first web app for learning languages with manga: read and annotate the same pages across Japanese, Chinese and English. It pairs pages by page number, detects panels, and gives you a comparison workspace where the same panel can be aligned across languages while you write notes beside it.

It is not a manga reader for casual reading and not a distribution platform. The intended workflow is:

1. Put your own page images under `raw/<volume>/<language>/<chapter>/`.
2. Let the app detect panels, then correct them by hand where needed.
3. Compare languages side by side, mask the ones you are testing yourself on, and align the artwork.
4. Write Markdown notes with tags and sources.
5. Export a study document, PNGs for slides, or a project package for another machine.

<figure class="shot">
  <img src="/shots/compare.svg" alt="Compare reader with three languages (placeholder)">
  <figcaption>Placeholder image. Real screenshots will replace the files in <code>docs/public/shots/</code>.</figcaption>
</figure>

## Who it is for

- **Language learners** comparing a Japanese original with a Chinese or English translation.
- **Translators and proofreaders** checking panel-by-panel wording, tone and omissions.
- **Researchers and note-takers** collecting observations per page or per panel and exporting them.
- **Tool builders** who need a simple, documented JSON format and a plugin hook for panel detection.

## What makes it different

| Aspect | KomaYomi |
| --- | --- |
| Data ownership | Everything is plain files in `raw/`, `data/` and `exports/` on your disk. |
| Panel model | Panels are normalized rectangles stored per page, not baked into images. |
| Comparison | Up to three languages, independent masks, four alignment modes. |
| Notes | Markdown at page or panel scope, with tags, sources and search. |
| Extensibility | Declarative layout templates, JS panel plugins, and a batch CLI. |
| Packaging | HTML with an image folder or a single self-contained file. |

## Current scope

This documentation tracks the code in the repository. The following capabilities are implemented and usable:

<div class="status-list">
  <div><strong>Library</strong> — scans volume folders, recognizes language directory aliases, pairs pages, warns about missing pages and naming mismatches.</div>
  <div><strong>Panels</strong> — automatic detection, manual add/move/resize/merge/delete, numbering, coordinate inputs, grid generator, panel templates, declarative layouts.</div>
  <div><strong>Compare</strong> — 2–3 languages, side-by-side or overlay, per-language blur/solid masks, wheel zoom, pan, page/panel/anchor/grid alignment, saved presets.</div>
  <div><strong>Notes</strong> — page/panel notes, Markdown preview, tags, source links, scratch pad, overview search, copy-with-context.</div>
  <div><strong>Export</strong> — HTML (folder or embedded), PNG (page, panel, collage), backup zip, `.mnproj` project.</div>
  <div><strong>Tooling</strong> — CLI for reports, regression checks, detection, template and alignment batch application.</div>
</div>

The following are **not** in the current code and are marked <Badge type="warning" text="Planned" /> where mentioned:

- PDF, Word (`.docx`) and vocabulary-list export.
- WebDAV / network-drive storage, on-demand image caching and an offline write queue.
- In-app creation of panel *groups* and vector *annotations* (the JSON fields exist, but there is no editing UI yet).
- A packaged desktop installer (Electron runs from source today; no `electron-builder` configuration is committed).

## Design principles

1. **Files over databases.** A page is one JSON file; a chapter is a folder. You can inspect, diff and version everything with ordinary tools.
2. **Degrade gracefully.** A broken plugin falls back to the built-in detector. A malformed page JSON is normalized on read instead of crashing the app.
3. **Reversible operations.** Importing a project or restoring a backup writes a snapshot first. Destructive actions are explicit.
4. **Explain the machine.** The UI shows which detector version produced a page, how many times it was edited and what changed.

Continue with [Install & Run](/guide/installation).
