# Data Formats

KomaYomi keeps every piece of state as JSON on disk. This page is the developer reference for those files: the shared envelope, the shapes you are most likely to script against, and the rules that keep an old file readable after the code moves on.

The user-facing overview is [Project Files & Formats](/guide/project-files); the authoritative runtime validator is `shared/format.ts`.

## The envelope

Exchange files and stored files share one header:

```json
{
  "$schema": "https://manga-memo.dev/schemas/page.schema.json",
  "schemaVersion": 1,
  "kind": "page",
  "appVersion": "0.1.0"
}
```

| Key | Meaning |
| --- | --- |
| `$schema` | Canonical URL of the format. Informational; the app never fetches it. |
| `schemaVersion` | Integer version. A file without the key is treated as v0. |
| `kind` | Discriminator: `page`, `mnproj`, `mntpl`, `mnexp`, `mntp`, `mnalign`, `mnlayout`, `mnconfig`, `mnstorage`, `mnhistory`. |
| `appVersion` | Build that produced the file. Diagnostics only; never used to pick a migration. |

A `.mnproj` manifest is the one exception — it carries `$schema`, `schemaVersion` and `appVersion` but no `kind`, because the archive itself identifies the format.

## Formats at a glance

| `kind` | On disk | Extension | Holds |
| --- | --- | --- | --- |
| `page` | `data/pages/<volume>/<chapter>/<index>.json` | `.mnpage.json` on export | Panels, notes, offsets, groups, annotations, edit metadata. |
| `mnconfig` | `data/library.json` | — | Volume overrides, directory rules, language order, history limit, auto-backup schedule. |
| `mnproj` | `manifest.json` inside a `.mnproj` ZIP | `.mnproj` | Project name, storage mode, language mapping, image inventory, note counters. |
| `mntpl` | Exported layout template | `.mntpl` | Row/column grid, margins, gap, column weights, page overrides. |
| `mnexp` | `data/templates/export.json` entries | `.mnexp` | Export dialog configuration. |
| `mntp` | `data/templates/panels/<id>.json` | — | Saved panel rectangles and reading direction. |
| `mnalign` | `data/presets/align/<id>.json` | — | Alignment offsets for a page or chapter. |
| `mnlayout` | `data/layouts/<id>.json` | — | Declarative layout bound to a volume, chapter or page. |
| `mnstorage` | `data/storage.json` | — | Storage provider, credentials, cache limits. |
| `mnhistory` | `data/history/<volume>/<chapter>/<index>.json` | — | Cross-session page snapshots. |

## Page document

One file per page, zero-based index. Rectangles and points are normalized to the page, `0..1`.

```json
{
  "$schema": "https://manga-memo.dev/schemas/page.schema.json",
  "schemaVersion": 1,
  "kind": "page",
  "appVersion": "0.1.0",
  "volume": "点兔第14卷",
  "chapter": "172",
  "pageIndex": 0,
  "panels": [
    { "id": "p1", "rect": { "x": 0.04, "y": 0.03, "w": 0.44, "h": 0.31 }, "source": "auto", "number": 1 },
    { "id": "p2", "rect": { "x": 0.52, "y": 0.03, "w": 0.44, "h": 0.31 }, "source": "manual", "number": 2 }
  ],
  "notes": [
    {
      "id": "n1712345678901",
      "scope": "panel",
      "panelId": "p1",
      "text": "**原文**：……\n\n翻译更正式。",
      "tags": ["语气", "待确认"],
      "source": { "title": "参考页面", "url": "https://example.com" },
      "createdAt": "2026-05-12T10:00:00.000Z",
      "updatedAt": "2026-05-12T10:05:00.000Z"
    }
  ],
  "offsets": {
    "ja": { "x": 0, "y": 0, "scale": 1 },
    "zh": { "x": 0.01, "y": -0.005, "scale": 1.02 }
  },
  "alignMode": "panel",
  "panelOffsets": {
    "p1": { "zh": { "x": 0.01, "y": 0, "scale": 1 } }
  },
  "gridStep": 1,
  "readingDirection": "rtl",
  "detectorVersion": "xycut-1.3",
  "detectedAt": "2026-05-12T09:59:00.000Z",
  "detectSource": "auto",
  "editCount": 7,
  "lastEditedAt": "2026-05-12T10:05:00.000Z",
  "lastEditSummary": "调整格框；修改批注",
  "groups": [{ "id": "g1", "name": "跨页大图", "panelIds": ["p2", "p3"], "number": 1 }],
  "annotations": [
    {
      "id": "a1",
      "kind": "arrow",
      "scope": "panel",
      "panelId": "p1",
      "points": [{ "x": 0.1, "y": 0.2 }, { "x": 0.8, "y": 0.7 }],
      "color": "#c2410c",
      "width": 3,
      "opacity": 0.9,
      "createdAt": "2026-05-12T10:00:00.000Z",
      "updatedAt": "2026-05-12T10:00:00.000Z"
    }
  ],
  "annotationsVisible": true,
  "updatedAt": "2026-05-12T10:05:00.000Z"
}
```

