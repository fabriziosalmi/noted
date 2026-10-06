// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VAULT_MARKER } from './format';
import { readVaultFormat, writeVaultFormat, vaultMarkerPath } from './formatFile';

const dirs: string[] = [];
const vault = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-format-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('vault format marker', () => {
  it('is HTML when there is no marker, an unreadable one, or an unknown value', () => {
    const d = vault();
    expect(readVaultFormat(d)).toBe('html');
    fs.writeFileSync(vaultMarkerPath(d), 'not json');
    expect(readVaultFormat(d)).toBe('html');
    fs.writeFileSync(vaultMarkerPath(d), '{"format":"rtf"}');
    expect(readVaultFormat(d)).toBe('html');
    fs.writeFileSync(vaultMarkerPath(d), 'null');
    expect(readVaultFormat(d)).toBe('html');
  });

  it('round-trips, keeps other fields, and leaves no temp file behind', () => {
    const d = vault();
    fs.writeFileSync(vaultMarkerPath(d), JSON.stringify({ format: 'html', note: 'keep me' }));
    writeVaultFormat(d, 'markdown');
    expect(readVaultFormat(d)).toBe('markdown');
    expect(JSON.parse(fs.readFileSync(vaultMarkerPath(d), 'utf8'))).toEqual({ format: 'markdown', note: 'keep me' });
    writeVaultFormat(d, 'html');
    expect(readVaultFormat(d)).toBe('html');
    expect(fs.readdirSync(d)).toEqual([VAULT_MARKER]);
  });

  it('refuses a format it does not know', () => {
    expect(() => writeVaultFormat(vault(), 'rtf' as never)).toThrow(/Unknown note format/);
  });
});
