# On Different Devices

One app, several shapes. KomaYomi reflows instead of hiding features behind a separate mobile build, so the same buttons are always somewhere on screen — they just move around. This page shows how the main windows rearrange at each size, with a real capture for each shape.

## PC, landscape — 1440 px

<figure class="shot">
  <img src="/assets/screenshots/device-pc-landscape.webp" alt="1440 px wide window with the library sidebar, three compare panes and the notes column">
  <figcaption>1440 px: sidebar on the left, three language panes in the middle, notes column on the right.</figcaption>
</figure>

At 1440 px the sidebar (around 270 px), the compare stage and the notes column are all visible at once. The three language panes sit side by side, so a whole exchange fits without scrolling, and the notes column opens by default when the window starts wider than 1180 px — drag its splitter to widen it, or close it with **Notes** (`N`).

## PC, portrait — 900 × 1200

<figure class="shot">
  <img src="/assets/screenshots/device-pc-portrait.webp" alt="900 by 1200 narrow desktop window with the library collapsed into a drawer and the compare panes stacked">
  <figcaption>900 × 1200: sidebar folded into a drawer, one compare column, notes closed until you ask for them.</figcaption>
</figure>

At 900 px the layout switches to its narrow mode: the library folds into a drawer behind the ☰ button, the compare panes stack in a single column, and the notes column starts closed — **Notes** brings it back. Toolbar groups drop their text labels, and the actions that no longer fit move under **More**.

## Phone, portrait — 390 × 844

<figure class="shot">
  <img src="/assets/screenshots/device-phone-portrait.webp" alt="390 by 844 window with the top bar and toolbar wrapped over several rows">
  <figcaption>390 × 844: the top bar wraps onto three rows and the toolbar onto several more; the touch layout shows one language lane at a time.</figcaption>
</figure>

On a 390 px touch phone the top bar wraps into three rows — navigation and page controls, then interface language and export, then the **Panels / Compare** switch. The compare stage shows one language lane at a time. The language tab bar above the stage (JA / EN / ZH) picks which active language is in view; when more than one language is active you can also swipe left or right to switch, and the hint next to the tabs says so. The language toggles in the toolbar decide which languages are active in the first place. Toolbar groups wrap onto extra rows instead of scrolling out of reach; the library opens as a left drawer and notes as a full-width drawer. Turn the phone sideways and it uses the same two-lane touch layout as a portrait tablet.

## Tablet, portrait — 820 × 1180

<figure class="shot">
  <img src="/assets/screenshots/device-tablet-portrait.webp" alt="820 by 1180 window with the top bar on one row and the compare panes stacked">
  <figcaption>820 × 1180: top bar on one row, sidebar in a drawer; a mouse-driven window stacks the panes, while a touch tablet pairs them two per row.</figcaption>
</figure>

KomaYomi picks the compare layout from the pointer type and the aspect ratio, not the width alone. In a fine-pointer window at 820 px the panes stack in a single column. On a touch tablet in portrait, each panel shows two language lanes side by side; when more than two languages are active, the tab bar above the stage chooses which pair is visible, starting from the focused language. Phones in landscape up to 900 px wide use the same two-lane layout. The top bar stays on one row, the sidebar stays a drawer, the toolbar wraps and folds the actions that no longer fit under **More**, and notes open as a drawer over the stage.

## Tablet, landscape — 1180 × 820

<figure class="shot">
  <img src="/assets/screenshots/device-tablet-landscape.webp" alt="1180 by 820 tablet window with the sidebar open and three language panes side by side">
  <figcaption>1180 × 820: sidebar open, three language panes side by side, notes as a drawer.</figcaption>
</figure>

At 1180 px the sidebar (240 px) is back, and the three language panes sit in one row at roughly 290 px each. On a touch tablet in landscape, KomaYomi shows two lanes up to 900 px wide and three lanes above 900 px up to 1199 px; the language tab bar only appears when you have more languages enabled than there are lanes. Notes stay a drawer at this width and open over the stage. The toolbar keeps two rows — language and alignment controls on top, annotation tools below — while **Export HTML** stays in the top bar.

::: info About the phone and portrait-tablet captures
The 390 × 844 and 820 × 1180 captures above were taken in a mouse-driven browser window, so they show the desktop stacking rule. On a touch phone or tablet KomaYomi uses the touch layouts described here: one lane on a phone, two side by side on a portrait tablet.
:::

::: tip Capturing your own layouts
Resize the browser window rather than zooming the page: the breakpoints follow the viewport width, and the notes column and sidebar only change places when the window itself crosses them.
:::

## The native mobile app

The responsive layout above is the browser build. There is also a separate native app, [KomaYomi-mobile](https://github.com/PayayaKamo/KomaYomi-mobile), for Android and iOS. It opens the same `.mnproj` projects and writes changes back into them.

### Faster project import in 0.2.1

Opening a large `.mnproj` on a phone used to spend its time in JavaScript: the archive was unpacked in memory and the interface could freeze while thousands of page images were extracted. In **0.2.1** the Android app hands the archive to a native Kotlin unpacker instead — only the small JSON files are read in JavaScript, and images are moved on disk rather than copied through the JS bridge. The import screen shows a phase (reading, extracting, images, saving), so a long import looks like progress rather than a hang.

The iOS build still unpacks in memory, so it behaves like the earlier Android releases on very large projects. If an import is interrupted, nothing is linked: open the project again rather than editing a half-extracted copy.

### What to expect

- **Android** — universal APK, per-ABI APKs and an AAB are published; the public builds use the debug keystore, so they are fine for sideloading but not for store upload and cannot be upgraded over a build signed with a different key.
- **iOS** — build and sign locally; no pre-signed IPA is published.
- **HarmonyOS NEXT** — a placeholder, not a working target yet.
- The mobile app is a viewer/editor for existing projects, not a scanner: prepare the folder or `.mnproj` on a computer first.
