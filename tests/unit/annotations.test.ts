import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { annotationAnchorPoint, annotationBBox, annotationLeader } from '../../shared/annotations.ts';
import type { Annotation, PageDoc } from '../../shared/types.ts';
import { createEmptyDoc, readPageDoc, writePageDoc } from '../../server/storage.ts';
import { makeTempDir, removeDir } from '../helpers/tmp.ts';

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = makeTempDir(prefix);
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

const PAGE = { x: 0, y: 0, w: 1, h: 1 };
const PANEL = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };

function annotation(over: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    kind: 'rect',
    scope: 'page',
    panelId: null,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.3 },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function docWith(annotations: Annotation[]): PageDoc {
  return { ...createEmptyDoc('Vol1', '172', 0), annotations };
}

describe('annotation geometry', () => {
  it('measures the mark in page coordinates', () => {
    expect(annotationBBox(annotation(), PAGE)).toEqual({
      x: 0.1,
      y: 0.1,
      w: expect.closeTo(0.2),
      h: expect.closeTo(0.2),
    });
    expect(annotationBBox(annotation({ scope: 'panel', panelId: 'p1' }), PANEL)).toEqual({
      x: expect.closeTo(0.24),
      y: expect.closeTo(0.24),
      w: expect.closeTo(0.08),
      h: expect.closeTo(0.08),
    });
  });

  it('uses the centre of a locator box', () => {
    const a = annotation({ anchor: { x: 0.5, y: 0.6, w: 0.2, h: 0.1 } });
    expect(annotationAnchorPoint(a)).toEqual({ x: 0.6, y: 0.65 });
    expect(annotationAnchorPoint(annotation())).toBeNull();
  });

  it('draws no leader for a mark without an anchor', () => {
    expect(annotationLeader(annotation(), PAGE)).toBeNull();
  });

  it('points the leader at the anchor', () => {
    const leader = annotationLeader(annotation({ anchor: { x: 0.7, y: 0.8 } }), PAGE);
    expect(leader?.to).toEqual({ x: 0.7, y: 0.8 });
  });

  it('falls back to the owning panel centre for a callout without an anchor', () => {
    const leader = annotationLeader(annotation({ kind: 'text', scope: 'panel', panelId: 'p1' }), PANEL);
    expect(leader?.to).toEqual({ x: 0.4, y: 0.4 });
  });

  it('honours the per-item leader switch', () => {
    expect(annotationLeader(annotation({ anchor: { x: 0.7, y: 0.8 }, showLeader: false }), PAGE)).toBeNull();
  });
});

describe('annotation anchors in page storage', () => {
  it('reads old annotations without anchor fields as "no anchor"', () => {
    const root = tempDir('ann-old');
    const file = path.join(root, 'pages', 'Vol1', '172', '0.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(docWith([annotation()])));

    const read = readPageDoc(root, 'Vol1', '172', 0);
    expect(read?.annotations?.[0].anchor).toBeUndefined();
    expect(read?.annotations?.[0].showLeader).toBeUndefined();
  });

  it('round-trips anchors and leaders', () => {
    const root = tempDir('ann-roundtrip');
    writePageDoc(root, docWith([annotation({ anchor: { x: 0.4, y: 0.5, w: 0.1, h: 0.2 }, showLeader: false })]));

    const read = readPageDoc(root, 'Vol1', '172', 0);
    expect(read?.annotations?.[0].anchor).toEqual({ x: 0.4, y: 0.5, w: 0.1, h: 0.2 });
    expect(read?.annotations?.[0].showLeader).toBe(false);
  });

  it('does not resurrect a cleared anchor or leader flag', () => {
    const root = tempDir('ann-clear');
    writePageDoc(root, docWith([annotation({ anchor: { x: 0.4, y: 0.5 }, showLeader: false })]));
    writePageDoc(root, docWith([annotation()]));

    const read = readPageDoc(root, 'Vol1', '172', 0);
    expect(read?.annotations?.[0].anchor).toBeUndefined();
    expect(read?.annotations?.[0].showLeader).toBeUndefined();
  });
});
