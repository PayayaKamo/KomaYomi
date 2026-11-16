import { describe, expect, it } from 'vitest';
import { escapeHtml, markdownExcerpt, renderMarkdown } from '../../shared/markdown.ts';

describe('escapeHtml', () => {
  it('escapes ampersands, angle brackets and double quotes', () => {
    expect(escapeHtml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  it('leaves single quotes and plain text alone', () => {
    expect(escapeHtml("it's fine")).toBe("it's fine");
  });
});

describe('renderMarkdown inline', () => {
  it('renders inline code and keeps its content escaped', () => {
    expect(renderMarkdown('`a < b`')).toBe('<p><code>a &lt; b</code></p>');
  });

  it('protects several inline codes and their markdown characters', () => {
    expect(renderMarkdown('`**not bold**` and `b`')).toBe('<p><code>**not bold**</code> and <code>b</code></p>');
  });

  it('renders http and https images but degrades unsafe sources to alt text', () => {
    expect(renderMarkdown('![alt](http://example.com/a.png)')).toBe(
      '<p><img src="http://example.com/a.png" alt="alt" loading="lazy" /></p>',
    );
    expect(renderMarkdown('![alt](HTTPS://example.com/a.png)')).toBe(
      '<p><img src="HTTPS://example.com/a.png" alt="alt" loading="lazy" /></p>',
    );
    expect(renderMarkdown('![alt](ftp://example.com/a.png)')).toBe('<p>alt</p>');
    expect(renderMarkdown('![alt](data:image/png;base64,AAA)')).toBe('<p>alt</p>');
    expect(renderMarkdown('![alt](/relative/a.png)')).toBe('<p>alt</p>');
  });

  it('keeps http, mailto, hash and root-relative links', () => {
    const link = (href: string) => `<p><a href="${href}" target="_blank" rel="noreferrer noopener">t</a></p>`;
    expect(renderMarkdown('[t](https://e.com)')).toBe(link('https://e.com'));
    expect(renderMarkdown('[t](http://e.com)')).toBe(link('http://e.com'));
    expect(renderMarkdown('[t](mailto:a@b.c)')).toBe(link('mailto:a@b.c'));
    expect(renderMarkdown('[t](#top)')).toBe(link('#top'));
    expect(renderMarkdown('[t](/docs)')).toBe(link('/docs'));
  });

  it('replaces unsafe link schemes with a hash', () => {
    const link = '<p><a href="#" target="_blank" rel="noreferrer noopener">t</a></p>';
    expect(renderMarkdown('[t](javascript:alert)')).toBe(link);
    expect(renderMarkdown('[t](ftp://e.com)')).toBe(link);
  });

  it('only lets bare <u> through and escapes other tags', () => {
    expect(renderMarkdown('<u>u</u>')).toBe('<p><u>u</u></p>');
    expect(renderMarkdown('<U>u</U>')).toBe('<p>&lt;U&gt;u&lt;/U&gt;</p>');
    expect(renderMarkdown('<b>u</b>')).toBe('<p>&lt;b&gt;u&lt;/b&gt;</p>');
  });

  it('renders strong, em and del', () => {
    expect(renderMarkdown('**bold**')).toBe('<p><strong>bold</strong></p>');
    expect(renderMarkdown('__bold__')).toBe('<p><strong>bold</strong></p>');
    expect(renderMarkdown('*em*')).toBe('<p><em>em</em></p>');
    expect(renderMarkdown('_em_')).toBe('<p><em>em</em></p>');
    expect(renderMarkdown('~~gone~~')).toBe('<p><del>gone</del></p>');
    expect(renderMarkdown('a **b** *c* ~~d~~')).toBe('<p>a <strong>b</strong> <em>c</em> <del>d</del></p>');
  });

  it('does not treat snake_case underscores as emphasis', () => {
    expect(renderMarkdown('foo_bar_baz')).toBe('<p>foo_bar_baz</p>');
  });
});

describe('renderMarkdown lists', () => {
  it('renders unordered lists for -, * and + markers', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(renderMarkdown('* a\n* b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(renderMarkdown('+ a\n+ b')).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('renders ordered lists for . and ) markers', () => {
    expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
    expect(renderMarkdown('1) a\n2) b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('nests indented list items under the previous item', () => {
    expect(renderMarkdown('- a\n  - b\n  - c')).toBe('<ul><li>a<ul><li>b</li><li>c</li></ul></li></ul>');
  });

  it('appends same-indent continuation lines to the current item', () => {
    expect(renderMarkdown('- first\ncontinued')).toBe('<ul><li>first<br />continued</li></ul>');
  });

  it('turns a deeper continuation line into a nested block', () => {
    expect(renderMarkdown('- first\n  continued')).toBe('<ul><li>first<p>continued</p></li></ul>');
  });

  it('ends a list at the next block', () => {
    expect(renderMarkdown('- a\n# h')).toBe('<ul><li>a</li></ul>\n<h1>h</h1>');
  });

  it('splits lists on a blank line', () => {
    expect(renderMarkdown('- a\n\n- b')).toBe('<ul><li>a</li></ul>\n<ul><li>b</li></ul>');
  });
});

describe('renderMarkdown tables', () => {
  it('defaults to left alignment without colons', () => {
    expect(renderMarkdown('a | b\n--- | ---\n1 | 2')).toBe(
      '<table><thead><tr><th style="text-align:left">a</th><th style="text-align:left">b</th></tr></thead>' +
        '<tbody><tr><td style="text-align:left">1</td><td style="text-align:left">2</td></tr></tbody></table>',
    );
  });

  it('renders a header-only table with an empty body', () => {
    expect(renderMarkdown('| a | b |\n| --- | --- |')).toBe(
      '<table><thead><tr><th style="text-align:left">a</th><th style="text-align:left">b</th></tr></thead>' +
        '<tbody></tbody></table>',
    );
  });

  it('supports centre and right aligned columns', () => {
    const html = renderMarkdown('| a | b |\n| :-: | -: |\n| 1 | 2 |');
    expect(html).toContain('<th style="text-align:center">a</th>');
    expect(html).toContain('<th style="text-align:right">b</th>');
    expect(html).toContain('<td style="text-align:center">1</td>');
    expect(html).toContain('<td style="text-align:right">2</td>');
  });

  it('keeps pipes as a paragraph when the next line is not a delimiter row', () => {
    expect(renderMarkdown('a | b\nx | y')).toBe('<p>a | b<br />x | y</p>');
  });
});

describe('renderMarkdown fenced code', () => {
  it('renders a language-tagged fence and escapes its content', () => {
    expect(renderMarkdown('```js\nconst a = 1 < 2;\n```')).toBe(
      '<pre class="md-code" data-lang="js"><code>const a = 1 &lt; 2;</code></pre>',
    );
  });

  it('renders a fence without a language', () => {
    expect(renderMarkdown('```\nplain\n```')).toBe('<pre class="md-code"><code>plain</code></pre>');
  });

  it('renders an unclosed fence up to the end of input', () => {
    expect(renderMarkdown('```\nno close')).toBe('<pre class="md-code"><code>no close</code></pre>');
  });

  it('keeps blank lines inside the code block', () => {
    expect(renderMarkdown('```\na\n\nb\n```')).toBe('<pre class="md-code"><code>a\n\nb</code></pre>');
  });
});

describe('renderMarkdown blocks', () => {
  it('renders h1 through h6', () => {
    expect(renderMarkdown('# h1\n## h2\n### h3\n#### h4\n##### h5\n###### h6')).toBe(
      '<h1>h1</h1>\n<h2>h2</h2>\n<h3>h3</h3>\n<h4>h4</h4>\n<h5>h5</h5>\n<h6>h6</h6>',
    );
  });

  it('requires whitespace after heading hashes', () => {
    expect(renderMarkdown('#tag')).toBe('<p>#tag</p>');
    expect(renderMarkdown('####### h7')).toBe('<p>####### h7</p>');
  });

  it('renders inline formatting inside headings', () => {
    expect(renderMarkdown('## **bold**')).toBe('<h2><strong>bold</strong></h2>');
  });

  it('renders horizontal rules in all three spellings', () => {
    expect(renderMarkdown('---\n***\n___')).toBe('<hr />\n<hr />\n<hr />');
  });

  it('renders multi-line block quotes', () => {
    expect(renderMarkdown('> line1\n> line2')).toBe('<blockquote><p>line1<br />line2</p></blockquote>');
  });

  it('renders nested blocks and block quotes', () => {
    expect(renderMarkdown('> quote\n> - item')).toBe('<blockquote><p>quote</p>\n<ul><li>item</li></ul></blockquote>');
    expect(renderMarkdown('> > inner')).toBe('<blockquote><blockquote><p>inner</p></blockquote></blockquote>');
  });

  it('renders left, centre and right aligned divs', () => {
    expect(renderMarkdown('<div align="left">l</div>')).toBe('<div style="text-align:left">l</div>');
    expect(renderMarkdown('<div align="center">c</div>')).toBe('<div style="text-align:center">c</div>');
    expect(renderMarkdown('<div align="right">r</div>')).toBe('<div style="text-align:right">r</div>');
  });

  it('escapes an unsupported alignment instead of emitting a div', () => {
    expect(renderMarkdown('<div align="justify">j</div>')).toBe(
      '<p>&lt;div align=&quot;justify&quot;&gt;j&lt;/div&gt;</p>',
    );
  });

  it('turns newlines inside a paragraph into hard breaks', () => {
    expect(renderMarkdown('one\ntwo')).toBe('<p>one<br />two</p>');
  });

  it('returns empty output for empty or whitespace input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('   \n\t ')).toBe('');
  });

  it('normalizes CRLF and lone CR', () => {
    expect(renderMarkdown('a\r\nb\r\n\r\nc')).toBe('<p>a<br />b</p>\n<p>c</p>');
    expect(renderMarkdown('a\rb')).toBe('<p>a<br />b</p>');
  });
});

describe('markdownExcerpt', () => {
  it('strips fenced code, inline code, links and editor tags', () => {
    expect(markdownExcerpt('before\n```js\nconst x = 1;\n```\nafter')).toBe('before after');
    expect(markdownExcerpt('use `npm test` now')).toBe('use npm test now');
    expect(markdownExcerpt('see [the docs](https://example.com)')).toBe('see the docs');
    expect(markdownExcerpt('![shot](https://example.com/a.png) done')).toBe('shot done');
    expect(markdownExcerpt('<div align="center">mid</div> <u>u</u>')).toBe('mid u');
  });

  it('removes markdown markers and collapses whitespace', () => {
    expect(markdownExcerpt('## Title\n\n- one\n- two')).toBe('Title one two');
    expect(markdownExcerpt('**bold**   _em_ ~~gone~~')).toBe('bold em gone');
  });

  it('truncates long text at max and appends an ellipsis', () => {
    expect(markdownExcerpt('a'.repeat(100), 10)).toBe('aaaaaaaaaa…');
    expect(markdownExcerpt('short', 10)).toBe('short');
    expect(markdownExcerpt('x'.repeat(80))).toHaveLength(80);
    expect(markdownExcerpt('x'.repeat(81))).toHaveLength(81);
    expect(markdownExcerpt('x'.repeat(81)).endsWith('…')).toBe(true);
  });

  it('returns an empty string for empty or code-only input', () => {
    expect(markdownExcerpt('')).toBe('');
    expect(markdownExcerpt('```js\nconst x = 1;\n```')).toBe('');
  });
});
