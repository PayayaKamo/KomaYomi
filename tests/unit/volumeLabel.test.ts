import { describe, expect, it } from 'vitest';
import { volumeLabel } from '../../src/lib/volumeLabel.ts';

describe('volume label', () => {
  it('prefixes the series name when the volume belongs to one', () => {
    expect(volumeLabel({ series: 'Yotsuba&!', title: 'Volume 3' })).toBe('Yotsuba&! · Volume 3');
  });

  it('falls back to the plain title for standalone imports', () => {
    expect(volumeLabel({ title: 'Volume 3' })).toBe('Volume 3');
    expect(volumeLabel({ series: '', title: 'Volume 3' })).toBe('Volume 3');
  });
});
