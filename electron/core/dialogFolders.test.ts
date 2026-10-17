// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Since Electron 43 an Open dialog with no defaultPath starts in Downloads and the system no longer remembers the
// last folder: each of ours starts where it was last used.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-dialog-folders-'));
const userData = path.join(root, 'userData');
fs.mkdirSync(userData);
vi.mock('electron', () => ({ app: { getPath: () => userData } }));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

import { dialogStart, rememberDialogFolder } from './dialogFolders';

const dir = (name: string) => { const d = path.join(root, name); fs.mkdirSync(d, { recursive: true }); return d; };
beforeEach(() => fs.rmSync(path.join(userData, 'dialog-folders.json'), { force: true }));

describe('dialog folders', () => {
  it('starts where the same dialog was last used, each dialog on its own', () => {
    const a = dir('a');
    const b = dir('b');
    rememberDialogFolder('import-vault', a);
    rememberDialogFolder('import-enex', b);
    expect(dialogStart('import-vault')).toBe(a);
    expect(dialogStart('import-enex')).toBe(b);
    expect(dialogStart('export-vault')).toBeUndefined();
  });

  it('uses the fallback the first time, and nothing when there is none', () => {
    const vaultParent = dir('vaults');
    expect(dialogStart('choose-vault', vaultParent)).toBe(vaultParent);
    expect(dialogStart('choose-vault')).toBeUndefined();
  });

  it('forgets a folder that is gone, and ignores a fallback that does not exist', () => {
    const gone = dir('gone');
    rememberDialogFolder('export-vault', gone);
    fs.rmSync(gone, { recursive: true });
    expect(dialogStart('export-vault', path.join(root, 'missing'))).toBeUndefined();
  });

  it('survives a file that is not what it should be', () => {
    fs.writeFileSync(path.join(userData, 'dialog-folders.json'), '{not json');
    expect(dialogStart('import-vault')).toBeUndefined();
    const c = dir('c');
    rememberDialogFolder('import-vault', c);
    expect(dialogStart('import-vault')).toBe(c);
  });
});
