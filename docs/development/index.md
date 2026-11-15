# Development & Customization

This section is for people who want to change KomaYomi rather than just use it: add a panel detector, adjust the folder scanner, publish a custom export style, or work on the app itself. Every statement here was checked against the source; when this section and the code disagree, the code is right.

If you only want to read manga and take notes, the [Guide](/guide/introduction) is the better place to start.

## What is in this section

| Page | Answers |
| --- | --- |
| This page | How the frontend, server and shared layer fit together, and what only the local build can do. |
| [Data formats](/development/data-formats) | The JSON envelope, page documents, `library.json`, `.mnproj`, `.mntpl`, `.mnexp`, migrations and unknown-field rules. |
| [Panel plugins](/development/plugins) | The actual plugin contract, working examples, how to test one, and the error codes. |
| [Folder rules](/development/folder-rules) | Placeholders, optional segments, wildcards, `ignore`, `extensions`, and complete examples for common folder layouts. |
| [Export templates](/development/export-templates) | Every field a template can store, a complete `.mnexp`, and how to apply it. |
| [Build & packaging](/development/build) | Dev server, production build, standalone server, Electron, Docker and the static online edition. |
| [Contributing](/development/contributing) | Branch model, commit messages, lint/typecheck/test commands, and a minimal feature change. |

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/` | React 18 frontend: library sidebar, panel workbench, compare reader, notes, export dialog, dialogs and i18n strings. |
| `server/` | Node HTTP API and every local capability: library scan, panel detection, layouts, plugins, alignment presets, export, backup, storage, version history. |
| `shared/` | Code used by both sides: domain types, the JSON envelope and migrations, panel ordering, Markdown rendering. |
| `electron/` | Electron main process and data-directory handling. |
| `scripts/` | Batch CLI (`manga-cli.ts`), server bundler, i18n scanner, detection baseline. |
| `plugins/` | Optional panel plugins. A user can also put them in `data/plugins/`. |
| `docs/` | This VitePress site (its own `package.json`). |
| `raw/`, `data/`, `exports/` | Your images, your JSON, your generated output. None of them is committed. |

## The three layers

### Frontend — `src/`

A single-page React app built by Vite. `src/App.tsx` holds the shell (top bar, sidebar, stage, notes column, pane splitters); feature components live in `src/components/`. `src/api.ts` is the only place that talks to the backend: every call is a `fetch` to a relative `/api/...` path, so the frontend never knows whether it is served by Vite, the standalone server or Electron.

State that belongs to the server — the library, the current page document, saved templates — is loaded through `src/api.ts` and written back explicitly. There is no local database in the browser during normal use.

### Server — `server/`

One routing function, `createMangaHandler({ rootDir })` in `server/app.ts`, checks `pathname` and `method` and delegates to a domain module. The same handler runs in three hosts:

| Host | Entry point | How it is reached |
| --- | --- | --- |
| Dev and preview | `server/plugin.ts` | Vite middleware on `127.0.0.1:5173`; no second process. |
| Standalone / Docker | `server/standalone.ts` | `npm start` on port `3921`, with `RAW_DIR`, `DATA_DIR`, `EXPORT_DIR` overrides. |
| Desktop | `dist-server/app.mjs` | Bundled by `scripts/build-server.mjs` and loaded by `electron/main.cjs`. |

Modules are deliberately narrow: `library.ts` scans and groups pages, `dirRules.ts` turns path patterns into page records, `detect.ts` is the XY-cut detector, `plugins.ts` runs plugin scripts, `layouts.ts` expands declarative grids, `storage.ts` owns page reads and writes, `schemaStore.ts` owns schema migration and atomic writes, `export.ts` and `exportDocx.ts` render documents, `project.ts` and `backup.ts` handle packages and ZIPs.

### Shared — `shared/`

`shared/` must stay free of Node-only and DOM-only APIs so both sides can import it.

| File | What it holds |
| --- | --- |
| `types.ts` | `PageDoc`, `Panel`, `Note`, `Annotation`, reading directions, export config, library types. |
| `format.ts` | The `$schema` / `schemaVersion` envelope, per-format validation, migration dispatch, `preserveUnknown`. |
| `migrations.ts` | Pure v0 → v1 migration functions, no disk access. |
| `panelOrder.ts` | Reading order and group ordering used by display, export and CLI. |
| `markdown.ts` | Markdown rendering with raw HTML escaped. |
| `schemas/*.json` | Readable JSON Schema mirrors; the runtime validator is the source of truth. |

## How a request travels

**Reading the library.** The sidebar calls `GET /api/library`. `server/app.ts` receives it, `server/library.ts` reads `data/library.json`, resolves rules through `server/dirRules.ts`, walks `raw/` (or a mapped remote root), groups images into volumes → chapters → pages, and returns JSON. Nothing is written.

**Saving a page.** The workbench calls `PUT /api/page` with the whole page document. `server/app.ts` validates the basic shape, then `writePageDoc` in `server/storage.ts`:

1. refuses to touch a file written by a newer schema (`409`, `ERR_SCHEMA_TOO_NEW`);
2. normalizes rectangles, notes, offsets and ids;
3. merges unknown fields from the previous version with `preserveUnknown`;
4. writes atomically through `server/schemaStore.ts`;
5. records a version snapshot unless the caller asked to skip it.

**Detecting panels.** `POST /api/detect` tries a layout template bound to the page, chapter or volume, then the first matching plugin, then the built-in detector. The result is written back with `detectSource` and `detectorVersion`, so you can tell later where the boxes came from.

## Local-only capabilities

The desktop and local-server builds have capabilities the static online edition does not, because they need filesystem and process access:

| Capability | Local web / desktop | Static online edition |
| --- | --- | --- |
| Scan a folder under `raw/` | Yes | No — the browser cannot walk a folder tree. |
| Automatic panel detection | Yes | Not ported yet. |
| Layout templates and plugins | Yes | No — both run in the server process. |
| WebDAV / network storage and image cache | Yes | No. |
| Backup ZIP, project import/export | Yes | Project files can be opened; no folder backup. |
| Where work is stored | `data/` next to your images | IndexedDB in the browser |

The static edition lives in a separate repository and is still in development. Its source is `https://github.com/PayayaKamo/KomaYomi-online`; this repository builds the local edition only. See [Build & packaging](/development/build#the-static-online-edition) for what is shared and what is not.

## Conventions worth knowing

- The server is plain ESM TypeScript and is run directly by Node's type stripping in development; imports include the `.ts` extension.
- There is no database. Every persisted value is a JSON file, written atomically.
- User-facing strings in the server live in `server/messages/catalog.ts`; frontend strings live in `src/i18n/`. Adding a hard-coded Chinese string to a component is treated as a bug by `npm run i18n:scan`.
- The documentation site is three isomorphic locales. A new page needs `docs/<page>.md`, `docs/zh/<page>.md` and `docs/ja/<page>.md`, plus nav and sidebar entries in `docs/.vitepress/config.mts`.

## Where to start

- Changing how pages are found on disk: [Folder rules](/development/folder-rules).
- Replacing the detector for one magazine: [Panel plugins](/development/plugins).
- Writing a tool that reads or writes KomaYomi data: [Data formats](/development/data-formats).
- Changing the app itself: [Contributing](/development/contributing).
