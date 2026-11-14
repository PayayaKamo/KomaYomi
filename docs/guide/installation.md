# Install & Run

KomaYomi runs either as a **browser app backed by a local Node server** or as an **Electron desktop window**. Both use the same server code and the same data directory.

## Requirements

- **Node.js 20 or newer** (the server bundle targets Node 20; the repository is developed against Node 22+).
- npm (bundled with Node).
- Optional: Electron dependencies are installed as part of `npm install`.

There is no hosted service and no account. The app listens on `127.0.0.1` only.

## Install

From the repository root:

```bash
npm install
```

## Run in development

```bash
npm run dev
```

This starts Vite on `http://127.0.0.1:5173` (the port may shift if 5173 is busy). The API is served by a Vite middleware plugin, so there is no second process to start.

## Run as a desktop app

```bash
npm run desktop
```

This command does three things:

1. `npm run build` — type-checks and builds the frontend into `dist/`.
2. `npm run server:build` — bundles the server into `dist-server/app.mjs` with esbuild.
3. `electron .` — opens a window that loads the bundled static files from a local HTTP server.

Desktop data directory:

- Running from source (`npm run desktop`), it uses the repository folder, keeping `raw/`, `data/` and `exports/` next to the code.
- A packaged build defaults to a `library` folder inside Electron's `userData` directory and asks you to choose a folder on first launch.
- `Ctrl+Shift+D` switches the data directory (a restart is required).
- The environment variable `MANGA_DATA_DIR` overrides the data directory.
- `MANGA_PORT` fixes the internal port; otherwise a free port is chosen.

<Badge type="warning" text="Planned" /> A distributable installer (`.exe` / `.dmg`) is not configured yet. `electron-builder` is present as a dev dependency, but there is no `build` configuration or packaging script in the repository.

## Build outputs

| Command | Output | Purpose |
| --- | --- | --- |
| `npm run build` | `dist/` | Static frontend. |
| `npm run server:build` | `dist-server/app.mjs` | Bundled Node server used by Electron. |
| `npm run preview` | — | Serves the built frontend with Vite preview. The API middleware is a dev-server feature; use the desktop app or `npm run dev` for API access. |
| `npm run typecheck` | — | TypeScript project check. |

## Data directory layout

```text
raw/                       # your images (gitignored)
  <volume>/<language>/<chapter>/01.jpg
data/
  pages/<volume>/<chapter>/0.json     # one page JSON, 0-based index
  templates/                          # panel templates and export templates
  presets/                            # alignment presets
  layouts/*.json                      # declarative layout templates
  library.json                        # manual language-directory mapping
  cache/thumbs/                       # thumbnail cache (safe to delete)
  backups/                            # project import backups (gitignored)
exports/                   # generated HTML, PNG, backups, .mnproj (gitignored)
```

`npm run dev` serves images through `/raw/...` and generated files through `/exports/...`; neither folder is exposed as a static directory listing.

## Ports and hosts

- Development UI: `127.0.0.1:5173`.
- Documentation site (this site): `127.0.0.1:5174` when started from `docs/`.
- The Electron window talks to an ephemeral localhost port.

## First run

1. Put at least one volume under `raw/` following `raw/<volume>/<ja|zh|en>/<chapter>/<pages>`.
2. Open the app. The sidebar lists volumes and chapters.
3. Select a page. On first open the page is automatically detected and saved.
4. If a language folder is not recognized, open the volume settings and map directories manually.

See [Library](/guide/gallery) for naming rules and the language aliases the scanner accepts.

## Documentation site

The docs live in `docs/` with their own dependencies:

```bash
cd docs
npm install
npm run docs:dev     # http://127.0.0.1:5174
npm run docs:build   # static output in docs/.vitepress/dist
npm run docs:preview # preview the production build
```

From the repository root you can also use `npm --prefix docs run docs:dev`.
