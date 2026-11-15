# File formats and schema versioning

KomaYomi keeps every piece of project state as JSON on disk: the project manifest, page
panels and notes, templates, and local configuration. All of them share one envelope and one
migration chain, so a file written by an older build stays readable, and a file written by a
newer build is never silently damaged.

This document is the reference for that system. It is written for contributors who add a
field, add a format, or need to recover a file by hand.

## The envelope

Every persisted JSON file starts with the same four keys:

```json
{
  "$schema": "https://manga-memo.dev/schemas/page.schema.json",
  "schemaVersion": 1,
  "kind": "page",
  "appVersion": "0.1.0"
}
```

| Key             | Meaning                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `$schema`       | Canonical URL of the format. Informational only; the app never fetches it.                       |
| `schemaVersion` | Integer version of the format. A file without the key is treated as v0 (pre-1.0 layout).         |
| `kind`          | Discriminator, also written into exchange files. Stored files keep their own file names.         |
| `appVersion`    | Version of the build that produced the file. Diagnostics only; never used to choose a migration. |

The app version is injected once at startup (`setFormatAppVersion`) so it has a single source:
`package.json`.

## Formats

| `kind`      | Where it lives                                   | User extension | What it holds                                                                     |
| ----------- | ------------------------------------------------ | -------------- | --------------------------------------------------------------------------------- |
| `mnproj`    | `manifest.json` inside a `.mnproj` package       | `.mnproj`      | Project name, storage mode, language directories, image inventory, note counters. |
| `mntpl`     | exported layout template                         | `.mntpl`       | Row/column grid, margins, gap, column weights, per-page overrides.                |
| `mnexp`     | exported export-preset template                  | `.mnexp`       | Export dialog configuration (template, languages, notes/box toggles, typography). |
| `page`      | `data/pages/<volume>/<chapter>/<pageIndex>.json` | `.mnpage.json` | Panels, page/panel notes, alignment offsets, groups, annotations, edit metadata.  |
| `mntp`      | `data/templates/panels/<id>.json`                | —              | Saved panel layout (list of normalized rectangles) plus reading direction.        |
| `mnalign`   | `data/presets/align/<id>.json`                   | —              | Shared alignment preset (page or panel offsets per language).                     |
| `mnlayout`  | `data/layouts/<id>.json`                         | —              | Declarative layout bound to a volume, chapter, or page.                           |
| `mnconfig`  | `data/library.json`                              | —              | Library volume directories, declarative directory rules, language order.          |
| `mnstorage` | `data/storage.json`                              | —              | Storage provider (local / UNC / WebDAV), credentials, cache limits.               |

The four JSON Schemas under `shared/schemas/` describe the exchange formats (`mnproj`,
`mntpl`, `mnexp`, `page`). The runtime validator in `shared/format.ts` is the source of truth;
the schema files are a readable mirror for editors and external tools.

## Version history

### v0 — pre-1.0 files (no envelope)

- Page documents used `version: 1` instead of `schemaVersion`, and had no `$schema`/`kind`.
- `data/storage.json` also used `version`.
- The project manifest kept `images`, `langDirs`, and `pageCount` at the top level, and image
  entries could use `file` instead of `path`.

### v1 — current

- Envelope on every format, with `schemaVersion` as the only version field.
- `version` was removed from pages and from `data/storage.json`.
- Manifest image inventory moved under `inventory`, and legacy top-level keys were folded in.
- `appVersion` is written on export and on every stored-file write.

There is no v2 yet. The chain is designed so v2 can be added without touching call sites.

## Reading a file

### Exchange files (import)

`prepareExchange(kind, value)` runs strictly:

1. `checkSchemaVersion` — a higher version throws instead of being downgraded.
2. Migration chain `0 → 1 → … → CURRENT_SCHEMA_VERSION[kind]`, one function per step.
3. `finalizeEnvelope` — `$schema`, `schemaVersion`, `kind`, `appVersion` are set by the app.
4. Full field validation; every error carries a path such as `manifest.volumes[2].chapters: required`.

