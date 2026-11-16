import { describe, expect, it } from 'vitest';
import {
  anchorInRect,
  clampAnchorPoint,
  groupAnchoredNotes,
  noteAnchorMatchesLang,
  pagePointToPane,
  panePointToPage,
} from '../../shared/noteAnchors.ts';
import { CURRENT_SCHEMA_VERSION, prepareExchange } from '../../shared/format.ts';
import { migratePageV3 } from '../../shared/migrations.ts';
import type { Note, Panel } from '../../shared/types.ts';

const panel: Panel = { id: 'p1', rect: { x: 0.1, y: 0.2, w: 0.4, h: 0.3 } };

function note(patch: Partial<Note> & Pick<Note, 'id'>): Note {
  return {
    id: patch.id,
    scope: 'panel',
    panelId: 'p1',
    text: patch.text ?? 'note',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

describe('note anchors', () => {
  it('follows the annotation lane rule', () => {
    expect(noteAnchorMatchesLang({ x: 0.5, y: 0.5, lang: 'ja' }, 'ja')).toBe(true);
    expect(noteAnchorMatchesLang({ x: 0.5, y: 0.5, lang: 'ja' }, 'zh')).toBe(false);
    expect(noteAnchorMatchesLang({ x: 0.5, y: 0.5, lang: '' }, 'zh')).toBe(true);
    expect(noteAnchorMatchesLang({ x: 0.5, y: 0.5, lang: 'ja' }, null)).toBe(true);
  });

  it('keeps pins inside the page and the clicked panel', () => {
    expect(clampAnchorPoint({ x: -0.2, y: 1.4 })).toEqual({ x: 0, y: 1 });
    expect(clampAnchorPoint({ x: 0.05, y: 0.9 }, panel.rect)).toEqual({ x: 0.1, y: 0.5 });
    expect(anchorInRect({ x: 0.1, y: 0.5 }, panel.rect)).toBe(true);
    expect(anchorInRect({ x: 0.6, y: 0.5 }, panel.rect)).toBe(false);
  });

  it('groups notes at the same spot and filters by lane and panel', () => {
    const notes = [
      note({ id: 'a', anchor: { x: 0.2, y: 0.3, lang: 'ja' }, text: 'first' }),
      note({ id: 'b', anchor: { x: 0.2, y: 0.3, lang: 'ja' }, text: 'second' }),
      note({ id: 'c', anchor: { x: 0.3, y: 0.35, lang: 'zh' } }),
      note({ id: 'd', anchor: { x: 0.2, y: 0.3, lang: 'ja' }, panelId: 'p2' }),
      note({ id: 'e', text: 'no anchor' }),
    ];

    const ja = groupAnchoredNotes(notes, panel, 'ja');
    expect(ja).toHaveLength(1);
    expect(ja[0].notes.map((n) => n.id)).toEqual(['a', 'b']);

    const zh = groupAnchoredNotes(notes, panel, 'zh');
    expect(zh).toHaveLength(1);
    expect(zh[0].notes[0].id).toBe('c');
  });

  it('shows page notes only in the panel that contains the pin', () => {
    const notes = [note({ id: 'page-note', scope: 'page', panelId: null, anchor: { x: 0.2, y: 0.3, lang: 'ja' } })];
    expect(groupAnchoredNotes(notes, panel, 'ja')).toHaveLength(1);
    expect(groupAnchoredNotes(notes, { id: 'p2', rect: { x: 0.6, y: 0.7, w: 0.3, h: 0.2 } }, 'ja')).toHaveLength(0);
  });

  it('pulls an out-of-cell panel pin back to the panel edge instead of dropping it', () => {
    const notes = [note({ id: 'outsider', anchor: { x: 0.8, y: 0.9, lang: 'ja' } })];
    const groups = groupAnchoredNotes(notes, panel, 'ja');
    expect(groups).toHaveLength(1);
    expect(groups[0].x).toBeCloseTo(0.5, 6);
    expect(groups[0].y).toBeCloseTo(0.5, 6);
  });

  it('maps page points through alignment offsets and zoom, and back', () => {
    const point = { x: 0.2, y: 0.3 };
    const offset = { x: 0.05, y: -0.02, scale: 1.2 };
    const pane = pagePointToPane(point, panel.rect, offset);
    // Panel-local fraction is (0.25, 0.333…); the offset then shifts it and the scale grows it around the centre.
    expect(pane.u).toBeCloseTo(0.5 + (0.25 - 0.5) * 1.2 + 0.05, 6);
    expect(pane.v).toBeCloseTo(0.5 + (1 / 3 - 0.5) * 1.2 - 0.02, 6);

    const zoomed = pagePointToPane(point, panel.rect, offset, 1.5);
    expect(zoomed.u).toBeCloseTo(0.5 + (pane.u - 0.5) * 1.5, 6);

    const back = panePointToPage(zoomed.u, zoomed.v, panel.rect, offset, 1.5);
    expect(back.x).toBeCloseTo(point.x, 6);
    expect(back.y).toBeCloseTo(point.y, 6);
  });

  it('migrates a v3 page without touching its notes', () => {
    const notes = [note({ id: 'old', text: 'legacy' })];
    const migrated = migratePageV3({ schemaVersion: 3, notes });
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.notes).toEqual(notes);

    const prepared = prepareExchange('page', {
      schemaVersion: 3,
      volume: 'Vol1',
      chapter: '172',
      pageIndex: 0,
      panels: [],
      notes,
      offsets: {},
      alignMode: 'page',
      panelOffsets: {},
      readingDirection: 'rtl',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(prepared.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION.page);
    expect(prepared.migratedFrom).toBe(3);
  });

  it('accepts an anchored note and rejects a malformed anchor', () => {
    const base = {
      schemaVersion: CURRENT_SCHEMA_VERSION.page,
      volume: 'Vol1',
      chapter: '172',
      pageIndex: 0,
      panels: [],
      offsets: {},
      alignMode: 'page',
      panelOffsets: {},
      readingDirection: 'rtl',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const anchored = note({ id: 'n1', anchor: { x: 0.4, y: 0.5, lang: 'ja' } });
    expect(() => prepareExchange('page', { ...base, notes: [anchored] })).not.toThrow();
    const broken = { ...anchored, anchor: { x: 'left', y: 0.5, lang: 'ja' } };
    expect(() => prepareExchange('page', { ...base, notes: [broken] })).toThrow();
  });
});
