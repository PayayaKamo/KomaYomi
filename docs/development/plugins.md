# Panel Plugins

A panel plugin replaces the built-in detector for pages it claims. Plugins are ordinary JavaScript modules loaded **inside the server process** — not subprocesses, not shell scripts. There is no stdin/stdout protocol, no request timeout enforced by an external runner, and no exit code to read; the contract is a function that returns rectangles.

This page documents what `server/plugins.ts` actually does. It is a correction to older notes that described plugins as external programs.

## Where plugins live

| Location | Use |
| --- | --- |
| `plugins/` (repository root) | Plugins you keep with the project. |
| `data/plugins/` | Plugins you keep with your library data. |

Both directories are scanned on every call. Files ending in `.mjs`, `.cjs` or `.js` are loaded; dotfiles are skipped. The list is built from `fs.readdirSync` output, so **do not rely on alphabetical priority** — write precise `match` rules instead of stacking overlapping plugins.

Editing a file does not require a restart: each import appends the file's mtime as a cache-busting query string.

## The contract

A plugin module may default-export either a function or an object:

```ts
type PanelRect = { x: number; y: number; w: number; h: number } // normalized 0..1

type PluginPanelInfo = {
  width: number        // detected image width in pixels
  height: number
  volume: string
  chapter: string
  pageIndex: number    // 0-based
  filename: string
}

type PanelPlugin = {
  name?: string
  match?: {
    volume?: string | RegExp
    chapter?: string | RegExp
    file?: string | RegExp
  }
  panels: (
    info: PluginPanelInfo,
  ) =>
    | PanelRect[]
    | { panels: PanelRect[]; warnings?: string[] }
    | Promise<PanelRect[] | { panels: PanelRect[]; warnings?: string[] }>
}
```

A bare function export is treated as `panels()`, and its plugin name is the file name including the extension.

### Matching

- A string pattern is a case-insensitive substring check.
- A `RegExp` is tested with `.test()`.
- All provided fields must match. Omitting `match` matches every page, which is handy while developing and dangerous to leave in.
- `file` is the image file name, including the extension.

### Results and failure

- Return an array of rects, or an object with `panels` and optional `warnings`.
- An empty array counts as failure. So does a thrown error or a call longer than **2500 ms**.
- On failure the caller falls back to the built-in detector and shows a warning. A broken plugin never leaves a page blank.
- `x`, `y`, `w`, `h` are clamped to `0..1`, and width/height get a minimum of `0.005`.
- `warnings` is surfaced in the detection result and in the CLI output; it does not fail the run.

Plugins run with full Node access — filesystem, network, environment. Only install plugins you trust.

## Example 1: a fixed 2×2 grid

`plugins/example-2x2-grid.mjs`

```js
export default {
  name: 'example-2x2-grid',
  match: { volume: /example/i },
  panels() {
    const gap = 0.01
    const w = (1 - gap) / 2
    const h = (1 - gap) / 2
    return [
      { x: 0, y: 0, w, h },
      { x: w + gap, y: 0, w, h },
      { x: 0, y: h + gap, w, h },
      { x: w + gap, y: h + gap, w, h },
    ]
  },
}
```

The regex matches any volume name containing "example". For a real library, replace it with the volume folder name, for example `match: { volume: '点兔第14卷', chapter: '172' }`.

## Example 2: horizontal strips in a `.cjs` file

A CommonJS module works the same way; the default export is `module.exports`.

`plugins/three-strips.cjs`

```js
module.exports = {
  name: 'three-strips',
  match: { volume: 'weekly', chapter: /^\d+$/ },
  panels() {
    const rows = 3
    const gap = 0.008
    const h = (1 - gap * (rows - 1)) / rows
    return Array.from({ length: rows }, (_, i) => ({
      x: 0,
      y: i * (h + gap),
      w: 1,
      h,
    }))
  },
}
```

`chapter: /^\d+$/` applies the plugin only to numeric chapter folders.

## Example 3: reporting a warning

Return an object when the page geometry is unexpected but you still have a usable guess:

`plugins/wide-gutter.mjs`

```js
export default {
  name: 'wide-gutter',
  match: { file: /^00[1-4]\.jpg$/i },
  panels({ width, height }) {
    if (!width || !height) {
      return { panels: [], warnings: ['Image size unavailable'] }
    }
    const left = 0.08
    const right = 0.08
    const gutter = 0.02
    const w = (1 - left - right - gutter) / 2
    return {
      panels: [
        { x: left, y: 0.05, w, h: 0.9 },
        { x: left + w + gutter, y: 0.05, w, h: 0.9 },
      ],
      warnings: [`Assumed a ${width}×${height} two-panel spread`],
    }
  },
}
```

## Enabling and testing a plugin

1. Put the file in `plugins/` or `data/plugins/`.
2. Open the app and choose **Panel plugins** (the sidebar entry next to folder rules and exchange files). The dialog is read-only: it lists every file, its name, its `match` summary, or the load error with an error code. Press **Refresh** after editing.
3. Open a page the plugin matches and run the split action (**Split** in the panel workbench). The next write records `detectSource: "plugin"` and `detectorVersion: "plugin:<name>"` in the page JSON.
4. Or run it headless:

```bash:no-line-numbers
node scripts/manga-cli.ts plugins
node scripts/manga-cli.ts detect --volume <volume> --chapter <chapter> --pages 1 --plugin example-2x2-grid --apply
```

`plugins` prints the same list as the dialog. `detect` without `--apply` is a dry run; `--auto` forces the built-in detector even when a plugin matches.

Priority is always **layout template → plugin → built-in detector**. If a page has a layout template bound to it, the plugin is never consulted.

## Troubleshooting

| Symptom | Error code | Cause and fix |
| --- | --- | --- |
| The dialog shows a red row | `ERR_PLUGIN_NO_EXPORT` | The module exports neither a function nor an object with `panels()`. Check the default export. |
| The dialog shows a syntax/import error | — | Node could not load the file. The message is the raw exception; check the extension and that imports resolve. |
| Detection falls back to auto | `ERR_PLUGIN_TIMEOUT` | `panels()` took longer than 2500 ms. Do the heavy work once at module load, not per page. |
| Detection falls back to auto | `ERR_PLUGIN_NO_PANELS` | The plugin returned `[]`. Returning nothing is a failure by design, not a "no panels" result. |
| The plugin is never called | `ERR_PLUGIN_NONE` | No file matched, or a layout template won first. Check `match` against the actual volume / chapter / filename. |
| A later plugin never runs | — | A module that fails to load stops the search before the next file. Remove or fix the broken file. |
| Edits have no effect | — | The dialog list is cached until **Refresh**; a page also keeps its saved panels until you split again. |

## Security and portability

- Plugins are trusted code. They can read your files and make network requests.
- They are code, not data: exporting a `.mnproj` does not include `plugins/`. Copy the folder separately.
- The static online edition cannot run plugins, because it has no server process. See [Development overview](/development/#local-only-capabilities).
