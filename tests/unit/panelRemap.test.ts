import { describe, expect, it } from 'vitest';
import {
  annotationIntoPieces,
  annotationToPage,
  annotationToPanel,
  matchPanelsByRect,
  panelOverlap,
  remapPanelRefs,
} from '../../shared/panelRemap.ts';
import { createEmptyDoc } from '../../server/storage.ts';
import type { PageDoc, Panel } from '../../shared/types.ts';

const panel = (id: string, x: number, y: number, w = 0.4, h = 0.4): Panel => ({
  id,
  rect: { x, y, w, h },
  source: 'manual',
});

describe('panel overlap', () => {
  it('scores identical, partial and disjoint rectangles', () => {
    const a = { x: 0, y: 0, w: 0.5, h: 0.5 };
    expect(panelOverlap(a, a)).toBe(1);
    expect(panelOverlap(a, { x: 0.25, y: 0, w: 0.5, h: 0.5 })).toBeCloseTo(0.25 / 0.75);
    expect(panelOverlap(a, { x: 0.6, y: 0, w: 0.2, h: 0.2 })).toBe(0);
  });
});

describe('matchPanelsByRect', () => {
  it('pairs each old panel with the new panel covering the same artwork', () => {
    const oldPanels = [panel('a', 0.05, 0.05), panel('b', 0.5, 0.05)];
    const newPanels = [panel('p1', 0.52, 0.06), panel('p2', 0.04, 0.04)];

    const map = matchPanelsByRect(oldPanels, newPanels);
    expect(map.get('a')).toBe('p2');
    expect(map.get('b')).toBe('p1');
  });

  it('leaves panels without overlap unmatched when the counts differ', () => {
    const oldPanels = [panel('a', 0.05, 0.05), panel('gone', 0.05, 0.6)];
    const newPanels = [panel('p1', 0.05, 0.05)];

    const map = matchPanelsByRect(oldPanels, newPanels);
    expect(map.get('a')).toBe('p1');
    expect(map.has('gone')).toBe(false);
  });
});

describe('remapPanelRefs', () => {
  const doc = (): PageDoc => ({
    ...createEmptyDoc('Vol1', '172', 0),
    panels: [panel('a', 0.05, 0.05), panel('b', 0.5, 0.05)],
    notes: [
      {
        id: 'n-page',
        scope: 'page',
        panelId: null,
        text: 'page note',
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'n-a',
        scope: 'panel',
        panelId: 'a',
        text: 'inside left panel',
        tags: [],
        anchor: { x: 0.2, y: 0.2, lang: 'ja' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'n-gone',
        scope: 'panel',
        panelId: 'b',
        text: 'panel removed by the new layout',
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    annotations: [
      {
        id: 'a-arrow',
        kind: 'arrow',
        scope: 'panel',
        panelId: 'b',
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.8, y: 0.6 },
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    groups: [{ id: 'g1', name: 'spread', panelIds: ['a', 'b'] }],
    panelOffsets: { a: { ja: { x: 0.1, y: 0, scale: 1 } }, b: { zh: { x: 0, y: 0, scale: 1 } } },
  });

  it('moves matched notes with their panel and keeps the rest as page notes', () => {
    const result = remapPanelRefs(doc(), [panel('p1', 0.05, 0.05)]);

    const notes = new Map(result.notes.map((note) => [note.id, note]));
    expect(notes.get('n-page')!.scope).toBe('page');
    expect(notes.get('n-a')!.panelId).toBe('p1');
    expect(notes.get('n-gone')!.scope).toBe('page');
    expect(notes.get('n-gone')!.panelId).toBeNull();
    expect(notes.get('n-gone')!.text).toBe('panel removed by the new layout');
    expect(result.movedNotes).toBe(1);
  });

  it('converts marks on a removed panel to page coordinates', () => {
    const result = remapPanelRefs(doc(), [panel('p1', 0.05, 0.05)]);

    const mark = result.annotations[0];
    expect(mark.scope).toBe('page');
    expect(mark.panelId).toBeNull();
    // Panel b starts at (0.5, 0.05) and is 0.4 wide/high: (0.1, 0.1) → (0.54, 0.09).
    expect(mark.points[0]).toEqual({ x: 0.54, y: 0.09 });
    expect(mark.points[1]).toEqual({ x: 0.82, y: 0.29 });
    expect(result.movedAnnotations).toBe(1);
  });

  it('converts a moved mark without changing where it sits on the page', () => {
    const mark = {
      id: 'a1',
      kind: 'arrow' as const,
      scope: 'panel' as const,
      panelId: 'a',
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.9, y: 0.8 },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const from = { x: 0.1, y: 0.2, w: 0.4, h: 0.4 };
    const to = { x: 0.1, y: 0.2, w: 0.6, h: 0.6 };

    const moved = annotationToPanel(mark, from, to);
    expect(moved.points[0]).toEqual({ x: 0.0667, y: 0.1333 });
    expect(moved.points[1]).toEqual({ x: 0.6, y: 0.5333 });

    const pageMark = annotationToPage(mark, from);
    expect(pageMark.scope).toBe('page');
    expect(pageMark.points[0]).toEqual({ x: 0.14, y: 0.28 });
  });

  it('keeps a mark with the split piece that contains it', () => {
    const mark = {
      id: 'a2',
      kind: 'text' as const,
      scope: 'panel' as const,
      panelId: 'base',
      points: [{ x: 0.8, y: 0.5 }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const from = { x: 0, y: 0, w: 1, h: 1 };
    const pieces = [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 1 },
    ];

    expect(annotationIntoPieces(mark, from, pieces).points[0]).toEqual({ x: 0.6, y: 0.5 });
  });

  it('remaps groups and per-panel offsets, dropping entries with no successor', () => {
    const result = remapPanelRefs(doc(), [panel('p1', 0.05, 0.05)]);

    expect(result.groups).toEqual([{ id: 'g1', name: 'spread', panelIds: ['p1'] }]);
    expect(result.panelOffsets).toEqual({ p1: { ja: { x: 0.1, y: 0, scale: 1 } } });
  });
});
