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

### Placeholders that must be replaced before launch

| Item | Current value | Action |
| --- | --- | --- |
| Production domain | `https://komayomi.example.com` in `config.mts` (`SITE_URL`) | Replace with the real origin. It feeds canonical, hreflang, OG URLs, JSON-LD and sitemap. |
| `robots.txt` sitemap URL | `https://komayomi.example.com/sitemap.xml` | Replace the host to match. |
| Social share image | `public/social-card.png` (branded 1200×630 card, generated from `docs/`) | Replace with a designed image if needed; keep the filename or update `SOCIAL_IMAGE` in `config.mts`. |
| Screenshots | `public/assets/screenshots/*.png` | Add the remaining captures listed in each guide page's *Missing screenshots* table and swap the `.shot-missing` blocks for `<img>` tags. |

After changing `SITE_URL`, rebuild and confirm `sitemap.xml`, canonical tags and OG URLs all use the new domain.

## Screenshots

Real captures live in `public/assets/screenshots/` and are referenced as `/assets/screenshots/<name>.png`. Use English hyphenated names and keep a consistent viewport (for example 1440×900) so figures line up across languages. Pages that still need a capture contain a `.shot-missing` block and list it under *Missing screenshots*; replace that block with a `<figure class="shot"><img …></figure>` using the same path in all three languages.

## Status labels

The product is under active development. Features that are not in the code are marked:

```md
<Badge type="warning" text="Planned" />
```

Before adding or changing a feature description, verify it in the source (`src/`, `server/`, `shared/`, `scripts/`). Do not describe planned behavior as shipped.

## Deployment

`npm run docs:build` produces a static site in `.vitepress/dist/`. Serve it at the domain root, or set `base` in `config.mts` if it will live under a subpath. No server-side runtime is required.

## Reference template

The styling adapts a private VitePress starter template: its typography scale, brand-accent hero, card hover motion, wrapping tables, blurred navigation bar and print rules were adapted here on top of the standard VitePress default theme, keeping the KomaYomi orange palette and the three-locale content. The template was reviewed in a temporary `docs/.template-tmp/` directory (gitignored) and deleted afterwards; no copy remains in this repository.
