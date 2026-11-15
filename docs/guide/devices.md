# On Different Devices

One app, several shapes. KomaYomi reflows instead of hiding features behind a separate mobile build, so the same buttons are always somewhere on screen — they just move around. This page shows how the main windows rearrange at each size, with a real capture for each shape.

## PC, landscape — 1440 px

<figure class="shot">
  <img src="/assets/screenshots/device-pc-landscape.png" alt="1440 px wide window with the library sidebar, three compare panes and the notes column">
  <figcaption>1440 px: sidebar on the left, three language panes in the middle, notes column on the right.</figcaption>
</figure>

At 1440 px the sidebar (around 240 px), the compare stage and the notes column are all visible at once. The three language panes sit side by side, so a whole exchange fits without scrolling, and the notes column stays open above 1180 px — drag its splitter to widen it, or close it with **Notes** (`N`).

## PC, portrait — 900 × 1200

<figure class="shot">
  <img src="/assets/screenshots/device-pc-portrait.png" alt="900 by 1200 narrow desktop window with the library collapsed into a drawer and the compare panes stacked">
  <figcaption>900 × 1200: sidebar folded into a drawer, one compare column, notes closed until you ask for them.</figcaption>
</figure>

At 900 px the layout switches to its narrow mode: the library folds into a drawer behind the ☰ button, the compare panes stack in a single column, and the notes column starts closed — **Notes** brings it back. Toolbar groups drop their text labels, and the actions that no longer fit move under **More**.

## Phone, portrait — 390 × 844

<figure class="shot">
  <img src="/assets/screenshots/device-phone-portrait.png" alt="390 by 844 phone window with one compare column, language chips and a toolbar wrapped over several rows">
  <figcaption>390 × 844: one compare column; the Language chips pick JA, EN or ZH; the toolbar wraps onto several rows.</figcaption>
</figure>

On a 390 px phone the top bar wraps into three rows — navigation and page controls, then interface language and export, then the **Panels / Compare** switch. The compare stage keeps a single column: each panel lists its chosen languages one below another, and the **Language** chips (JA / EN / ZH) decide which of them appear, because there is no room for two panes side by side. Toolbar groups wrap onto extra rows instead of scrolling out of reach, and the library and notes both open as full-width drawers.

## Tablet, portrait — 820 × 1180

<figure class="shot">
  <img src="/assets/screenshots/device-tablet-portrait.png" alt="820 by 1180 tablet window with the top bar on one row and a single, full-width compare column">
  <figcaption>820 × 1180: top bar on one row, sidebar in a drawer, compare still a single column, toolbar over two rows.</figcaption>
</figure>

At 820 px the top bar stays on a single row and the sidebar stays a drawer, but the compare stage is still one column wide — the language panes are stacked rather than side by side. The **Language** chips work as on the phone, and the toolbar folds into two rows: language and view controls first, then the annotation tools. Notes open as a drawer over the stage.

## Tablet, landscape — 1180 × 820

<figure class="shot">
  <img src="/assets/screenshots/device-tablet-landscape.png" alt="1180 by 820 tablet window with the sidebar open and three language panes side by side">
  <figcaption>1180 × 820: sidebar open, three language panes side by side, notes as a drawer.</figcaption>
</figure>

At 1180 px the sidebar (240 px) is back, and the three language panes sit in one row at roughly 290 px each. Notes stay a drawer at this width and open over the stage. The toolbar keeps two rows — language and alignment controls on top, annotation tools below — while **Export HTML** stays in the top bar.

::: tip Capturing your own layouts
Resize the browser window rather than zooming the page: the breakpoints follow the viewport width, and the notes column and sidebar only change places when the window itself crosses them.
:::
