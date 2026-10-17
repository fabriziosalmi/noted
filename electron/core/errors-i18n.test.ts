// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The messages a person can meet come from the main process in the language of the app, not always in English.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-errors-i18n-'));
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

import { setLanguage } from './language';
import { validateFolderName } from '../ipc-utils';
import { moveFolder } from '../vault-ops';
import { assertFetchAllowed } from '../llm-guard';

const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-errors-vault-'));
afterAll(() => { for (const d of [userData, vault]) fs.rmSync(d, { recursive: true, force: true }); });

describe('main-process errors follow the app language', () => {
  beforeAll(async () => { await setLanguage('it'); });

  it('in Italian', () => {
    expect(() => validateFolderName('')).toThrow('Il nome della cartella non può essere vuoto');
    expect(() => moveFolder(vault, 'Missing', 'Elsewhere', (dir, rel) => path.join(dir, rel))).toThrow('Cartella "Missing" non trovata');
    expect(() => assertFetchAllowed('ftp://example.com/x')).toThrow('Sono ammessi solo indirizzi http(s)');
    expect(() => assertFetchAllowed('https://evil.example/x')).toThrow('Host bloccato (non è un endpoint LLM consentito): evil.example');
  });

  it('and as before in English', async () => {
    await setLanguage('en');
    expect(() => validateFolderName('')).toThrow('Folder name must be a non-empty string');
    expect(() => assertFetchAllowed('https://evil.example/x')).toThrow('Blocked host (not an allowlisted LLM endpoint): evil.example');
  });
});
