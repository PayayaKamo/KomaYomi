# Preparing & Renaming Images

KomaYomi reads image folders in place. It never copies, converts or renames your files, which means the minutes you spend tidying a volume before adding it decide how well detection, page pairing and compare reading go. Slightly annoying, much cheaper than fixing the same page three times.

## The problem it solves

Panel detection is happiest with clean page scans. A volume with rotated pages, scanner borders, a pile of WebP files or one edition missing a page will still open, but every later step — pairing, alignment, notes, export — inherits the mess. Fix it once, at the source.

## What KomaYomi does with your files

| Behaviour | Consequence |
| --- | --- |
| Images are read from the folder you point at. | Nothing is imported or duplicated; edits stay in `data/`. |
| Pages are paired by **sorted position**, not by filename. | Renaming changes the order. Insert one page and every later page shifts. |
| Sorting is natural: digit runs compare as numbers. | `2.jpg` comes before `10.jpg` even without zero padding. |
| WebP is displayed but not decoded for panel detection. | Convert WebP pages to JPEG or PNG if you rely on **Auto split**. |
| One image is one page. | A scanned spread must stay one file unless you split it in every language. |

<figure class="shot">
  <img src="/assets/screenshots/library-overview.png" alt="Library sidebar with volumes, chapters and language badges after a clean import">
  <figcaption>A prepared volume: one folder per language, one folder per chapter, and matching page counts so the language badges line up.</figcaption>
</figure>

## A preparation checklist

Work on a copy if the originals matter. The order below matters more than the tools you use.

1. **Rotate and deskew.** Reading direction is stored per page; a sideways scan cannot be fixed by the compare reader.
2. **Crop scanner borders and facing-page shadows.** Panels that touch the edge are detected more reliably when the page edge is square.
3. **Convert WebP to JPEG or PNG** if you want automatic splitting. Keep the quality high enough that the lettering stays legible.
4. **One chapter per folder.** Do not mix two chapters in one directory; the chapter becomes the unit for templates, alignment presets and export.
5. **Remove non-page images** such as covers, credits, colour inserts or bonus art that does not exist in the other editions. One extra page shifts every page after it.
6. **Keep spreads unsplit, or split every edition.** A spread counts as one page. If you split the Japanese raw but not the Chinese scanlation, page 12 in one language becomes pages 12–13 in the other and pairing breaks.
7. **Normalise filenames only if it helps you.** Zero-padded numbers (`001.jpg`) make diffs and manual checks easier, but the scanner uses sorted position and natural order, so `1.jpg` and `001.jpg` both work.

## Renaming a chapter in bulk

There is no in-app batch rename or image converter yet — <Badge type="warning" text="Planned" />. The **Preprocess…** dialog can rename a volume or chapter for display and reorder or exclude pages, but it only writes the library config (`library.json`); file names on disk stay as they are. For real renames, use the file manager or a shell. On Windows, PowerShell can renumber a folder after sorting:

```powershell
# Preview first: -WhatIf prints the planned renames and changes nothing.
Get-ChildItem -File | Sort-Object Name | ForEach-Object -Begin { $i = 1 } -Process {
  $new = '{0:D3}{1}' -f $i, $_.Extension.ToLower()
  Rename-Item -LiteralPath $_.FullName -NewName $new -WhatIf
  $i++
}
```

Remove `-WhatIf` only after the preview looks right, and run the same command in each language folder of the chapter. Renaming is safe for annotations only while the **page count and order stay the same**: page data is keyed by chapter and page index, not by filename.

::: warning Renaming can orphan annotations
If a rename changes the number of pages or their order, `data/pages/<volume>/<chapter>/<index>.json` no longer points at the page you edited. Finish renaming before you start correcting panels, or restore a backup afterwards.
:::

## Verify before you annotate

1. Add the volume and open it in the sidebar.
2. Read the warnings on the volume and chapter rows. *Page counts differ across languages* and *Filename does not match page number* usually mean a preparation mistake.
3. If the folder shape is unusual, open **Folder rules…** and use its preview before saving; see [Folder Detection Rules](/guide/folder-rules).
4. Open the first, middle and last page. Confirm that the same panel really contains the same artwork in every language; if not, the page counts or the spread handling are wrong.
5. Only then run **Auto split** and start writing notes.

## Common pitfalls

- **One language is one page longer.** Usually an extra cover or credits page. Remove it or add the equivalent page to the other languages.
- **A spread is split in only one edition.** Keep spreads whole, or split every edition at the same place.
- **Auto split produces nonsense on a WebP page.** Convert the file; detection never decodes WebP.
- **Renaming shifted a note to the next page.** Page data is keyed by index. Rename before annotating, or use page history to check what changed.
- **Pages look fine but thumbnails are mixed.** Thumbnails follow the file content, not the extension; a `.png` that is really a JPEG still renders. This is cosmetic.
- **Folders were reorganised after annotating.** Detection ids changed, so old page data is not found. Apply folder rules before annotating, not after.

## Missing screenshots

| Figure | Needed for |
| --- | --- |
| before/after page naming | The zero-padding and natural-sort explanation |
| spread handling | One spread kept as a single page versus split pages |
| library warnings strip | The three warnings used for verification |

## Related

- [Library & Import](/guide/gallery) — folder shape, language aliases and volume settings.
- [Folder Detection Rules](/guide/folder-rules) — supporting unusual directory layouts.
- [Panel Workbench](/guide/panels) — what happens after the first page opens.
- [Project Files & Formats](/guide/project-files) — how page data is keyed and versioned.
- [Terminology](/terminology) — the shared vocabulary for panels, pages and annotations.
