---
layout: home
titleTemplate: false
description: "KomaYomi (Koma = manga panel, Yomi = reading) documentation — a local-first manga panel reader for language study: compare Japanese, Chinese and English pages, detect panels, align artwork and take notes."
title: KomaYomi — a local-first manga panel reader

hero:
  name: KomaYomi
  text: Manga Panel Reader
  tagline: 日本語はすべて漫画から学んだ~
  image:
    src: /assets/screenshots/hero-real-library.png
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
    details: Markdown notes at page or panel scope, tags, sources, a scratch pad, full-text search and one-click "copy context" for pasting into an LLM.
  - title: Portable output
    details: Export HTML with an image folder or as a single embedded file, render page / panel / collage PNGs, and move everything as a `.mnproj` project.
---

## What is KomaYomi?

KomaYomi — **Koma** (コマ, manga panel) + **Yomi** (読み, reading) — is a **local web application** for learning languages with manga: read the same pages in Japanese, Chinese and English, align them precisely, and take notes. Its unit of work is the panel, not the page: structure the page first, then align editions, then anchor notes to the artwork. Your page images stay in a `raw/` folder; every panel, note, tag, alignment offset and annotation lives in plain JSON under `data/`. Nothing leaves the machine unless you export it.

It is designed for study and translation review rather than for hosting copyrighted material: bring your own scans, point the app at the folder, and work page by page.

## Status at a glance

KomaYomi is at **1.0.1**. The documentation distinguishes what exists today from what is planned.

<div class="status-list">
  <div><strong>Working today</strong> — library scanning including multi-work roots, XY-cut panel detection, manual panel editing, splitting a panel and reordering the numbering with quick 1–10 positions and right-click move-to, panel grouping and page history, three sidebar page-list layouts (two-column thumbnails, single-column thumbnails, and a list with languages and note counts), panel/layout templates, vector annotations with anchor leaders, compare reader with masks and four alignment modes, a third original-page view with per-language zoom and pan plus a linked/independent switch, panel detail views with per-panel deep links (double-click any compare row, including its margins, to open one), per-language session-only alignment in the detail view, previous/next panel across page and chapter boundaries, focus mode, edit and read-only modes, Markdown notes with search and single-editor editing, typed notes (Background, Vocabulary and Reaction at page or panel scope, one type per enabled language, custom types stored in `data/library.json`, with filtering, grouping and add-by-type), a start screen with six first-run steps and import / new-library / open-project / guide entries, HTML / PNG / PDF (print) / Word export with annotations baked by default, backup ZIP plus scheduled automatic backups, cache management, upload to a WebDAV/network target, a WebDAV/network image source with on-demand LRU caching and an offline write queue, atomic page saves with schema validation, `.bak` rotation and a concurrent-write lock, `.mnproj` project export/import, CLI batch tools.</div>
  <div><strong>Planned</strong> — vocabulary-list export; an in-app image format converter (renaming and splitting live in preprocessing); a full native mobile app (the responsive web UI works in narrow browser windows); broader integration tests.</div>
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