Rules worth knowing before you write a page by hand:

- `panels[].id` is page-local and must be unique. `source` is `auto`, `manual` or `merged`; `number` is optional.
- `notes[].scope` is `page` or `panel`; a panel note needs `panelId`. Notes without a string `text` are dropped.
- `offsets[lang].scale` is clamped to `0.2..4`. `gridStep` is a percentage clamped to `0.1..10`.
- `readingDirection` accepts `rtl`, `ltr`, `ttb`, `horizontal-rl`, `horizontal-lr`, `vertical-rl`, `vertical-lr`. The removed value `continuous-vertical` is read as `rtl`.
- Annotation `kind` is one of `arrow`, `rect`, `ellipse`, `highlight`, `text`, `badge`, `mosaic`, `pen`. Freehand pen strokes use every point; arrows use the first and last.
- `groups[].panelIds` is ordered, and that order drives export order and compare stepping. Dangling ids are removed on read.

## `data/library.json`

```json
{
  "$schema": "https://manga-memo.dev/schemas/mnconfig.schema.json",
  "schemaVersion": 1,
  "kind": "mnconfig",
  "appVersion": "0.1.0",
  "volumes": {
    "点兔第14卷": {
      "title": "点兔 第14卷",
      "dirs": { "ja": "raw-ja", "zh": "raw-zh" },
      "defaultDirection": "rtl",
      "chapters": {
        "172": { "title": "第172话", "order": [0, 1, 2], "excluded": [12], "kinds": { "0": "cover" } }
      }
    }
  },
  "rules": [
    {
      "id": "volume-language-chapter-page",
      "pattern": "{volume}/{language}/{chapter}/{page}"
    }
  ],
  "langOrder": ["ja", "zh", "en"],
  "historyLimit": 50,
  "autoBackup": { "enabled": true, "intervalHours": 24, "keep": 7 }
}
```

- `volumes` holds overrides only; folders on disk are never renamed.
- `rules` is tried in order and falls back to the built-in shape when empty. See [Folder rules](/development/folder-rules).
- `langOrder` is a preference. Language ids discovered during a scan are appended after the configured ones.
- `historyLimit` defaults to 50 and is clamped to `5..200`.
- `autoBackup` is optional; the schedule runs while the app or server is running.

## `.mnproj` project package

A `.mnproj` is a ZIP. Reference mode stores paths and hashes; packaged mode adds the image bytes.

```text
manifest.json
pages/<volume>/<chapter>/<index>.json
history/<volume>/<chapter>/<index>.json
templates/...
presets/...
config/library.json          (optional)
assets/<sha1>.<ext>          (packaged mode only)
```

A reference-mode manifest:

