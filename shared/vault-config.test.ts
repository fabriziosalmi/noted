// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readVaultConfig, writeVaultConfig, vaultConfigPath, isValidRetentionDays } from './vault-config';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-vc-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('vault config', () => {
  it('reads nothing from a vault that has no config', () => {
    expect(readVaultConfig(dir)).toEqual({});
    expect(readVaultConfig(path.join(dir, 'does-not-exist'))).toEqual({});
  });

  it('writes and reads back, creating .noted, and leaves no temp file behind', () => {
    expect(writeVaultConfig(dir, { trashRetentionDays: 7 })).toEqual({ trashRetentionDays: 7 });
    expect(readVaultConfig(dir)).toEqual({ trashRetentionDays: 7 });
    expect(fs.readdirSync(path.join(dir, '.noted'))).toEqual(['config.json']);
  });

  it('merges instead of replacing, and 0 (keep forever) is a real value', () => {
    writeVaultConfig(dir, { trashRetentionDays: 7 });
    writeVaultConfig(dir, {});
    expect(readVaultConfig(dir).trashRetentionDays).toBe(7);
    writeVaultConfig(dir, { trashRetentionDays: 0 });
    expect(readVaultConfig(dir).trashRetentionDays).toBe(0);
  });

  it.each([-1, 1.5, 3651, NaN, Infinity])('refuses to write %s', bad => {
    expect(() => writeVaultConfig(dir, { trashRetentionDays: bad })).toThrow(/whole number/);
    expect(fs.existsSync(vaultConfigPath(dir))).toBe(false);
  });

  it('survives a corrupt or hostile file, and drops invalid fields', () => {
    fs.mkdirSync(path.join(dir, '.noted'));
    fs.writeFileSync(vaultConfigPath(dir), '{not json');
    expect(readVaultConfig(dir)).toEqual({});
    fs.writeFileSync(vaultConfigPath(dir), JSON.stringify({ trashRetentionDays: '30', extra: 1 }));
    expect(readVaultConfig(dir)).toEqual({});
    fs.writeFileSync(vaultConfigPath(dir), 'null');
    expect(readVaultConfig(dir)).toEqual({});
    fs.writeFileSync(vaultConfigPath(dir), JSON.stringify({ trashRetentionDays: 14, extra: 1 }));
    expect(readVaultConfig(dir)).toEqual({ trashRetentionDays: 14 });
  });

  it('validates retention values', () => {
    for (const ok of [0, 1, 30, 3650]) expect(isValidRetentionDays(ok)).toBe(true);
    for (const bad of [-1, 3651, 1.2, '3', null, undefined]) expect(isValidRetentionDays(bad)).toBe(false);
  });
});
