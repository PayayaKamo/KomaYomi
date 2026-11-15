import { describe, expect, it } from 'vitest';
import { buildHash, parseDeepLink } from '../../src/lib/deepLink';

describe('parseDeepLink', () => {
  it('reads a plain page link', () => {
    expect(parseDeepLink('#/Demo%20Vol/1/3')).toEqual({
      volume: 'Demo Vol',
      chapter: '1',
      pageIndex: 2,
      view: null,
      panelId: null,
    });
  });

  it('reads the compare view without a detail panel', () => {
    expect(parseDeepLink('#/Demo%20Vol/1/3/compare')).toMatchObject({
      view: 'compare',
      panelId: null,
    });
  });

  it('reads the panel detail segment', () => {
    expect(parseDeepLink('#/Demo%20Vol/1/3/compare/panel/p2')).toMatchObject({
      volume: 'Demo Vol',
      chapter: '1',
      pageIndex: 2,
      view: 'compare',
      panelId: 'p2',
    });
  });

  it('ignores detail segments outside the compare view and empty hashes', () => {
    expect(parseDeepLink('#/V/C/1/panels/panel/p2')?.panelId).toBeNull();
    expect(parseDeepLink('#/V/C/1/compare/panel/')?.panelId).toBeNull();
    expect(parseDeepLink('')).toBeNull();
    expect(parseDeepLink('#/')).toBeNull();
  });
});

describe('buildHash', () => {
  it('round-trips a panel detail link', () => {
    const hash = buildHash('Demo Vol', '1', 2, 'compare', 'p2');
    expect(hash).toBe('#/Demo%20Vol/1/3/compare/panel/p2');
    expect(parseDeepLink(hash)).toMatchObject({ pageIndex: 2, view: 'compare', panelId: 'p2' });
  });

  it('omits the panel segment without a detail target', () => {
    expect(buildHash('V', 'C', 0, 'panels')).toBe('#/V/C/1/panels');
  });
});
