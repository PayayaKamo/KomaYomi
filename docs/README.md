# KomaYomi Documentation Site

VitePress documentation for the KomaYomi project. This site documents the application; it contains **no application code**. All files for the site live under `docs/`, including its own `package.json` and lockfile.

## Commands

Run from this `docs/` directory:

```bash
npm install
npm run docs:dev      # dev server at http://127.0.0.1:5174
npm run docs:build    # static output in .vitepress/dist
npm run docs:preview  # preview the production build
```

From the repository root:

```bash
npm --prefix docs run docs:dev
npm --prefix docs run docs:build
```

## Structure

```text
docs/
  .vitepress/
    config.mts          # site config, nav, three locales, sidebars, SEO/OG/JSON-LD
    theme/index.ts      # default theme, external-link handling
    theme/Layout.vue    # default layout + breadcrumbs and footer slots
    theme/Breadcrumbs.vue
    theme/Footer.vue
    theme/custom.css
  public/
    logo.svg
    robots.txt
    social-card.png     # branded 1200x630 share image
    shots/*.svg         # screenshot placeholders
  404.md
  guide/                # English guide
  index.md              # English home
  concepts.md
  data-format.md
  extending.md
  remote-backup.md
  faq.md
  zh/                   # Chinese translation (same page set)
  ja/                   # Japanese translation (same page set)
```

English is the root locale. Chinese lives under `/zh/` and Japanese under `/ja/`; each has its own nav and sidebar entries in `config.mts`.

## SEO and sharing

- Every page gets a unique `<title>` and `<meta name="description">`. Descriptions come from page frontmatter; when absent, `transformPageData` derives one from the page's first paragraph (with a localized fallback).
- `transformHead` emits a self-referencing canonical URL, three `hreflang` alternates plus `x-default`, Open Graph tags, Twitter Card tags and JSON-LD.
- JSON-LD is deliberately small: `WebSite` + `SoftwareApplication` on the home pages, `TechArticle` + `BreadcrumbList` on documentation pages.
- `sitemap.xml` is generated at build time and includes `xhtml:link` alternates for the three locales. `404` and the contributor `README.md` are excluded.
- Local search, breadcrumbs, previous/next links and a custom 404 page are enabled.
- External links open in a new tab (`markdown.externalLinks` plus a runtime handler in the theme).

### Site identity

| Item | Value | Notes |
| --- | --- | --- |
| Production URL | `https://payayakamo.github.io/KomaYomi-docs/` | Set once in `SITE_URL` inside `config.mts`. It feeds canonical, hreflang, OG/Twitter URLs, JSON-LD and the sitemap. |
| Path prefix | `/KomaYomi-docs/` | `base` in `config.mts`. Builds use it; `npm run docs:dev` sets `DOCS_BASE=/` so local development runs at the server root. |
| `robots.txt` sitemap URL | `https://payayakamo.github.io/KomaYomi-docs/sitemap.xml` | Keep in sync with `SITE_URL`. |
| Social share image | `public/social-card.png` | Branded 1200×630 card. |
| Screenshots | `public/assets/screenshots/*.png` | Add the remaining captures listed in each guide page's *Missing screenshots* table and swap the `.shot-missing` blocks for `<img>` tags. |

Changing the production URL means updating `SITE_URL` in `config.mts` and the sitemap line in `public/robots.txt`, then rebuilding and confirming that `sitemap.xml`, canonical tags and OG URLs all use the new address.

## Screenshots

Real captures live in `public/assets/screenshots/` and are referenced as `/assets/screenshots/<name>.png`. Use English hyphenated names and keep a consistent viewport (for example 1440×900) so figures line up across languages. Pages that still need a capture contain a `.shot-missing` block and list it under *Missing screenshots*; replace that block with a `<figure class="shot"><img …></figure>` using the same path in all three languages.

> **Screenshots:** every current capture uses the CC0 `samples/demo-library/` (Star Cafe) and contains no third-party manga. `npm run docs:publish` still skips `public/assets/screenshots/` by default; pass `--with-screenshots` to include them.

## Status labels

The product is under active development. Features that are not in the code are marked:

```md
<Badge type="warning" text="Planned" />
```

Before adding or changing a feature description, verify it in the source (`src/`, `server/`, `shared/`, `scripts/`). Do not describe planned behavior as shipped.

## Publishing to GitHub Pages

The public site is served from `https://payayakamo.github.io/KomaYomi-docs/` by the separate repository `https://github.com/PayayaKamo/KomaYomi-docs`. This `docs/` directory is the only source of truth: that repository holds **build output only** — no VitePress source, no `package.json`, no workflow.

### How publishing works

`.github/workflows/docs.yml` in this repository runs on every push to `main` that touches `docs/**`, and can be started manually:

1. Install dependencies and build inside `docs/` (`npm ci`, `npm run docs:build`).
2. Clone `KomaYomi-docs`, remove everything except `.git`, and copy `docs/.vitepress/dist` in — so deleted pages disappear instead of lingering.
3. Commit and push a normal fast-forward commit to `main` (never `--force`).
4. GitHub Pages serves that branch under the `/KomaYomi-docs/` subpath, which is the `base` in `config.mts`.

The workflow authenticates with the repository secret `DOCS_PUBLISH_TOKEN`. It needs write access to `PayayaKamo/KomaYomi-docs` (fine-grained: **Contents: read and write**; classic: `repo`). Create or rotate it with:

```bash
gh secret set DOCS_PUBLISH_TOKEN --repo PayayaKamo/KomaYomi
```

Never commit the token — the workflow only reads it from the secret.

### Pages settings

In `PayayaKamo/KomaYomi-docs` → **Settings → Pages**, the source must be **Deploy from a branch**, branch `main`, folder `/ (root)`.

### Local check

```bash
npm run docs:build            # output in docs/.vitepress/dist
```

Everything under `docs/` except VitePress internals and this `README.md` (`srcExclude`) ends up on the live site.

## Reference template

The styling adapts a private VitePress starter template: its typography scale, brand-accent hero, card hover motion, wrapping tables, blurred navigation bar and print rules were adapted here on top of the standard VitePress default theme, keeping the KomaYomi orange palette and the three-locale content. The template was reviewed in a temporary `docs/.template-tmp/` directory (gitignored) and deleted afterwards; no copy remains in this repository.
