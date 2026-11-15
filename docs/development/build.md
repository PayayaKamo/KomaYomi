# Build & Packaging

KomaYomi ships in four shapes from one codebase: a browser app with a local server, a standalone server, an Electron desktop app, and a static online edition from a separate repository. This page lists the commands and the differences that actually matter when you change code.

## Requirements

- Node.js 22 or newer with npm.
- The batch CLI relies on Node's TypeScript support. Node 22.6–23.5 needs `--experimental-strip-types`; Node 23.6+ enables it by default, and Node 26 runs the `.ts` entry directly.
- Desktop packaging targets Windows x64 by default (`electron-builder.yml`); the server itself runs anywhere Node runs.

## Commands

| Command | What it does | Output |
| --- | --- | --- |
| `npm run dev` | Vite dev server plus the API middleware on `127.0.0.1:5173` (next free port if busy). | none |
| `npm run build` | Type-check the project and build the frontend. | `dist/` |
| `npm run preview` | Serve the built frontend with the same API middleware. | — |
| `npm run server:build` | Bundle `server/app.ts` and `server/standalone.ts` with esbuild. | `dist-server/app.mjs`, `dist-server/standalone.mjs` |
| `npm start` | Run the bundled standalone server. | HTTP on `0.0.0.0:3921` |
| `npm run desktop` | Build, bundle the server and open Electron. | window |
| `npm run dist:win` | NSIS installer and portable executable. | `release/` |
| `npm run dist:dir` | Unpacked app for a quick desktop sanity check. | `release/win-unpacked/` |
| `npm run docker:up` | Build and run the container with bind mounts. | `http://127.0.0.1:3921` |
| `npm run docs:dev` | VitePress dev server at the server root (`DOCS_BASE=/`). | `127.0.0.1:5174` |
| `npm run docs:build` | Build this site (dead links fail the build). | `docs/.vitepress/dist/` |

## Local development

```bash:no-line-numbers
npm install
npm run dev
```

There is no second process: `server/plugin.ts` mounts `createMangaHandler` as Vite middleware for both `configureServer` and `configurePreviewServer`. A request to `/api/library` is handled in the same event loop as the page, which is why a server-side `console.log` shows up in the terminal that runs Vite.

Vite serves the frontend from `src/`; the server reads `raw/` and `data/` relative to the repository root.

## Production build

```bash:no-line-numbers
npm run build
npm run server:build
npm start
```

`npm run build` runs `tsc -b` first, so a type error fails the build. `server:build` bundles with `platform: node`, `format: esm`, `target: node20`, and injects a `createRequire` banner because `pngjs` and `jpeg-js` still call `require`.

`npm start` expects `dist/` to exist; `server/standalone.ts` exits with `CLI_MISSING_STATIC_DIR` if it does not. Configuration is environment-only:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Listen address. |
| `PORT` | `3921` | Listen port. |
| `RAW_DIR` | `<cwd>/raw` | Manga images. |
| `DATA_DIR` | `<cwd>/data` | JSON data. |
| `EXPORT_DIR` | `<cwd>/exports` | Generated files. |
| `STATIC_DIR` | `<cwd>/dist` | Built frontend. |
| `MANGA_LOCALE` | auto | UI locale hint: `en`, `zh` or `ja`. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. |

## Desktop

```bash:no-line-numbers
npm run desktop
npm run dist:win
```

`electron/main.cjs` loads `dist-server/app.mjs` in-process, serves `dist/` and opens a window. Data is not bundled: on first launch the app asks for a library folder and remembers it in `%APPDATA%/manga-memo/config.json`, so `raw/`, `data/` and `exports/` stay where you keep your library.

Packaging configuration lives in `electron-builder.yml`. Only `dist/`, `dist-server/`, `electron/` and `package.json` are packed; the bundled server already contains its dependencies, so no `node_modules` is shipped.

## Docker

```bash:no-line-numbers
docker compose up --build
```

The container runs `dist-server/standalone.mjs` and binds `raw/`, `data/` and `exports/` from the host. It is intended for a local machine: there are no accounts and no authentication, so do not expose the port publicly.

## The static online edition

The static edition is a separate project, `https://github.com/PayayaKamo/KomaYomi-online`, built from a browser-only subset. It shares the page format and the project-file reader, but it cannot scan folders, run panel detection, load plugins or talk to WebDAV because none of those can run in a browser tab. Work saved there lives in IndexedDB.

When you add a feature, decide early which shape it belongs to:

| Change | Local server | Static edition |
| --- | --- | --- |
| A new field in a page document | Add it to `shared/` and the server normalizer. | Works if it lives in `shared/`. |
| A new detector or plugin hook | `server/detect.ts`, `server/plugins.ts`. | Not available. |
| A new dialog or view | `src/components/`. | Usually portable if it only calls existing API methods. |
| Filesystem, process or network access | Server only. | Not available. |

## Regenerating detection baselines

```bash:no-line-numbers
node scripts/manga-cli.ts regress
node scripts/manga-cli.ts regress --update
```

The first command compares current panel counts with `scripts/detect-baseline.json`; `--update` rewrites the baseline. Review the diff before committing it — a baseline update is a promise that the new counts are correct.

## Before opening a pull request

```bash:no-line-numbers
npm run lint
npm run typecheck
npm test
npm run i18n:scan
npm run docs:build
```

`i18n:scan` is non-strict by default; CI treats new hard-coded Chinese strings in `src/` as a failure. `docs:build` fails on a dead link, which is the cheapest way to catch a renamed page across three locales.
