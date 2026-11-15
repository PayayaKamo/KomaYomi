import { describe, expect, it } from 'vitest';
import { resolveCompareLayout } from '../../src/hooks/useCompareLayout';

describe('resolveCompareLayout', () => {
  it('keeps the desktop layout for a narrow non-touch window', () => {
    expect(resolveCompareLayout(800, 900, false).mode).toBe('desktop');
    expect(resolveCompareLayout(390, 844, false).mode).toBe('desktop');
  });

  it('uses one column with language tabs on phone portrait', () => {
    expect(resolveCompareLayout(390, 844, true)).toEqual({ mode: 'phone', columns: 1, tabs: true });
    expect(resolveCompareLayout(430, 932, true).columns).toBe(1);
  });

  it('uses two columns with tabs on tablet portrait', () => {
    expect(resolveCompareLayout(820, 1180, true)).toMatchObject({
      mode: 'tablet-portrait',
      columns: 2,
      tabs: true,
    });
    expect(resolveCompareLayout(834, 1194, true).columns).toBe(2);
  });

  it('uses three columns on tablet landscape', () => {
    expect(resolveCompareLayout(1180, 820, true)).toMatchObject({ mode: 'tablet-landscape', columns: 3, tabs: true });
    expect(resolveCompareLayout(1024, 768, true).columns).toBe(3);
  });

  it('treats phone landscape as a compact two-column layout', () => {
    expect(resolveCompareLayout(844, 390, true)).toMatchObject({ mode: 'tablet-portrait', columns: 2 });
  });

  it('keeps desktop at 1200px and wider, even with touch', () => {
    expect(resolveCompareLayout(1440, 900, true).mode).toBe('desktop');
    expect(resolveCompareLayout(1200, 900, true).mode).toBe('desktop');
    expect(resolveCompareLayout(1199, 900, true).mode).toBe('tablet-landscape');
  });
});
