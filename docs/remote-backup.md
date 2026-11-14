# Remote Storage & Backup

## What exists today

KomaYomi is **local-disk only**. It reads images from `raw/`, writes annotations to `data/`, and writes generated files to `exports/`. It does not open network connections except optionally fetching a page title for a note source.

Two portable safety nets are implemented:

### Backup ZIP

- Creates a ZIP of `data/` with every entry prefixed by `data/` and a `data/.backup-meta.json` marker.
- Excludes the thumbnail cache and `.tmp` / `.log` files.
- The file is written to `exports/` and offered as a download.
- **Inspect before restore** shows file count, page count, note count, volumes, templates, presets, how many files would be overwritten and the archive size.
- **Restore** writes same-named files under `data/`, but does not delete pages that are absent from the backup. A snapshot of the current data is written to `exports/` before anything is overwritten, so a mis-click is reversible.

### `.mnproj` project package

A ZIP with `manifest.json`, page JSON, templates and presets, in one of two modes:

- **Reference** — records image paths and SHA-1 hashes. Small. If images moved, import can **relink** them from a chosen folder by hash first, then by filename.
- **Packaged** — embeds deduplicated images under `assets/<sha1>.<ext>`. Self-contained and portable, but large.

Import behavior:

- A snapshot of `data/` is written first.
- The original package is kept under `data/backups/projects/`.
- Conflicts can be resolved as **overwrite**, **merge** or **skip**.
- **Merge** preserves existing panels/annotations when the incoming page lacks them, unions notes by id, and never deletes existing notes.

See [Data Formats](/data-format) for the manifest fields and folder layout.

## Recommended local practice

1. **Keep `raw/` on a large local disk** (or an attached drive). It is the bulk of the data and is gitignored.
2. **Back up `data/` regularly** with the Backup ZIP. It is small — mostly JSON — and contains all your work.
3. **Use `.mnproj` reference mode** to move annotations between machines that already have the same images.
4. **Use `.mnproj` packaged mode** to hand a self-contained project to someone else.
5. **Keep a copy of `exports/`** if you want to preserve generated study documents; it is gitignored and can be regenerated.

## Why not just sync the folders?

You can put `raw/`, `data/` and `exports/` on a network drive or in a synced folder. The app does not lock files, but writes are atomic (`.tmp` + rename), so a sync client is unlikely to observe a partially written JSON. Avoid editing the same page from two machines at once; last write wins.

## Planned: remote backends

The following are **not implemented** and are listed here so expectations are clear:

- <Badge type="warning" text="Planned" /> **WebDAV backend** — store and version `data/` on a WebDAV server.
- <Badge type="warning" text="Planned" /> **Network-drive aware library** — browse a volume over SMB/NFS without copying it locally.
- <Badge type="warning" text="Planned" /> **On-demand image cache** — fetch page images lazily and keep an LRU cache.
- <Badge type="warning" text="Planned" /> **Offline write queue** — queue annotation writes while disconnected and reconcile on reconnect.
- <Badge type="warning" text="Planned" /> **Scheduled backups** — automatic periodic snapshots.

Until then, treat the Backup ZIP and `.mnproj` as the supported transfer mechanisms. They are complete, tested by the app's own import/export flow, and require no server.

## Restore checklist

1. Click **Backup** and confirm the ZIP appears in `exports/`.
2. To restore: choose **Inspect**, review the counts, then **Restore**.
3. After restoring, reload the library; pages with annotations get a badge in the sidebar.
4. If a project import reports missing images, point **relink directory** at the folder that contains them and import again with **merge**.
