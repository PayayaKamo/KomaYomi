# Library & Import

The library is built by scanning `raw/` every time the app loads. No database, no import step that copies your scans: **the folder tree is the configuration**.

This page covers how to lay out files, how the scanner pairs languages, how to link a folder that lives somewhere else, and which import door leads where.

## The problem it solves

Scans arrive in whatever shape the previous owner left them: `Vol.14/Japanese/ch01`, `点兔第14卷/ja/172`, `manga/zh-cn/172`. You want one shelf that lists volumes and chapters, lines page 1 of every language up with page 1 of the others, and tells you where a file is missing — without renaming or moving anything first.

## Directory shape

```text
raw/
  <volume>/
    <language-dir>/
      <chapter>/
        001.jpg
        002.jpg
```

- A **volume** is any top-level folder under `raw/`.
- A **chapter** is any folder inside a language directory. Chapters are unioned across languages, so one edition may skip a chapter folder entirely.
- **Pages pair by sorted position, not by filename.** Each language sorts naturally (digit runs compared as numbers), then pairs by index. `1.jpg`, `2.jpg`, `10.jpg` come out in the right order.

<figure class="shot">
  <img src="/assets/screenshots/library-overview.png" alt="Library sidebar with volumes, chapters and language badges">
  <figcaption>The sidebar lists volume → chapter → pages. Language badges show which editions exist for a volume; warnings appear inline.</figcaption>
</figure>

## Language directory names

The scanner normalizes a folder name (lowercase, spaces and underscores to hyphens) and matches it against aliases:

| Language | Accepted directory names |
| --- | --- |
| Japanese (`ja`) | `ja`, `jp`, `jpn`, `japanese`, `ja-jp`, `日`, `日本語`, `日文` |
| Chinese (`zh`) | `zh`, `zh-cn`, `zh-hans`, `zh-sg`, `cn`, `chs`, `zh-tw`, `zh-hk`, `zh-hant`, `cht`, `tw`, `hk`, `中`, `中文`, `繁中`, `简中` |
| English (`en`) | `en`, `en-us`, `en-gb`, `us`, `uk`, `eng`, `english`, `英`, `英文` |

If a folder name is not recognized, the volume still appears, wearing a warning. Open **volume settings** (the gear on the volume row) to pin a directory to a language. The choice is stored in `data/library.json`:

```json
{
  "volumes": {
    "点兔第14卷": {
      "dirs": { "ja": "raw-ja", "zh": "raw-zh" }
    }
  }
}
```

A volume can carry as many languages as you can map; the three built-ins are just the usual suspects. The compare reader only offers languages that actually exist for the current page.

## Volume settings

Volume settings is the repair bay for a volume whose folders did not introduce themselves properly. Open it with the gear on the volume row.

1. The dialog lists a dropdown for each language detected on the volume, plus **Japanese**, **中文** and **English** as defaults.
2. Choose the subfolder that holds each language. **Not used / auto** hands the folder back to auto-detection.
3. Click **Save**. The library rescans and the volume's language badges update.
4. **Remove from library** deletes only the link under `raw/`; the images in the original folder and the annotations under `data/pages/` survive.

A folder can belong to only one language; folders already taken disappear from the other dropdowns. If no language folder was detected at all, the dialog says so and repeats the volume warnings that explain why.

<figure class="shot">
  <img src="/assets/screenshots/volume-settings.png" alt="Volume settings dialog with one dropdown per language: ja, zh and en, plus Remove from library, Cancel and Save">
  <figcaption>Volume settings. Each dropdown maps a language to its subfolder; Save rescans the volume, and Remove from library only deletes the link under raw/.</figcaption>
</figure>

::: tip Fix the mapping before annotating
Panels and notes are stored per volume and chapter. If the mapping changes later, the page data can no longer be found. Set the mapping, open a few pages, and only then start correcting panels.
:::

## Adding a folder that lives elsewhere

**＋ Add manga** has two modes:

| Mode | What happens |
| --- | --- |
| Leave the path blank | Creates an empty folder under `raw/`. |
| Pick an existing folder | Creates a **folder link** under `raw/` that points at the original. Images are not copied, and annotations remain writable because the link behaves like a normal folder. |

Optional: give the volume a different display name. The hint under the field shows the expected layout: `language/chapter/page.jpg`.

**Remove from library** (in volume settings) deletes only the link under `raw/`; images in the original folder are untouched, and annotations already saved under `data/pages/` are kept.

