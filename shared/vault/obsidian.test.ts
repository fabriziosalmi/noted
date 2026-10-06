// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isObsidianVault, obsidianAttachmentsFolder } from './obsidian';

const dirs: string[] = [];
const vault = (app?: string): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-obs-'));
  dirs.push(d);
  if (app !== undefined) {
    fs.mkdirSync(path.join(d, '.obsidian'));
    fs.writeFileSync(path.join(d, '.obsidian', 'app.json'), app);
  }
  return d;
};
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('isObsidianVault', () => {
  it('is a folder holding .obsidian/', () => {
    expect(isObsidianVault(vault('{}'))).toBe(true);
    expect(isObsidianVault(vault())).toBe(false);
    expect(isObsidianVault('/does/not/exist')).toBe(false);
  });
});

describe('obsidianAttachmentsFolder', () => {
  const folder = (value: unknown): string | null => obsidianAttachmentsFolder(vault(JSON.stringify({ attachmentFolderPath: value })));

  it('reads one fixed folder at the vault root', () => {
    expect(folder('Files')).toBe('Files');
    expect(folder('Pasted images/')).toBe('Pasted images');
    expect(folder('assets')).toBe('assets');
  });

  it('has no answer for settings Noted cannot follow', () => {
    expect(folder('/')).toBeNull(); // the vault root
    expect(folder('./')).toBeNull(); // next to the note
    expect(folder('./attachments')).toBeNull(); // relative to the note
    expect(folder('a/b')).toBeNull(); // nested
    expect(folder('../out')).toBeNull();
    expect(folder('.hidden')).toBeNull();
    expect(folder('')).toBeNull();
    expect(folder(42)).toBeNull();
  });

  it('never throws: no settings, broken settings, or no vault', () => {
    expect(obsidianAttachmentsFolder(vault())).toBeNull();
    expect(obsidianAttachmentsFolder(vault('not json'))).toBeNull();
    expect(obsidianAttachmentsFolder(vault('null'))).toBeNull();
    expect(obsidianAttachmentsFolder('/does/not/exist')).toBeNull();
  });
});
