/**
 * Library membership checks for request targets.
 *
 * Reading or writing a page (and its history) is only meaningful for a volume and
 * chapter that the current scan actually found. These helpers run at the HTTP boundary
 * so an unknown or `../`-style target is rejected before any file path is built.
 */
import type { ChapterEntry, Library, PageEntry, VolumeEntry } from '../shared/types.ts';
import { AppError } from './errors.ts';

export function requireVolume(library: Library, volume: string): VolumeEntry {
  const found = library.volumes.find((item) => item.id === volume);
  if (!found) throw new AppError('ERR_VOLUME_NOT_FOUND', { volume }, 404);
  return found;
}

export function requireChapter(library: Library, volume: string, chapter: string): ChapterEntry {
  const volumeEntry = requireVolume(library, volume);
  const found = volumeEntry.chapters.find((item) => item.chapter === chapter);
  if (!found) throw new AppError('ERR_CHAPTER_NOT_FOUND', { volume, chapter }, 404);
  return found;
}

export function requirePage(
  library: Library,
  volume: string,
  chapter: string,
  pageIndex: number,
): { page: PageEntry; chapterEntry: ChapterEntry; volumeEntry: VolumeEntry } {
  const chapterEntry = requireChapter(library, volume, chapter);
  const page = chapterEntry.pages.find((item) => item.index === pageIndex);
  if (!page) throw new AppError('ERR_PAGE_NOT_FOUND', { volume, chapter, page: pageIndex + 1 }, 404);
  return { page, chapterEntry, volumeEntry: library.volumes.find((item) => item.id === volume)! };
}
