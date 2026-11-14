/**
 * Minimal example panel-splitting plugin.
 *
 * Drop any `.mjs` / `.js` / `.cjs` file into this folder. File order is
 * alphabetical; the first plugin whose `match` rules pass is used. If a plugin
 * throws, times out (2500 ms) or returns no panels, Manga Memo falls back to the
 * built-in detector and shows a visible warning.
 *
 * Interface
 * ---------
 * export default {
 *   name: string,                                  // shown in the UI / CLI
 *   match?: {                                      // all optional
 *     volume?: string | RegExp,                    // volume (folder) name
 *     chapter?: string | RegExp,                   // chapter name
 *     file?: string | RegExp,                      // image filename
 *   },
 *   panels(info): PanelRect[] | { panels: PanelRect[]; warnings?: string[] }
 * }
 *
 * PanelRect = { x, y, w, h } in 0..1 normalized page coordinates.
 * `info` = { width, height, volume, chapter, pageIndex, filename }.
 *
 * The example below splits a page into a 2×2 grid. Replace `panels()` with your
 * own logic (e.g. read fixed coordinates for a specific magazine layout).
 */
export default {
  name: 'example-2x2-grid',
  // Only run for a volume whose name contains "Example" — edit to fit your data.
  match: { volume: /example/i },
  panels({ width, height }) {
    void width;
    void height;
    const gap = 0.01;
    const w = (1 - gap) / 2;
    const h = (1 - gap) / 2;
    return [
      { x: 0, y: 0, w, h },
      { x: w + gap, y: 0, w, h },
      { x: 0, y: h + gap, w, h },
      { x: w + gap, y: h + gap, w, h },
    ];
  },
};