```json
{
  "$schema": "https://manga-memo.dev/schemas/mnproj.schema.json",
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "createdAt": "2026-05-12T10:00:00.000Z",
  "updatedAt": "2026-05-12T10:00:00.000Z",
  "storageMode": "reference",
  "name": "点兔第14卷 学习笔记",
  "language": {
    "volumes": { "点兔第14卷": { "ja": "raw-ja", "zh": "raw-zh" } },
    "resolved": { "点兔第14卷": { "ja": "raw-ja", "zh": "raw-zh" } }
  },
  "inventory": {
    "volumes": [
      {
        "volume": "点兔第14卷",
        "languages": ["ja", "zh"],
        "langDirs": { "ja": "raw-ja", "zh": "raw-zh" },
        "chapters": [{ "chapter": "172", "pages": 18, "images": 36 }]
      }
    ],
    "pageCount": 18,
    "images": [
      {
        "volume": "点兔第14卷",
        "chapter": "172",
        "pageIndex": 0,
        "lang": "ja",
        "name": "001.jpg",
        "sha1": "9f2c…",
        "size": 245678,
        "path": "raw/点兔第14卷/raw-ja/172/001.jpg"
      }
    ]
  },
  "notes": { "pages": 18, "noteCount": 42, "annotationCount": 0, "text": "optional user memo" }
}
```

In packaged mode each image entry replaces `path` with `asset: "assets/<sha1>.<ext>"`, and import writes those images into `raw/`.

Import checks collisions per file and offers **Overwrite**, **Merge** or **Skip**. Merge keeps existing panels and annotations when the incoming page lacks them, unions notes by id (incoming wins for the same id), and never deletes notes that exist only locally.

## `.mntpl` layout template

Exported layouts strip the volume / chapter / page binding and become reusable:

```json
{
  "$schema": "https://manga-memo.dev/schemas/mntpl.schema.json",
  "schemaVersion": 1,
  "kind": "mntpl",
  "appVersion": "0.1.0",
  "id": "four-panel",
  "name": "四格等分",
  "scope": "template",
  "readingDirection": "rtl",
  "margin": { "top": 0.03, "right": 0.03, "bottom": 0.03, "left": 0.03 },
  "gap": 0.012,
  "colWeights": [1, 1],
  "grid": {
    "cols": 2,
    "rows": [
      { "height": 1, "cells": [{}, {}] },
      { "height": 1, "cells": [{}, {}] }
    ]
  },
  "pageOverrides": {
    "2": { "gap": 0.02 }
  },
  "createdAt": "2026-05-12T10:00:00.000Z",
  "notes": "用于第172话大部分页面"
}
```

Stored layouts (`data/layouts/<id>.json`, kind `mnlayout`) use the same grid but instead carry `scope: "page" | "chapter" | "volume"` plus `volume`, `chapter` and `pageIndex`, so detection can apply them automatically. `pageOverrides` keys are **1-based** page numbers.

## `.mnexp` export template

A complete template — the same object is stored inside `data/templates/export.json` and written to a `.mnexp` file:

```json
{
  "$schema": "https://manga-memo.dev/schemas/mnexp.schema.json",
  "schemaVersion": 1,
  "kind": "mnexp",
  "appVersion": "0.1.0",
  "id": "exp-1712345678901",
  "name": "Left image, notes right",
  "createdAt": "2026-05-12T10:00:00.000Z",
  "config": {
    "template": "two-column",
    "title": "漫画对照批注",
    "languages": ["ja", "zh"],
    "embedImages": false,
    "showPanelBoxes": false,
    "includeNotes": true,
    "onlyWithNotes": false,
    "noteFilterTags": [],
    "pageWidthRatio": 46,
    "columnGap": 28,
    "fontScale": 1,
    "columns": 1
  }
}
```

`template` is `two-column`, `stack` or `compare-wide`. Scope (`volume`, `chapter`, `pageIndices`) and `offsets` are chosen at export time and are not stored in a template. See [Export templates](/development/export-templates) for the field-by-field table.

## Versions, migration and unknown fields

### Reading an exchange file

`prepareExchange(kind, value)` runs four steps in order:

