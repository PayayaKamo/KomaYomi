import { describe, expect, it } from 'vitest';
import { checkDocs, inspect } from '../../docs/scripts/check-frontmatter.mjs';

const page = (...lines: string[]) => ['---', ...lines, '---', ''].join('\n');

describe('docs front matter', () => {
  it('keeps every page parseable as YAML', () => {
    const problems = checkDocs().map((problem) => `docs/${problem.file}:${problem.line}: ${problem.message}`);
    expect(problems).toEqual([]);
  });

  it('rejects an unquoted colon, which YAML reads as a nested mapping', () => {
    expect(inspect(page('description: a local-first reader: compare pages'))).toEqual([
      { line: 2, message: expect.stringContaining('unquoted value contains ": "') },
    ]);
  });

  it('accepts quoted, block scalar and flow values that contain a colon', () => {
    expect(inspect(page('description: "a reader: compare pages"'))).toEqual([]);
    expect(inspect(page('description: |', '  a reader: compare pages'))).toEqual([]);
    expect(inspect(page('description: [a reader: compare pages]'))).toEqual([]);
  });

  it('rejects a trailing colon and a comment marker inside a plain value', () => {
    expect(inspect(page('title: ends with colon:'))).toHaveLength(1);
    expect(inspect(page('title: reader #1'))).toHaveLength(1);
  });

  it('reports front matter that never closes', () => {
    expect(inspect('---\ntitle: Home\n')).toEqual([{ line: 1, message: expect.stringContaining('never closes') }]);
  });
});
