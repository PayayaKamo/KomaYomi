# Contributing

Contributions are welcome. This page is the short version for people who already have the repository cloned; the canonical checklist is `CONTRIBUTING.md` at the repository root.

## Branch model

| Branch | Purpose |
| --- | --- |
| `main` | Released code. Updated only by release merges. |
| `dev` | Integration branch. All feature work lands here first. |
| `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>` | Short-lived topic branches cut from `dev`. |

Open pull requests against `dev`. Rebase on `dev` before asking for review.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/) are enforced by `commitlint` through a `commit-msg` hook:

```text
<type>(<scope>): <subject>
```

Common types are `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Use the imperative mood, lower case, and no trailing period:

- `feat(reader): add side-by-side gutter control`
- `fix(export): keep panel notes when image mode is embed`
- `docs(guide): document .mnproj storage modes`

Husky runs `lint-staged` on commit: ESLint `--fix` for TS/TSX, Prettier for JS/CJS/MJS/JSON/Markdown/YAML/CSS/HTML. Use `git commit --no-verify` only for a work-in-progress commit you will clean up before review.

## Code style

- TypeScript strict mode. Prefer explicit types at module boundaries.
- ESLint flat config (`eslint.config.js`) handles correctness; Prettier handles formatting. Do not add stylistic lint rules that duplicate Prettier.
- Server code is ESM TypeScript with explicit `.ts` import extensions. No CommonJS in `server/`, `shared/` or `src/`.
- `shared/` must not import `node:` modules or touch the DOM; both sides depend on it.
- Every user-facing string belongs in `src/i18n/` (`en`, `zh`, `ja`). A hard-coded Chinese string in a component fails `npm run i18n:scan:strict`.
- Server error and warning messages belong in `server/messages/catalog.ts`, keyed by code.
- A documentation page needs all three locales and matching nav/sidebar entries in `docs/.vitepress/config.mts`.

## Checks

Run these before pushing:

```bash:no-line-numbers
npm run lint
npm run typecheck
npm test
npm run i18n:scan
npm run docs:build
```

Tests live in `tests/unit/`; the most relevant suites when you touch formats, detection or the library are `formats.test.ts`, `project.test.ts`, `detect.test.ts`, `dirRules.test.ts` and `library.test.ts`. UI-only changes have no unit suite — verify them in the browser at 1440 px and at 390 px.

`npm run docs:build` fails on a dead link, so a renamed page must be updated in all three locales and in `config.mts` in the same change.

## A minimal feature change

Suppose you want the detector to record a `confidence` score on each panel.

**1. Type.** In `shared/types.ts`, add an optional field to `Panel`:

```ts
export type Panel = {
  id: string
  rect: { x: number; y: number; w: number; h: number }
  source: 'auto' | 'manual' | 'merged'
  number?: number
  /** Detector confidence, 0..1. Absent for manual panels. */
  confidence?: number
}
```

**2. Schema.** In `shared/format.ts`, add the field to `panelSpec`. Optional fields are omitted from the `required` list:

```ts
const panelSpec = object(
  {
    id: str({ minLength: 1 }),
    rect: rectSpec,
    source: str({ enum: ['auto', 'manual', 'merged'] }),
    number: int({ min: 1 }),
    confidence: num({ min: 0, max: 1 }),
  },
  ['id', 'rect'],
)
```

**3. Normalizer.** `normalizeDoc` in `server/storage.ts` rebuilds every panel field by field. Without this step the value is dropped before it reaches disk:

```ts
.map((p, i) => ({
  id: typeof p.id === 'string' && p.id ? p.id : `p${i + 1}`,
  source: p.source === 'auto' || p.source === 'merged' ? p.source : ('manual' as const),
  number: Number.isFinite(p.number) ? Math.max(1, Math.round(Number(p.number))) : undefined,
  confidence: Number.isFinite(p.confidence) ? clamp(Number(p.confidence), 0, 1) : undefined,
  rect: { /* unchanged */ },
}))
```

**4. Producer.** Set the value where panels are created, for example in `server/detect.ts` or `server/plugins.ts` if you want plugins to report it. A plugin can return `{ panels, warnings }` but the current contract has no per-panel metadata, so a plugin would need the field on each rect.

**5. Test.** In `tests/unit/formats.test.ts`, assert that a v1 page with `confidence` validates, and that an unknown field on the same panel still survives a write.

**6. UI and docs.** Render it in the panel inspector and add a label to `src/i18n/en.ts`, `zh.ts` and `ja.ts`. If users can see the value, add it to [Data formats](/development/data-formats).

The important lesson: adding a field to the TypeScript type is never enough on its own. The schema, the normalizer and the tests each have to agree, or the value disappears on the first save.

## Before opening a pull request

- Target `dev`, rebased on the latest `dev`.
- `lint`, `typecheck`, `test` and `docs:build` pass.
- New behavior has a test in the suite for that area, or a short note explaining why not.
- User-facing changes update the relevant page in all three locales.
- `CHANGELOG.md` has an entry under `[Unreleased]` for notable changes.
- No manga pages, personal data or secrets are added. Screenshots for README may use the sample volume only with the attribution note already in the README.
