import { beforeEach, describe, expect, it } from 'vitest';
import { composeAnnotatedPage, exportPng } from '../../src/lib/pngExport.ts';
import { setLocale } from '../../src/i18n/index.ts';
import type { Annotation, Lang, PageEntry } from '../../shared/types.ts';

beforeEach(() => {
  // The runtime follows navigator.language, which the node environment reports as zh.
  setLocale('en');
});

function page(files: Partial<Record<Lang, string>> = {}): PageEntry {
  return { index: 0, files, filenames: {}, warnings: [], annotated: false };
}

const annotation: Annotation = {
  id: 'a1',
  kind: 'arrow',
  scope: 'page',
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.4, y: 0.4 },
  ],
  color: '#e0453a',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// These cases stay inside the DOM-free head of the PNG pipeline. Everything below
// `loadImage` needs `Image`/`<canvas>`, which the node test environment does not provide.
describe('png export guards', () => {
  it('composeAnnotatedPage skips pages without the requested language image', async () => {
    await expect(composeAnnotatedPage(page(), 'ja', [annotation], [])).resolves.toBeNull();
    await expect(composeAnnotatedPage(page({ en: '/x.png' }), 'ja', [], [])).resolves.toBeNull();
  });

  it('rejects a single-language export when that language has no image', async () => {
    await expect(
      exportPng({
        page: page(),
        lang: 'ja',
        langs: ['ja'],
        mode: 'page',
        filenameBase: 'vol1-1-P1',
        annotations: [annotation],
      }),
    ).rejects.toThrow('Missing the Japanese image');
  });

  it('rejects a panel export for the same reason before any DOM work', async () => {
    await expect(
      exportPng({
        page: page(),
        lang: 'ja',
        langs: ['ja'],
        mode: 'panel',
        filenameBase: 'vol1-1-P1',
        rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
      }),
    ).rejects.toThrow('Missing the Japanese image');
  });

  it('rejects a collage when no requested language has an image', async () => {
    await expect(
      exportPng({
        page: page(),
        lang: 'ja',
        langs: ['ja', 'en'],
        mode: 'collage',
        filenameBase: 'vol1-1',
        annotations: [annotation],
        includeAnnotations: false,
      }),
    ).rejects.toThrow('No images to export');
  });
});
