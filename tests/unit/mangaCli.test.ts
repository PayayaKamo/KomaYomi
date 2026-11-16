import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArgs, runCli } from '../../scripts/manga-cli.ts';
import { readPageDoc } from '../../server/storage.ts';
import { threePanelPage } from '../helpers/fixtures.ts';
import { makeTempDir, removeDir, writeFile } from '../helpers/tmp.ts';

let scratch = '';
let root = '';
let dataRoot = '';

beforeEach(() => {
  scratch = makeTempDir('cli');
  root = path.join(scratch, 'project');
  dataRoot = path.join(root, 'data');
  const page = threePanelPage();
  for (const rel of ['raw/Vol1/ja/201/01.png', 'raw/Vol1/ja/202/01.png', 'raw/Vol2/ja/199/01.png']) {
    writeFile(path.join(root, rel), page);
  }
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  removeDir(scratch);
});

describe('parseArgs', () => {
  it('separates the command from value and boolean flags', () => {
    expect(parseArgs(['detect', '--volume', 'Vol1', '--apply'])).toEqual({
      cmd: 'detect',
      flags: { volume: 'Vol1', apply: true },
    });
  });

  it('defaults to help without a command', () => {
    expect(parseArgs([])).toEqual({ cmd: 'help', flags: {} });
  });

  it('keeps a trailing flag without a value as true', () => {
    expect(parseArgs(['detect', '--volume'])).toEqual({ cmd: 'detect', flags: { volume: true } });
  });

  it('ignores stray positional tokens and keeps comma lists together', () => {
    expect(parseArgs(['detect', 'stray', '--pages', '1,2', '--overwrite'])).toEqual({
      cmd: 'detect',
      flags: { pages: '1,2', overwrite: true },
    });
  });
});

describe('detect targeting', () => {
  it('detects every chapter of one volume and leaves other volumes untouched', async () => {
    expect(await runCli(['detect', '--volume', 'Vol1', '--apply'], { root })).toBe(0);

    expect(readPageDoc(dataRoot, 'Vol1', '201', 0)?.panels).toHaveLength(3);
    expect(readPageDoc(dataRoot, 'Vol1', '202', 0)?.panels).toHaveLength(3);
    expect(readPageDoc(dataRoot, 'Vol2', '199', 0)).toBeNull();
  });

  it('limits --chapter to that chapter', async () => {
    expect(await runCli(['detect', '--volume', 'Vol1', '--chapter', '202', '--apply'], { root })).toBe(0);

    expect(readPageDoc(dataRoot, 'Vol1', '201', 0)).toBeNull();
    expect(readPageDoc(dataRoot, 'Vol1', '202', 0)?.panels).toHaveLength(3);
  });

  it('keeps detection a preview until --apply is passed', async () => {
    expect(await runCli(['detect', '--volume', 'Vol1'], { root })).toBe(0);
    expect(readPageDoc(dataRoot, 'Vol1', '201', 0)).toBeNull();
  });
});

describe('whole-library detection path', () => {
  it('regress scans every volume and writes a baseline keyed by volume/chapter/page', async () => {
    expect(await runCli(['regress', '--lang', 'en'], { root })).toBe(0);

    const baseline = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'detect-baseline.json'), 'utf8'));
    expect(baseline).toEqual({
      'Vol1/201/1': 3,
      'Vol1/202/1': 3,
      'Vol2/199/1': 3,
    });
  });

  it('report summarises the whole library', async () => {
    expect(await runCli(['report', '--lang', 'en'], { root })).toBe(0);

    const lines = vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes('3 page(s)'))).toBe(true);
  });
});

describe('error exit codes', () => {
  it('returns 1 when the volume does not exist', async () => {
    expect(await runCli(['detect', '--volume', 'Missing'], { root })).toBe(1);
    expect(console.error).toHaveBeenCalled();
  });

  it('returns 1 when the chapter does not exist', async () => {
    expect(await runCli(['detect', '--volume', 'Vol1', '--chapter', '999'], { root })).toBe(1);
  });

  it('returns 1 for an incomplete apply-template invocation', async () => {
    expect(await runCli(['apply-template', '--volume', 'Vol1'], { root })).toBe(1);
  });

  it('returns 0 and prints usage for an unknown command', async () => {
    expect(await runCli(['does-not-exist'], { root })).toBe(0);
    const lines = vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes('detect --volume'))).toBe(true);
  });

  it('renders errors in the requested language', async () => {
    expect(await runCli(['detect', '--volume', 'Missing', '--lang', 'zh'], { root })).toBe(1);
    const last = vi.mocked(console.error).mock.calls.at(-1)?.[0];
    expect(String(last)).toContain('出错了');
  });
});
