# Notes

Notes are the reason the panels and alignment exist. A note can belong to a whole page or to one panel, and it is written in Markdown.

<figure class="shot">
  <img src="/shots/notes.svg" alt="Notes panel with Markdown editor, tags and overview (placeholder)">
  <figcaption>Placeholder image. The notes panel sits beside the page and can be collapsed.</figcaption>
</figure>

## Scope

| Scope | When to use | Stored as |
| --- | --- | --- |
| **Page** | Overall observations, proofreading remarks, questions about a page. | `scope: "page"`, `panelId: null` |
| **Panel** | Wording, tone, translation differences, a specific balloon. | `scope: "panel"`, `panelId: "<panel id>"` |

Selecting a panel in either the workbench or the compare reader scopes the next note to that panel. With nothing selected, the note is page-scoped.

## Markdown

The editor supports headings, bold/italic/strikethrough, inline code, fenced code, links, ordered and unordered lists (one nesting level), block quotes, tables, horizontal rules and hard line breaks.

- Toggle **Preview** to render the Markdown exactly as it will appear in the HTML export.
- `Ctrl+Enter` saves the note.
- Raw HTML in notes is escaped and never executed.
- Notes written before Markdown support are preserved and render as plain text with line breaks.

## Tags

- Type a tag and press `Enter` to add it.
- Tags are stored as an array on the note.
- Tag usage is aggregated across all pages and shown as suggestions/filters.

## Sources

Each note can carry a source:

- **URL** — paste a link. The app detects the first URL in the text automatically; a button can fetch the page title (5-second timeout). If fetching is blocked, type the title manually.
- **Free text** — e.g. `ChatGPT conversation 2026-05-12`, a book title, or an interview name.

The source is displayed as a badge (domain) in the note list and is included in search and "copy context".

## Scratch pad

The scratch pad is for thoughts you have before deciding which page they belong to.

- Type freely; entries are kept in the browser's local storage.
- Move an entry into a page or panel note when you know where it belongs.
- It is per-browser, not part of the project package.

## Overview and search

The **Overview / Search** tab aggregates notes across the library:

- Full-text search over note text, tags and sources (300 ms debounce).
- Filter by volume, chapter, tag and source.
- Aggregate by tag or by source.
- Results show how many notes and pages matched.
- Clicking a result jumps to that page and, when applicable, selects the panel.

## Copy context

**Copy context** produces a compact, paste-ready block containing the volume, chapter, page, panel number, note text, tags and source. The format is controlled by a template with these placeholders:

```text
{volume} {chapter} {page} {panel} {notes} {text} {tags}
```

The template is editable and remembered per browser. It is convenient for pasting a self-contained question into an LLM.

## Storage

Notes live inside the page JSON at `data/pages/<volume>/<chapter>/<index>.json`:

```json
{
  "id": "n1712345678901",
  "scope": "panel",
  "panelId": "p3",
  "text": "**原文**：……\n\n翻译语气偏正式。",
  "tags": ["语气", "待确认"],
  "source": { "title": "…", "url": "https://…" },
  "createdAt": "2026-05-12T10:00:00.000Z",
  "updatedAt": "2026-05-12T10:05:00.000Z"
}
```

This means notes are backed up and exported with the page, and can be edited with any text editor.

::: warning Planned
The note model has an `images` field for screenshots stored as data URLs, and the project importer counts note images. The in-app editor for adding images to a note is <Badge type="warning" text="Planned" />.
:::
