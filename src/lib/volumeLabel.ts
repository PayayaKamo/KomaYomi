import type { VolumeEntry } from '../../shared/types';

/** Sidebar/navigation label: "series · volume" for series imports, the plain title otherwise. */
export function volumeLabel(volume: Pick<VolumeEntry, 'series' | 'title'>): string {
  return volume.series ? `${volume.series} · ${volume.title}` : volume.title;
}
