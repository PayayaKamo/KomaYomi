# Library

The library is built by scanning the `raw/` folder every time the app loads. There is no import step and no database: directory structure *is* the configuration.

<figure class="shot">
  <img src="/shots/gallery.svg" alt="Library sidebar and volume grid (placeholder)">
  <figcaption>Placeholder image. The sidebar lists volumes, chapters and per-page warnings.</figcaption>
</figure>

## Required directory shape

```text
raw/
  <volume>/
    <language-dir>/
      <chapter>/
        001.jpg
        002.jpg
```

- A **volume** is any top-level folder under `raw/`.
- A **chapter** is any folder inside a language directory. Chapters are unioned across languages, so one language may be missing a chapter folder.
- **Pages are paired by sorted position, not by filename.** Each language's files are sorted with a natural sort (digit runs compared numerically), then paired by index. `1.jpg`, `2.jpg`, `10.jpg` sorts correctly.
- A page can exist in only some languages; missing pairs are reported per page.

## Language directory names

The scanner normalizes a folder name (lowercase, spaces and underscores to hyphens) and matches it against aliases:

| Language | Accepted directory names |
| --- | --- |
| Japanese (`ja`) | `ja`, `jp`, `jpn`, `japanese`, `ja-jp`, `日`, `日本語`, `日文` |
| Chinese (`zh`) | `zh`, `zh-cn`, `zh-hans`, `zh-sg`, `cn`, `chs`, `zh-tw`, `zh-hk`, `zh-hant`, `cht`, `tw`, `hk`, `中`, `中文`, `繁中`, `简中` |
| English (`en`) | `en`, `en-us`, `en-gb`, `us`, `uk`, `eng`, `english`, `英`, `英文` |

If a folder name is not recognized, the volume still appears but with a warning. Open **volume settings** to pin a directory to a language; the choice is stored in `data/library.json`:

```json
{
  "volumes": {
    "点兔第14卷": {
      "dirs": { "ja": "raw-ja", "zh": "raw-zh" }
    }
  }
}
```

A volume may have one, two or three languages. The compare reader only offers languages that actually exist for the current page.

## Adding and removing volumes

- **Add volume** links an existing folder into `raw/` instead of copying it. On Windows this uses a directory link, so large libraries are not duplicated. Annotations remain writable because the link behaves like a normal folder.
- **Remove volume** deletes only the link under `raw/`; images in the original folder are untouched. Page annotations already saved under `data/pages/` are kept.
- **Volume settings** maps unrecognized directories to `ja` / `zh` / `en` without renaming anything on disk.

## Warnings you will see

Library warnings are informational; the page still opens.

| Warning | Meaning | Fix |
| --- | --- | --- |
| *No language directory recognized* | None of the subfolders matched an alias. | Map them in volume settings or rename them. |
| *Unrecognized directory: …* | Extra folders are present next to language folders. | Map or ignore them. |
| *Page counts differ across languages* | Languages have different numbers of files. | Pairing is by index; add or remove the missing page. |
| *Mixed extensions in this chapter* | e.g. `.jpg` and `.png` alternate. | Usually harmless; normalize if you care about consistent thumbnails. |
| *Filename does not match page number* | Leading number in the filename differs from its sorted position. | Rename files if the mismatch indicates a missing or extra page. |

## Navigation and shortcuts

| Action | Shortcut |
| --- | --- |
| Previous / next page | `[` / `]` |
| Panel workbench | `P` |
| Compare reader | `C` |
| Toggle sidebar | `S` |
| Toggle notes panel | `N` |
| Open export dialog | `E` |
| Help | `?` |

The URL hash is deep-linkable: `#/<volume>/<chapter>/<page>/<panels|compare>`. Share or bookmark a specific page and view; the app restores it on load.

## Thumbnails and performance

Thumbnails are generated on demand and cached in `data/cache/thumbs/`. Deleting that folder is safe; they are rebuilt on the next visit. Image format is sniffed from the file header, so a `.png` that is really a JPEG still renders correctly.

::: warning WebP decoding
The built-in detector decodes JPEG and PNG. WebP can be displayed but its pixel data is not decoded for panel detection; use JPEG/PNG when you rely on automatic detection.
:::
