# Contributing to KomaYomi

Thanks for helping improve KomaYomi! This guide covers the branch model, local setup,
commit convention, and PR checklist.

## Branch model

| Branch                                                     | Purpose                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `main`                                                     | Stable, released code. Only updated by release merges.                      |
| `dev`                                                      | Integration branch for the next release. All feature work lands here first. |
| `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>` | Short-lived topic branches cut from `dev`.                                  |

- Open pull requests **against `dev`**, not `main`.
- Keep topic branches small and rebase on `dev` before requesting review.
- Releases merge `dev` into `main`, tag the merge commit, and update `CHANGELOG.md`.

## Local setup

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run dev       # web app + local API
npm run desktop   # build and launch the Electron shell
```

Before pushing:

```bash
npm run lint
npm run typecheck
npm run build
```

`npm run format` applies Prettier; `npm run format:check` verifies formatting without
writing. Run `npm run format` on the files you touched, not across the whole tree.

## Commit convention

This repository follows [Conventional Commits](https://www.conventionalcommits.org/).
`commitlint` validates messages through a `commit-msg` hook.

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
`chore`, `revert`. Examples:

- `feat(reader): add side-by-side gutter control`
- `fix(export): keep panel notes when image mode is embed`
- `docs(guide): document .mnproj storage modes`

Subject in the imperative mood, lower-case, no trailing period. Reference issues in the
footer (`Closes #123`).

## Hooks

`npm install` installs Husky hooks:

- `pre-commit` runs `lint-staged` on staged files only (ESLint `--fix` for TS/TSX,
  Prettier for JS/MJS/CJS/JSON/Markdown/YAML/CSS/HTML).
- `commit-msg` runs `commitlint`.

Hooks are intentionally fast; if you must bypass one for a work-in-progress commit, use
`git commit --no-verify` and fix the issue before opening a PR.

## Pull request checklist

- [ ] Branch targets `dev` and is rebased on the latest `dev`.
- [ ] `npm run lint`, `npm run typecheck`, and `npm run build` pass locally.
- [ ] New behavior is covered by tests when a test suite exists for that area.
- [ ] User-facing changes update the relevant page under `docs/`.
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]` for notable changes.
- [ ] Screenshots or recordings are attached for UI changes.
- [ ] No copyrighted manga pages, personal data, or secrets are added to the repository.

## Code style

- TypeScript strict mode; prefer explicit types at module boundaries.
- ESLint flat config (`eslint.config.js`) handles correctness rules; Prettier handles
  formatting. Do not add stylistic ESLint rules that duplicate Prettier.
- Keep localized UI copy in Chinese unless the surrounding component already uses another
  language.

## Reporting bugs / requesting features

Use the GitHub issue templates. For security issues, do not open a public issue; contact
the maintainer through GitHub instead.
