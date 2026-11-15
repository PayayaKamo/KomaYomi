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

The public site lives in the separate repository `https://github.com/PayayaKamo/KomaYomi-docs` and is served from `https://payayakamo.github.io/KomaYomi-docs/`. This `docs/` directory is the only source of truth; the publishing script mirrors it into that repository.

### How the sync works

`npm run docs:publish` (from the repository root) runs `scripts/publish-docs.mjs`:

1. Clones `KomaYomi-docs` into a temporary directory (nothing is added to the main repository's history).
2. Empties the checkout except `.git` and `.github`, then copies the current `docs/` tree — so deleted pages disappear instead of lingering.
3. Keeps any workflow that already exists in the target. If none is present, it installs `scripts/docs-pages-workflow.yml` as `.github/workflows/pages.yml`.
4. Commits and pushes to `main` with a normal fast-forward push (never `--force`).

Excluded from every publish: `node_modules`, `.vitepress/dist`, `.vitepress/cache`, `.template-tmp`, this `README.md`, and — unless `--with-screenshots` is passed — `public/assets/screenshots`.

### First publish

1. Create the empty `KomaYomi-docs` repository on GitHub (no README needed).
2. Make sure your machine can push to it, for example with `gh auth login` or an SSH key plus `DOCS_REMOTE=git@github.com:PayayaKamo/KomaYomi-docs.git`.
3. Preview the change set without pushing: `npm run docs:publish -- --dry-run`.
4. Push: `npm run docs:publish`.
5. In the repository settings, open **Pages** and set **Source** to **GitHub Actions** if it is not selected yet.
6. The first deployment usually appears within 1–3 minutes after the workflow finishes; if Pages was just enabled, allow up to about 10 minutes.

### Day-to-day updates

```bash
npm run docs:build            # verify locally first
npm run docs:publish -- --dry-run
npm run docs:publish
```

Every run replaces the target content wholesale, so reviews happen in the main repository. Add `--with-screenshots` to publish the sample-library captures (or remove the exclusion in `scripts/publish-docs.mjs`).

### Useful overrides

| Variable | Default | Purpose |
| --- | --- | --- |
| `DOCS_REMOTE` | `https://github.com/PayayaKamo/KomaYomi-docs.git` | Target repository URL, e.g. to use SSH. |
| `DOCS_BRANCH` | `main` | Target branch. |


## Reference template

The styling adapts a private VitePress starter template: its typography scale, brand-accent hero, card hover motion, wrapping tables, blurred navigation bar and print rules were adapted here on top of the standard VitePress default theme, keeping the KomaYomi orange palette and the three-locale content. The template was reviewed in a temporary `docs/.template-tmp/` directory (gitignored) and deleted afterwards; no copy remains in this repository.
