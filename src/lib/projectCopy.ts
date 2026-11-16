import { api } from '../api';

export type SaveCopyResult =
  | { kind: 'canceled' }
  /** Desktop: written straight to the path the user picked. */
  | { kind: 'saved'; path: string; size: number }
  /** Browser: packed into the export folder, then handed to the download manager. */
  | { kind: 'downloaded'; file: string; size: number }
  | { kind: 'error'; message: string };

/**
 * Save the whole library as a standalone .mnproj.
 *
 * Desktop uses the native save dialog so the user picks the exact path; a plain browser
 * cannot prompt for one, so the copy is packed and downloaded (the download can be renamed).
 * Either way the linked project file is never touched.
 */
export async function saveProjectCopy(opts: {
  /** Native dialog title (desktop only). */
  title: string;
  /** Default file name, without extension. */
  suggestedName: string;
}): Promise<SaveCopyResult> {
  const desktop = typeof window !== 'undefined' ? window.mangaDesktop : undefined;
  const name = opts.suggestedName.trim() || 'komayomi-project';
  try {
    if (desktop) {
      const target = await desktop.saveProjectFile(opts.title, name);
      if (!target) return { kind: 'canceled' };
      const picked = (target.split(/[\\/]/).pop() ?? '').replace(/\.mnproj$/i, '') || undefined;
      const res = await api.saveProjectAs({ path: target, mode: 'packaged', name: picked });
      return { kind: 'saved', path: res.path, size: res.size };
    }
    const res = await api.exportProject({ mode: 'packaged', name });
    const a = document.createElement('a');
    a.href = res.url;
    a.download = res.file;
    a.click();
    return { kind: 'downloaded', file: res.file, size: res.size };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