Nothing is written until all four steps succeed, so a failed import never leaves a half-file.

### Data files under `data/` (open in place)

`server/schemaStore.ts` is the only module that reads and writes these files:

- Older files are migrated on read and rewritten in place. The original bytes are copied once
  to `<file>.v<oldVersion>.bak` before the first rewrite.
- Migration is intentionally tolerant (`strict: false`): a missing optional field must not lock
  a user out of a page. Imported exchange files still get full validation.
- Files newer than this build are returned as-is so the user can still read them, but any write
  is refused with HTTP 409 and the code `ERR_SCHEMA_TOO_NEW`
  (“This file was written by a newer KomaYomi …”). The file on disk is left untouched.
- Writes are atomic: JSON is written to a temporary sibling and then renamed.

## Unknown fields are preserved

`preserveUnknown(previous, next)` merges the file that is already on disk into the value about
to be written:

- Unknown object keys are copied through recursively.
- Arrays of objects that carry an `id` are merged element by element by that `id`.
- Other arrays take the new value (order and deletion are the writer's decision).

This is what makes “open in a newer build, save in an older build, reopen in the newer build”
lossless for fields the older build does not understand.

## Changing a field without breaking old files

Adding an **optional** field does not need a version bump:

1. Add it to the TypeScript type as optional (`confidence?: number`).
2. Add it to the matching spec in `shared/format.ts` as optional (keep it out of `required`).
3. Optionally document it in `shared/schemas/*.json`.

Old files load with the field missing; new files carry it; older builds keep it on rewrite via
`preserveUnknown`. Example: adding `panelConfidence` to `pageSpec`'s panel entries.

Bump `schemaVersion` and append a migration function when:

- an existing field changes meaning or type,
- a previously optional field becomes required,
- data has to be restructured (for example, moving keys into a nested object).

## Adding a new format

1. `SCHEMA_URLS`, `FORMAT_LABEL`, `FORMAT_EXTENSION`, `CURRENT_SCHEMA_VERSION` in `shared/format.ts`.
2. A spec in the same file (stored-only formats may validate the envelope and key fields only).
3. A `MIGRATIONS` entry for v0 (usually `(value) => ({ ...value })`).
4. A JSON Schema file under `shared/schemas/` if the format is user-facing.
5. Read/write through `readStoredFile` / `writeStoredFile` from `server/schemaStore.ts`.

## Recovering a file

1. Stop the app so nothing rewrites the file.
2. Find `<name>.json.v0.bak` next to the migrated file.
3. Replace the migrated file with the backup (and restore the backup's original name).

Backups are written once per version, never deleted by the app, and ignored by git. They are
also excluded from project packaging and export.

## Code map

| File                         | Responsibility                                                          |
| ---------------------------- | ----------------------------------------------------------------------- |
| `shared/format.ts`           | Envelope, specs, version checks, migration dispatch, `preserveUnknown`. |
| `shared/migrations.ts`       | Pure `v0 → v1` migration functions (no disk access, unit-testable).     |
| `shared/schemas/*.json`      | JSON Schema mirrors of the exchange formats.                            |
| `server/schemaStore.ts`      | Read/migrate/write `data/` files, `.bak` backups, 409 for newer files.  |
| `server/messages/catalog.ts` | User-facing messages for `ERR_SCHEMA_TOO_NEW` / `ERR_SCHEMA_MIGRATION`. |
| `tests/unit/formats.test.ts` | Migration, unknown-field, backup, and newer-version behavior.           |

## Tests

`npm test` (Vitest) covers:

- v0 → v1 page migration, including removal of the legacy `version` key and idempotency.
- Manifest v0 folding (`images` / `langDirs` / `pageCount`) into `inventory`.
- Unknown top-level and nested fields surviving read → write.
- A `.v0.bak` backup being created before the first in-place migration.
- A file from a future schema opening read-only and refusing writes with `ERR_SCHEMA_TOO_NEW`.
- Rejection of a newer `schemaVersion` on import.
