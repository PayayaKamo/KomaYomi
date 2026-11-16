---
layout: home
titleTemplate: false
description: "KomaYomi（格读） documentation — local-first, panel-by-panel manga intensive reading. Compare Japanese, Chinese and English editions side by side, pin notes to the artwork, and export study pages; your files never leave your machine."
title: KomaYomi（格读）— local-first manga intensive reading

hero:
  name: KomaYomi（格读）
  text: Read manga panel by panel
  tagline: Japanese, Chinese and English on one page — notes and marks pinned to the drawing. Local-first, no account.
  image:
    src: /assets/screenshots/hero-real-library.webp
    alt: Compare reader with three language panes from a real library; the manga artwork is blurred
  actions:
    - theme: brand
      text: Get started
      link: /guide/introduction
    - theme: alt
      text: Data formats
      link: /data-format

features:
  - title: Panels first
    details: Automatic XY-cut detection with manual drawing, merging, numbering and reusable layout templates. Notes and marks follow the artwork when panels are re-detected or a template is applied, so a re-layout no longer loses work.
  - title: Compare multiple languages
    details: Side-by-side or overlay views, per-language masks, wheel zoom and pan, plus page / panel / anchor / grid alignment with reusable presets.
  - title: Notes that travel
    details: Markdown notes at page or panel scope in typed cards, optional pins on the artwork, tags, sources, a scratch pad, full-text search and one-click "copy context" for pasting into an LLM.
  - title: Portable output
    details: Export HTML with an image folder or as a single embedded file, render page / panel / collage PNGs, share images for social posts, and move everything as a `.mnproj` project.
---

## Why KomaYomi exists

Studying a manga in a second language usually means three windows — the original, a translation, and a dictionary — plus a notes app that never lines up with the page. KomaYomi（格读） puts the same page in Japanese, Chinese and English in one window, cuts it into panels, and lets you pin Markdown notes and marks to the exact drawing. The unit of work is the panel, not the page.

It is a local web application: page images stay in a `raw/` folder, and every panel, note, tag and annotation lives in plain JSON under `data/`. Nothing leaves the machine unless you export it. Bring your own scans; it is a study tool, not a manga host.

Author homepages: [X · @payayakamo](https://x.com/payayakamo) · [note · @payayakamo](https://note.com/payayakamo). These are the author's personal pages, not a product site.

## Try it in three steps

1. **Install or run.** Download a build from [GitHub Releases](https://github.com/PayayaKamo/KomaYomi/releases), or run `npm install && npm run dev` and open `http://127.0.0.1:5173`.
2. **Point it at pages.** Put images under `raw/<volume>/<language>/<chapter>/001.jpg`, or use **File → Open library folder…**.
3. **Open a chapter.** Panels are detected on first open as a draft; read in the compare view, write notes, export.

Full install options, first-run folder layout and panel correction are in [Install & Run](/guide/installation) and [Introduction](/guide/introduction).

## Status at a glance

KomaYomi（格读） is at **1.1.0**. This site separates what works today from what is planned.

<div class="status-list">
  <div><strong>Reading</strong> — library scanning including multi-work roots; three sidebar page-list layouts; panel detection and manual editing; splitting and renumbering; layout templates; compare reader with per-language masks; an original-page view; the enlarged 1:1 image viewer; previous/next panel across page and chapter boundaries with auto-centring; focus mode and read-only mode.</div>
  <div><strong>Notes and marks</strong> — Markdown notes at page or panel scope; typed notes (Background, Vocabulary, Reaction, one type per enabled language, plus custom types and colours); pins on the artwork with grouped popovers; notes search; a single editor; vector annotations with anchor leaders, isolated per language, with a right-click menu; operation history wired to the undo stack.</div>
  <div><strong>Projects and output</strong> — `.mnproj` projects that save back into the opened file; **Save as…** copies in the desktop app (download fallback in the browser); HTML, PNG, PDF (print) and Word export with annotations baked by default; Xiaohongshu-ready share images; backup ZIP and scheduled backups; cache management; WebDAV sources with an offline write queue; atomic page saves with schema validation, `.bak` rotation and a concurrent-write lock; CLI batch tools.</div>
  <div><strong>Built-in demo</strong> — the desktop installer bundles a demo project (about 65 MB of the installer); open it from the welcome screen to explore a real Japanese/Chinese/English volume, and leave the demo to remove its pages and restore the state you had before.</div>
  <div><strong>Planned</strong> — vocabulary-list export; an in-app image format converter (renaming and splitting live in preprocessing); broader integration tests.</div>
</div>

Anything marked <Badge type="warning" text="Planned" /> in this site is **not implemented yet**. If a page describes behavior that is not in the code, treat this note as authoritative and the feature as unavailable.

## The KomaYomi repositories

This site documents the desktop edition. The same project ships in three other forms:

- [KomaYomi](https://github.com/PayayaKamo/KomaYomi) — the full desktop edition (Electron plus a local server) that this documentation covers.
- [KomaYomi-online](https://github.com/PayayaKamo/KomaYomi-online) — a browser-only build that opens `.mnproj` projects, reads, annotates and exports without a server.
- [KomaYomi-mobile](https://github.com/PayayaKamo/KomaYomi-mobile) — a React Native app for Android and iOS; HarmonyOS NEXT is a placeholder for now.
- [KomaYomi-docs](https://github.com/PayayaKamo/KomaYomi-docs) — the generated build of this site, pushed by CI; edit the docs in the main repository instead.

Projects use the same page JSON and the same `.mnproj` format across the editions, so work can move between them.

## Where to go next

- New here? Read [Introduction](/guide/introduction), then [Install & Run](/guide/installation).
- Want the mental model? Start with [Core Concepts](/concepts).
- Building on the JSON or writing a plugin? Go to [Data Formats](/data-format) and [Layout Templates & Plugins](/extending).
- Stuck on a missing page or a broken export? See [FAQ & Troubleshooting](/faq).

::: tip Documentation languages
English is the primary language. A Chinese translation lives under `/zh/` and a Japanese one under `/ja/`. Each page states its status separately.
:::
