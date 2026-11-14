# Compare Reader

The compare reader puts the same panel from two or three languages next to each other — or on top of each other — and lets you align the artwork so the comparison is honest.

<figure class="shot">
  <img src="/shots/compare.svg" alt="Compare reader showing Japanese, Chinese and English panes (placeholder)">
  <figcaption>Placeholder image. Each language is its own pane; alignment is stored per page.</figcaption>
</figure>

## Layouts

- **Side by side** — one column per selected language. For narrow screens the panes stack vertically.
- **Overlay** — all selected languages are drawn in the same box. Enable **Multiply** (正片叠底) to see through line art.
- **Language chips** — toggle `JA`, `ZH`, `EN`. A language that is missing on the current page is disabled with a tooltip.

Overlay has an **alignment target**: choose which language you are dragging. This prevents two panes from moving at once.

## Masking

Masking hides a language's artwork while you test your comprehension.

- Turn the master switch on, then choose which languages are masked.
- Style: **Blur** or **Solid**.
- `H` masks everything; `Shift+H` reveals everything.
- Click a masked pane to reveal it temporarily; click the artwork again to re-mask.
- **Defaults** remembers which languages are masked across sessions (stored in the browser).

Masks are a **reading preference only**. HTML and PNG exports never include masks.

## Zoom and pan

- **Wheel** over a pane zooms that language. The wheel is only captured when the pointer is inside a language pane, so normal page scrolling still works elsewhere.
- **Drag** a pane to pan it.
- A zoom/pan readout and reset button are available in the toolbar.

## Alignment

Alignment is stored in the page JSON, not in the image. Four modes are available:

| Mode | Behavior | Good for |
| --- | --- | --- |
| **Page** | Dragging any panel translates the whole page. | A whole scan is offset by the same amount. |
| **Panel** | Each panel has its own offset. | Digital and print editions have different panel positions. |
| **Anchors** | Click a landmark on the reference language, then the same landmark on the target; the offset is computed. | Precise, repeatable alignment of one detail. |
| **Grid** | Dragging snaps to a step of 0.5%, 1%, 2% or 5%. | Tidy, reproducible numeric offsets. |

Each language has `{ x, y, scale }`, where `x` and `y` are fractions of the panel width/height and `scale` zooms the crop. Numeric fields let you type exact values.

### Presets

- Save the current alignment as a preset, scoped to the page or the chapter.
- Apply a preset to **this page** or the **whole chapter**.
- Presets are stored under `data/presets/` and can be listed with `align-presets` in the CLI, or applied in bulk with `apply-align`.

## A practical comparison loop

1. Open a page in **Compare**.
2. Choose `JA` + `ZH` (and `EN` if available).
3. Set alignment to **Panel** and drag each language until the panel contents line up.
4. Save an alignment preset if the whole chapter has the same offset.
5. Switch to **Overlay** with Multiply to spot differences in line art or lettering.
6. Turn on masks to test yourself, then reveal each pane.

## Notes while comparing

The notes panel is shared by both views. Selecting a panel in the compare reader scopes a new note to that panel. See [Notes](/guide/notes).

## Behavior details

- Alignment offsets are applied at export time too, so the exported crop matches what you see.
- The reader needs panels first. If a page has none, it shows a hint to visit the panel workbench.
- Switching pages keeps the mask preference but clears temporary reveals.
