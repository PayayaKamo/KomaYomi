# Introduction

KomaYomi — **Manga Learner** — is a local-first web app for reading manga in more than one language at once. Maybe you are learning Japanese with one eye on the translation, maybe you are doing scanlation and want to check your typesetting against the raw, maybe you just need to know how that one line was handled in the official release. KomaYomi splits a page into panels, lines up the same panel across Japanese, Chinese and English, and lets you pin Markdown notes — TL notes, typesetting questions, vocabulary — to the exact panel they belong to.

It is not a general-purpose manga reader and not a distribution platform. Everything runs on your own machine, against your own image folders.

## The problem it solves

Translations are easiest to study panel by panel, not page by page. But three scans of the same book almost never line up: the page is shifted, the panel is cropped differently, the lettering sits somewhere else. A normal image viewer gives you one zoom level, no notes, and no way to say "this balloon, in these three editions".

KomaYomi adds the missing middle layer:

1. **Structure** — panels are detected and stored as normalized rectangles, so your boxes survive any zoom, window size or export resolution.
2. **Alignment** — each language can be nudged independently until the same panel really overlaps. Yes, finally.
3. **Notes** — every remark is scoped to a page or a panel, in Markdown, with tags and sources. "I'll remember it later" is no longer a plan.

## The workflow

| Step | What you do | Page |
| --- | --- | --- |
| 1 | Get the scans in order: `raw/<volume>/<language>/<chapter>/01.jpg`, or point the app at a folder you already have. | [Preparing & Renaming Images](/guide/preprocess), [Library & Import](/guide/gallery) |
| 2 | Open a page, let it auto-split, then fix the boxes by hand. Detection is a draft, not a verdict. | [Panel Workbench](/guide/panels) |
| 3 | Read 2–3 languages side by side or in overlay, align them, mask the ones you are testing yourself on. | [Compare Reader](/guide/compare) |
| 4 | Write page and panel notes with tags, sources and screenshots. TL notes very much welcome. | [Notes](/guide/notes) |
| 5 | Export a study HTML, PNGs for slides, or a project package for another machine. | [Export](/guide/export) |

## A tour of the screen

<figure class="shot">
  <img src="/assets/screenshots/panel-workspace.png" alt="Panel workbench with a manga page, detected panels, resize handles and the annotation toolbar">
  <figcaption>The panel workbench. Top bar: page navigation, Panels / Compare, reading order, theme, interface language, Notes and Export. Left: library. Right: notes. Middle: the page with panel boxes — where you will spend most of your time.</figcaption>
</figure>

The window has five regions that never move, so muscle memory can take over:

- **Top bar** — brand (back to the library), volume / chapter / page, `‹` `›` page arrows, the save indicator, the **Panels / Compare** switch, the reading-direction selector, the UI theme, the interface language, **Notes** and **Export**.
- **Library sidebar** (`S`) — volumes → chapters → pages, with per-page warnings and the entry points for adding a manga, folder rules, project files, exchange files and backup.
- **Stage** — the panel workbench or the compare reader, depending on the view switch.
- **Notes column** (`N`) — page notes, panel notes, overview search and the scratchpad.
- **Pane splitters** — drag the vertical handle between library and stage, or between stage and notes, to resize; double-click to reset.

A page can be in one, two or three languages. The language chips in the compare reader are enabled only for languages that exist on the current page.

## The first ten minutes

1. Start the app (`npm run dev` or the desktop build) and open `http://127.0.0.1:5173`.
2. Put one volume under `raw/` — or click **＋ Add manga** in the sidebar and point it at an existing folder.
3. Click a page in the sidebar. The first open runs automatic panel detection and saves the result to `data/pages/`.
4. Switch to **Compare** (`C`), pick `JA` and `ZH`, and drag one pane until the panels line up. One panel at a time beats wrestling the whole page.
5. Open **Notes** (`N`), select a panel, and write your first note. Press `Ctrl+Enter` to save.
6. Press `E` to export an HTML file and open it in a browser.

