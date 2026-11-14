# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- ESLint 9 flat config and Prettier, with `lint`, `lint:fix`, `format`, and `format:check` scripts.
- Conventional Commits enforcement via commitlint, Husky hooks, and lint-staged.
- GitHub Actions CI (lint → typecheck → test → build) for pull requests and `main`.
- Contribution guide, code of conduct, issue templates, and pull request template.

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
4. Tag the merge commit on `main` (`git tag vX.Y.Z && git push --tags`) and publish
   release notes copied from this changelog.

Semantic versioning: breaking changes bump the major version, backwards-compatible
features bump the minor version, and fixes bump the patch version. While the project is
in `0.x`, the minor version carries breaking changes.
