import { describe, expect, it } from 'vitest';
import { markdownExcerpt, renderMarkdown } from '../../shared/markdown.ts';

describe('renderMarkdown inline html', () => {
  it('renders underline instead of leaking the tag', () => {
    expect(renderMarkdown('a <u>marked</u> word')).toBe('<p>a <u>marked</u> word</p>');
  });

  it('escapes every other tag, so only underline is allowed through', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('turns an aligned block into a styled div', () => {
    expect(renderMarkdown('<div align="center">middle</div>')).toBe('<div style="text-align:center">middle</div>');
    expect(renderMarkdown('<div align="right">**end**</div>')).toBe(
      '<div style="text-align:right"><strong>end</strong></div>',
    );
  });

  it('renders https images and drops unsafe or relative sources', () => {
    expect(renderMarkdown('![shot](https://example.com/a.png)')).toBe(
      '<p><img src="https://example.com/a.png" alt="shot" loading="lazy" /></p>',
    );
    expect(renderMarkdown('![shot](/local/a.png)')).toBe('<p>shot</p>');
  });

  it('keeps table alignment from the delimiter row', () => {
    const html = renderMarkdown('| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |');
    expect(html).toContain('<th style="text-align:left">a</th>');
    expect(html).toContain('<th style="text-align:center">b</th>');
    expect(html).toContain('<th style="text-align:right">c</th>');
    expect(html).toContain('<td style="text-align:center">2</td>');
  });
});

describe('markdownExcerpt', () => {
  it('strips underline and alignment tags from previews', () => {
    expect(markdownExcerpt('<u>kept</u>')).toBe('kept');
    expect(markdownExcerpt('<div align="center">middle</div>')).toBe('middle');
  });
});
