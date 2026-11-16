# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-11-16

### Added

- Note categories: three built-in types (Background, Vocabulary, Reaction) at page or panel
  scope, one generated category per enabled reading language (`lang:<code>`), and custom types
  with a name and colour stored in `data/library.json`. Notes can be filtered, grouped and added
  by type, and the category colour drives the type chips and compare-view markers.
- Panel detail view renders the page's Markdown notes and annotations inline and adds per-language
  alignment controls that move or reset one language or all of them for the session.
- Double-clicking anywhere on a compare row, including its margins, opens that panel's detail view.
- Start screen with six first-run steps and direct buttons for importing images, creating a
  library, opening a project and reading the guide.
- PNG export can target platform sizes (Xiaohongshu, Instagram, Pinterest, Webtoon and B5/A4/A5
  print); the artwork is fitted into the canvas with white margins instead of being cropped.
- Sidebar page list offers two-column thumbnails, single-column thumbnails and a list with
  languages and note counts, remembered per browser.
- Quick panel reordering: `1`–`10` move the selected panel to that position, and the custom
  right-click menu adds "Move to…" next to the full panel actions (text inputs keep the native
  menu).
- Page write protection: atomic replace (temp file, flush, rename), schema validation before
  every save (`ERR_PAGE_SAVE_INVALID`), `.bak` rotation (`KOMAYOMI_PAGE_BACKUPS`, default 3),
  a per-page write lock (`ERR_PAGE_BUSY`, reclaimed after 10 s) and automatic archiving of
  damaged files as `.corrupt-<timestamp>.bak`.
- Page and manifest schema v2: v1 notes are migrated to the default category and the original
  file is kept as `.v1.bak`.
- The CLI accepts an explicit project root and can be invoked in-process; new unit tests cover
  the CLI, page storage safety and PNG share sizes.

### Changed

- Editing an existing note reuses the single editor, whose button switches between adding a new
  note and saving changes.
- The original reading view can link or unlink pan and zoom across languages; entering it folds
  both side columns and leaving it restores the desktop layout.
- Edit and read-only modes remain available from the top bar, and the server rejects writes in
  read-only mode with `ERR_READ_ONLY`.
- Export is reached from the File menu instead of a separate top-bar button.
- Volume settings keep supporting chapter unlinking/restore and per-language page offsets.
- Runtime data under `data/` is no longer tracked: only `data/templates/` stays in the
  repository, so caches, pages, history and backups no longer dirty the working tree.

### Removed

- The bundled sample project and its artwork; the app, READMEs and documentation now point to a
  sample project that will be provided later.

### Documentation

- English, Chinese and Japanese documentation updated for note categories, the single editor,
  panel detail notes and alignment, the original view's linked mode, page write protection,
  schema v2, sidebar layouts, the start screen and export entry.
- READMEs aligned with the current feature set: screenshots use original demo artwork and the
  sample-project references now say it will be provided later.

## [0.2.0] - 2026-11-16

### Added

- Usage modes: an edit workspace and a read-only viewer. Read mode hides authoring tools and the
  server rejects every write outside the export/preview allowlist.
- Original reading view (`O`): the untouched scans per language, with pan and zoom, alongside the
  panel and compare views.
- Panel detail navigation across page boundaries: previous/next panel and previous/next page in a
  footer bar, deep links that survive a refresh, and edge steps that load the neighbouring page.
- Quick panel-order actions in the workbench: swap with previous/next panel, move to first/last and
  swap the two selected panels.
- Chapter unlinking from volume settings with restore, and per-language page offsets for editions
  that insert bonus pages mid-chapter.
- Multi-work raw roots: `raw/<work>/<volume>/<language>/<chapter>/<pages>` is scanned alongside the
  flat layout, volumes keep their series name in the sidebar and same-named volumes stay separate.
- Storage & cache panel: thumbnail, remote-image and export-staging sizes with separate clearing,
  plus an auto-detection reset that keeps hand-drawn panels, notes and annotations.
- WebP decoding for thumbnails, panel detection, page splitting and exports; the decoder and its
  WASM binary are bundled into the packed server.
- English/Chinese/Japanese labels for previous/next page in the compare toolbar, and a compact
  page/panel dock that stays reachable in reading mode.
- Unit tests for directory rules, library admin, cache admin, WebP decoding, PNG export, annotation
  surfaces, panel toolbar folding and recent pages.

### Changed

- Editing an existing note reuses the single top editor; the button reads "Save changes" instead of
  adding a second Markdown box.
- Removing a volume keeps the original images by default; deleting files on disk is an explicit
  opt-in and real directories under `raw/` are never removed automatically.
- Export is reached from the File menu instead of a separate top-bar button.
- Pages are paired across languages by the number in the filename when every language has unique
  numbers, falling back to sorted position otherwise; missing languages keep a placeholder column.
- Reading mode's exit hint refers to focus mode, and `Esc`/`R` remain the only exit/toggle controls.

### Tooling

- ESLint 9 flat config and Prettier, with `lint`, `lint:fix`, `format`, and `format:check` scripts.
- Conventional Commits enforcement via commitlint, Husky hooks, and lint-staged.
- GitHub Actions CI (lint → typecheck → test → build) for pull requests and `main`.
- Contribution guide, code of conduct, issue templates, and pull request template.
- Desktop release pipeline: pushing a `v*` tag builds Windows (NSIS + portable), macOS (dmg + zip) and
  Linux (AppImage + deb) for x64 and arm64 and attaches them to the GitHub Release. Builds are unsigned:
  Windows triggers SmartScreen, macOS needs a manual Gatekeeper bypass.

## [0.1.0] - 2026-11-15

### Added

- Initial public naming: **KomaYomi** (subtitle **Manga Learner**), author PayayaKamo.
- Local-first manga library with multi-language page alignment and panel annotation.
- Notes panel, layout templates, alignment presets, and paginated export (HTML/PDF/PNG).
- Portable exchange formats (`.mnproj`, `.mntpl`, `.mnexp`, `.mnpage.json`) with JSON Schemas.
- Electron desktop shell and local Node server hosted by Vite in development.
- MIT license, README, and VitePress documentation site under `docs/`.

## Release flow

1. Land changes on `dev` through Conventional Commit messages.
2. Move `[Unreleased]` entries in this file into a new version section
   (`## [x.y.z] - YYYY-MM-DD`) and bump `version` in `package.json` together with
   `package-lock.json` (`npm version <patch|minor|major> --no-git-tag-version`).
3. Open a release PR from `dev` to `main`, verify CI, and merge.
4. Tag the merge commit on `main` (`git tag vX.Y.Z && git push origin vX.Y.Z`) and publish
   release notes copied from this changelog. The same tag push runs
   `.github/workflows/release.yml`, which attaches the desktop packages for all six
   platform/architecture combinations to the release (tags with a hyphen, such as
   `v0.1.0-rc.1`, are published as prereleases).

Semantic versioning: breaking changes bump the major version, backwards-compatible
features bump the minor version, and fixes bump the patch version. While the project is
in `0.x`, the minor version carries breaking changes.
