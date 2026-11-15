import { describe, expect, it } from 'vitest';
import { KEEPALIVE_MAX_BYTES, keepaliveFits } from '../../src/lib/keepalive.ts';

describe('keepaliveFits', () => {
  it('accepts a body exactly at the cap', () => {
    expect(keepaliveFits('a'.repeat(KEEPALIVE_MAX_BYTES))).toBe(true);
  });

  it('rejects a body one byte over the cap', () => {
    expect(keepaliveFits('a'.repeat(KEEPALIVE_MAX_BYTES + 1))).toBe(false);
  });

  it('counts UTF-8 bytes, not characters', () => {
    // 61441 CJK characters are ~184 KB even though the string length looks small.
    expect(keepaliveFits('中'.repeat(KEEPALIVE_MAX_BYTES / 3 + 1))).toBe(false);
  });
});