## What is implemented

<div class="status-list">
  <div><strong>Library</strong> — scans volumes, recognizes language folder aliases, pairs pages by sorted position, warns about missing pages and naming mismatches.</div>
  <div><strong>Panels</strong> — automatic XY-cut detection, add / move / eight-direction resize / merge / group / delete, numbering, percentage inputs, grid generator, panel templates, declarative layouts, plugins, cross-session page history.</div>
  <div><strong>Annotations</strong> — arrow, rectangle, ellipse, highlighter, freehand pen, text, number badge and mosaic, page-level visibility switch, PNG export support.</div>
  <div><strong>Compare</strong> — 2–3 languages, side-by-side or overlay, per-language blur/solid masks, wheel zoom, pan, page/panel/anchor/grid alignment, saved presets, custom language order.</div>
  <div><strong>Notes</strong> — page/panel notes, Markdown with a toolbar and live preview, tags, sources, attached images, overview search, copy-for-LLM, scratchpad.</div>
  <div><strong>Export</strong> — HTML (image folder or single file), PNG (whole page, current panel, trilingual collage), PDF via the browser print dialog, Word (`.docx`) with page images and notes, panel-border overlay, print styles, export templates.</div>
  <div><strong>Storage</strong> — local folders, mounted network shares and WebDAV, with on-demand image fetching and a bounded LRU cache.</div>
  <div><strong>Portability</strong> — `.mnproj` project packages, `.mntpl` / `.mnexp` / `.mnpage.json` exchange files, backup and restore ZIPs, versioned schemas.</div>
</div>

## What is not implemented

These items are marked <Badge type="warning" text="Planned" /> wherever they appear:

- Vocabulary-list export. PDF and Word are available as **PDF (print)** and **Word document** in the export dialog.
- Scheduled automatic backups.
- An in-app image converter or batch renamer. Prepare files before importing (see [Preparing & Renaming Images](/guide/preprocess)).
- A native mobile app. The web UI does work in a narrow browser window (see below).

<figure class="shot">
  <img src="/assets/screenshots/mobile-narrow.png" alt="Compare reader in a narrow window with the language panes stacked vertically">
  <figcaption>Narrow window: panes stack vertically, the library becomes a drawer. A responsive web layout, not a native app — but it still works on a phone-sized screen.</figcaption>
</figure>

## Light and dark

The UI theme follows the system by default and can be fixed to light or dark from the top bar. The exported HTML is light-only, so screenshots and printouts stay consistent.

<figure class="shot">
  <img src="/assets/screenshots/theme-light.png" alt="Compare reader in the light theme">
  <figcaption>Light theme.</figcaption>
</figure>

<figure class="shot">
  <img src="/assets/screenshots/theme-dark.png" alt="Compare reader in the dark theme">
  <figcaption>Dark theme.</figcaption>
</figure>

## Common pitfalls

- **Nothing appears in the library.** The sidebar only scans `raw/`; add a folder or mount a remote tree first. See [Library & Import](/guide/gallery).
- **Panels are wrong on the first page.** Detection is a draft, not a verdict. Fix the boxes before writing panel notes; re-running detection later discards hand edits.
- **A language chip is greyed out.** That language has no image on this page. Check page counts and the volume language mapping.
- **Notes seem to disappear on another machine.** Notes live in `data/`, images in `raw/`; move both, or export a `.mnproj`. See [Project Files & Formats](/guide/project-files).
- **An image request fails offline.** Only pages that were opened before going offline are cached. See [Remote Storage & Backup](/guide/remote).

## Where to go next

- New install: [Install & Run](/guide/installation).
- Images not ready yet: [Preparing & Renaming Images](/guide/preprocess).
- Ready to add images: [Library & Import](/guide/gallery).
- Folders have an unusual shape: [Folder Detection Rules](/guide/folder-rules).
- Looking for a key: [Keyboard Shortcuts](/guide/shortcuts).
- Something is wrong: [FAQ & Troubleshooting](/faq).