1. `checkSchemaVersion` — a higher `schemaVersion` throws instead of being downgraded.
2. Migrations `0 → 1 → … → current`, one function per step in `shared/format.ts` and `shared/migrations.ts`.
3. `finalizeEnvelope` — the app writes `$schema`, `schemaVersion`, `kind` and `appVersion`.
4. Full validation. Errors carry a path such as `manifest.volumes[2].chapters: required`.

Nothing is written until all four steps succeed, so an import never leaves a half-file.

### Reading a stored file under `data/`

`server/schemaStore.ts` is the only module that reads and writes these files:

- Older files are migrated on read and rewritten in place. The original bytes are copied once to `<file>.v<oldVersion>.bak` first.
- Validation is tolerant (`strict: false`): a missing optional field must not lock a user out.
- A file from a newer build is returned as-is but any write is refused with HTTP `409` and `ERR_SCHEMA_TOO_NEW`.
- Writes are atomic: JSON goes to a temporary sibling and is renamed over the target.

### Unknown fields survive a round trip

`preserveUnknown(previous, next)` merges the file already on disk into the value about to be written:

- Unknown object keys are copied recursively.
- Arrays of objects with an `id` are merged element by element by that `id`.
- Other arrays take the new value; order and deletion are the writer's decision.

This is what makes "open in a newer build, save in an older build, reopen in the newer build" lossless for fields the older build does not understand.

One caveat for page documents: `normalizeDoc` in `server/storage.ts` rebuilds panels, notes and annotations field by field before `preserveUnknown` runs. Unknown fields on an existing object survive through the merge, but a field that exists only on a *new* panel or note is not written unless `normalizeDoc` knows about it. Adding a field to the type is not enough.

### Version history

There is no v2 yet. Migrations are designed so v2 can be added without touching call sites. Removing a field value does not need a bump: `continuous-vertical` was removed and is read as `rtl`.

Content language ids are runtime strings, not a fixed enum. `ja`, `zh` and `en` keep their display names; any other id is treated as a language and shown with a generic label. `library.langOrder`, volume `langDirs`, page `files` and export `languages` all accept any id.

## Changing a format safely

Adding an optional field does not need a version bump:

1. Add it to the type in `shared/types.ts` as optional.
2. Add it to the matching spec in `shared/format.ts` as optional (keep it out of `required`).
3. If it lives on a panel, note or annotation, teach `normalizeDoc` in `server/storage.ts` to keep it.
4. Document it in `shared/schemas/*.json` if the format is user-facing.
5. Add a case to `tests/unit/formats.test.ts` proving an old file still loads and the field survives a write.

Bump `schemaVersion` and append a migration when:

- an existing field changes meaning or type;
- a previously optional field becomes required;
- data has to be restructured (for example, moving keys into a nested object).

To add a whole new format:

1. Add `SCHEMA_URLS`, `FORMAT_LABEL`, `FORMAT_EXTENSION` and `CURRENT_SCHEMA_VERSION` entries in `shared/format.ts`.
2. Add a spec in the same file.
3. Add a `MIGRATIONS` entry for v0.
4. Add `shared/schemas/<kind>.schema.json` if users can import it.
5. Read and write through `readStoredFile` / `writeStoredFile` from `server/schemaStore.ts`.

## Recovering a file

1. Stop the app so nothing rewrites the file.
2. Find `<name>.json.v0.bak` next to the migrated file.
3. Replace the migrated file with the backup and restore its original name.

Backups are written once per version, never deleted by the app, excluded from project packages and exports, and ignored by git.

## Tests that pin this down

`npm test` covers the parts most likely to break:

- v0 → v1 page migration, including removing the legacy `version` key, and idempotency.
- Manifest v0 folding (`images`, `langDirs`, `pageCount`) into `inventory`.
- Unknown top-level and nested fields surviving read → write.
- A `.v0.bak` backup being created before the first in-place migration.
- A future-schema file opening read-only and refusing writes with `ERR_SCHEMA_TOO_NEW`.
- Rejection of a newer `schemaVersion` on import.
