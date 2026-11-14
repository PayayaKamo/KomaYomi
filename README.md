# KomaYomi

**Manga Learner** — learn languages with manga, take notes.

KomaYomi is a local-first manga reader for language learners: read the same page in
multiple languages side by side, split panels, look up text, and keep structured notes
without uploading your library anywhere.

## Features

- **Parallel reading** — align pages across languages (`ja`, `zh`, `en`, …) and switch layouts on the fly.
- **Panel & page annotation** — draw panel boxes, reuse layout templates, and edit page metadata.
- **Notes that stay with the page** — scratchpad, translation notes, and context templates stored locally.
- **Library management** — import volumes/chapters from a folder tree, detect missing languages, browse by volume.
- **Import / export** — portable `.mnproj`, `.mntpl`, `.mnexp` and `.mnpage.json` formats with JSON Schemas.
- **Desktop shell** — run as a local web app in your browser or inside the Electron window.
- **Plugin hooks** — drop a small `.mjs` plugin to replace the built-in panel detector.

## Getting started

Requirements: Node.js 22+ (Node 26 runs the TypeScript server directly) and npm.

```bash
npm install     # install dependencies
npm run dev     # local web app at http://127.0.0.1:5173
npm run desktop # build the frontend + server bundle, then launch Electron
```

`npm run desktop` expects a data directory containing `raw/`, `data/` and `exports/`.
The Electron app asks for one on first launch; in source mode it reuses the project
folder. Press `Ctrl+Shift+D` to switch data directories.

## Scripts

| Command                                   | What it does                                              |
| ----------------------------------------- | --------------------------------------------------------- |
| `npm run dev`                             | Vite dev server with the local API middleware             |
| `npm run desktop`                         | Build and launch the Electron desktop app                 |
| `npm run build`                           | Type-check and build the production frontend into `dist/` |
| `npm run preview`                         | Preview the production build                              |
| `npm run server:build`                    | Bundle the Node server into `dist-server/app.mjs`         |
| `npm run typecheck`                       | Type-check without emitting                               |
| `npm run lint` / `npm run lint:fix`       | ESLint (flat config)                                      |
| `npm run format` / `npm run format:check` | Prettier                                                  |

## Documentation

User and developer documentation lives in [docs/](docs/) (VitePress site).

## Packaging

`electron-builder.yml` carries the app identity (`com.payayakamo.komayomi`, product name
`KomaYomi`). A distributable installer is not built by default yet; run `npm run build`
and `npm run server:build` before invoking electron-builder.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch model, commit convention, and PR
checklist. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © PayayaKamo.

KomaYomi is an independent project and is not affiliated with, endorsed by, or
connected to any similarly named project, product, or organization.
