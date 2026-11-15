import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_STORAGE_CONFIG, markSecrets, setSecret } from '../../server/storageProviders.ts';
import { AppError } from '../../server/errors.ts';
import type { StorageConfig, StorageTarget } from '../../server/storageProviders.ts';
import { makeTempDir, removeDir, writeFile } from '../helpers/tmp.ts';

const dirs: string[] = [];

function tempRoot(): string {
  const root = makeTempDir('secrets');
  dirs.push(root);
  return root;
}

afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!);
});

const SECRET_FILE = 'secrets.json.enc';
const KEY_FILE = '.secret.key';

function configWith(...ids: string[]): StorageConfig {
  const target = (id: string): StorageTarget => ({ id, name: id, kind: 'webdav', enabled: true, readOnly: false });
  return { ...DEFAULT_STORAGE_CONFIG, backups: ids.map(target) };
}

const expectDecryptError = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('ERR_SECRETS_DECRYPT_FAILED');
    expect((err as AppError).status).toBe(500);
    return;
  }
  throw new Error('expected ERR_SECRETS_DECRYPT_FAILED');
};

describe('storage credentials', () => {
  it('round-trips a password and marks only the matching target', () => {
    const root = tempRoot();
    setSecret(root, 'nas', 'hunter2');
    const marked = markSecrets(root, configWith('nas', 'other'));
    expect(marked.backups[0].hasSecret).toBe(true);
    expect(marked.backups[1].hasSecret).toBe(false);
    expect(fs.readFileSync(path.join(root, SECRET_FILE), 'utf8')).not.toContain('hunter2');
  });

  it('treats a missing secrets file as "nothing stored yet"', () => {
    const root = tempRoot();
    expect(markSecrets(root, configWith('nas')).backups[0].hasSecret).toBe(false);
    expect(fs.existsSync(path.join(root, SECRET_FILE))).toBe(false);
  });

  it('refuses to overwrite when the key file was replaced, and leaves both files untouched', () => {
    const root = tempRoot();
    setSecret(root, 'nas', 'hunter2');
    const secretPath = path.join(root, SECRET_FILE);
    const keyPath = path.join(root, KEY_FILE);
    const before = fs.readFileSync(secretPath);
    fs.writeFileSync(keyPath, crypto.randomBytes(32));

    expectDecryptError(() => setSecret(root, 'nas', 'new-password'));
    expectDecryptError(() => setSecret(root, 'other', 'value'));
    expectDecryptError(() => markSecrets(root, configWith('nas')));
    expect(fs.readFileSync(secretPath).equals(before)).toBe(true);
  });

  it('refuses to write when the key file is missing', () => {
    const root = tempRoot();
    setSecret(root, 'nas', 'hunter2');
    const secretPath = path.join(root, SECRET_FILE);
    const before = fs.readFileSync(secretPath);
    fs.rmSync(path.join(root, KEY_FILE));

    expectDecryptError(() => setSecret(root, 'nas', null));
    expectDecryptError(() => markSecrets(root, configWith('nas')));
    expect(fs.readFileSync(secretPath).equals(before)).toBe(true);
  });

  it('does not regenerate a malformed key file', () => {
    const root = tempRoot();
    const keyPath = path.join(root, KEY_FILE);
    fs.writeFileSync(keyPath, Buffer.from('short'));
    expectDecryptError(() => setSecret(root, 'nas', 'value'));
    expect(fs.readFileSync(keyPath, 'utf8')).toBe('short');
  });

  it('refuses to overwrite a tampered secrets payload', () => {
    const root = tempRoot();
    setSecret(root, 'nas', 'hunter2');
    const secretPath = path.join(root, SECRET_FILE);
    writeFile(secretPath, JSON.stringify({ v: 1, iv: 'AAAA', tag: 'AAAA', data: 'AAAA' }));
    const before = fs.readFileSync(secretPath);

    expectDecryptError(() => setSecret(root, 'nas', 'new-password'));
    expect(fs.readFileSync(secretPath).equals(before)).toBe(true);
  });
});