In a plain browser there is no folder picker. Type the absolute path instead, or use the desktop build and click **Choose a folder…**.

## Page and language roles

Three different "roles" are easy to confuse:

| Role | Where it is chosen | What it affects |
| --- | --- | --- |
| **Base image** | Panel workbench toolbar | Which language's artwork you draw panels on. Panel rectangles are shared by all languages on that page. |
| **Compare languages** | Compare reader language chips | Which languages are displayed, in which order. Not every language has to be enabled. |
| **Primary language** | PNG export | Whole-page and current-panel PNG use the base language; the trilingual collage uses the selected compare languages. |

Panels and notes are stored once per page, not once per language. Alignment offsets are stored per language and, optionally, per panel.

## Warnings you will see

Library warnings are gossip, not errors: the page still opens.

| Warning | Meaning | Fix |
| --- | --- | --- |
| *No language directory recognized* | None of the subfolders matched an alias. | Map them in volume settings or rename them. |
| *Unrecognized directory: …* | Extra folders sit next to language folders. | Map them, or ignore them. |
| *Page counts differ across languages* | Languages have different numbers of files. | Pairing is by index; add or remove the missing page. |
| *Mixed extensions in this chapter* | e.g. `.jpg` and `.png` alternate. | Usually harmless; normalize if you care about consistent thumbnails. |
| *Filename does not match page number* | The leading number in the filename differs from its sorted position. | Rename if the mismatch indicates a missing or extra page. |

## Folder rules for unusual layouts

The default shape covers most libraries. If your folders put the series first, the language last, or have no language folder at all, open **Folder rules…** and describe the path with placeholders. Rules are tried in order and the first match wins; they only affect detection and never rename or move files.

The full syntax, rule fields and preview workflow are on [Folder Detection Rules](/guide/folder-rules).

## Import, exchange and restore

Four different entry points live in the sidebar. They do different things:

| Entry | Use it for |
| --- | --- |
| **Add manga** | Link an existing image folder into the library. |
| **Project file…** | Export or import a `.mnproj` package (images + annotations + templates + language settings). |
| **Exchange files…** | Move `.mntpl` layout templates, `.mnexp` export templates or a single `.mnpage.json` page. |
| **Backup / restore** | ZIP the `data/` folder, or restore a previous ZIP. |

Imports are validated first and the original files are backed up under `data/backups/`. See [Project Files & Formats](/guide/project-files) for the file contents and version rules.

::: tip Import order
Restore a **backup** when you want your annotations back on the same machine. Import a **project** when you move to another machine. Use **exchange files** when you only want to share a layout, an export style or one page.
:::

## Navigation and performance

| Action | Shortcut |
| --- | --- |
| Previous / next page | `[` / `]` |
| Panel workbench | `P` |
| Compare reader | `C` |
| Toggle sidebar | `S` |
| Toggle notes panel | `N` |
| Open export dialog | `E` |
| Help | `?` |

The URL hash is deep-linkable: `#/<volume>/<chapter>/<page>/<panels|compare>`.

Thumbnails are generated on demand and cached in `data/cache/thumbs/`. Deleting that folder is safe; thumbnails are rebuilt on the next visit. The image format is sniffed from the file header, so a `.png` that is really a JPEG still renders correctly.

## Common pitfalls

- **Renaming a file changes its page position.** Pairing is by sorted index; inserting a page shifts every page after it. Add the new page at the end, or rename the whole chapter consistently. See [Preparing & Renaming Images](/guide/preprocess).
- **One missing language is not an error.** The page opens, and the compare reader shows a placeholder for the missing language.
- **A folder link is not a copy.** If you move or delete the original folder, the library breaks. Re-add the folder after moving it.
- **WebP is displayed but not decoded for detection.** Use JPEG or PNG when you rely on automatic splitting (see [Panel Workbench](/guide/panels)).
- **The sidebar is the truth.** If a volume or chapter is missing, check the folder name casing and the language aliases before anything else.
- **A language dropdown does not offer the folder.** It is already assigned to another language in volume settings.

## Related

- [Preparing & Renaming Images](/guide/preprocess) — clean up scans before importing.
- [Folder Detection Rules](/guide/folder-rules) — non-standard directory layouts.
- [Panel Workbench](/guide/panels) — what to do after a page opens.
- [Project Files & Formats](/guide/project-files) — what a `.mnproj` contains.
- [Remote Storage & Backup](/guide/remote) — keeping images on a NAS or WebDAV.
