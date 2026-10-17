// @vitest-environment node
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type * as PathsModule from './paths';

// Which vault a request goes to. Every note read, save and delete resolves its folder here, so a wrong answer writes
// a note into another vault: a configured vault that is not there must be refused, never replaced by the default one.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-paths-'));
const userData = path.join(root, 'userData');
const defaultVault = path.join(root, 'default');
fs.mkdirSync(userData, { recursive: true });
vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false } }));

const rootsFile = path.join(userData, 'vault-roots.json');
type Paths = typeof PathsModule;
let paths: Paths;

beforeEach(async () => {
  vi.resetModules(); // the allowlist is read once per process
  process.env.NOTED_NOTES_DIR = defaultVault;
  paths = await import('./paths');
  paths.initNotesDir();
});
afterEach(() => { fs.rmSync(rootsFile, { force: true }); });
afterAll(() => { delete process.env.NOTED_NOTES_DIR; fs.rmSync(root, { recursive: true, force: true }); });

const vault = (name: string): string => { const d = path.join(root, name); fs.mkdirSync(d, { recursive: true }); return d; };
const refusal = (fn: () => unknown): unknown => { try { fn(); } catch (err) { return err; } return null; };

describe('getTargetDir', () => {
  it('is the default vault when none is configured, or the default one is', () => {
    expect(paths.getTargetDir()).toBe(defaultVault);
    expect(paths.getTargetDir('')).toBe(defaultVault);
    expect(paths.getTargetDir(defaultVault)).toBe(defaultVault);
  });

  it('is the configured vault when it was chosen in the folder picker and is there', () => {
    const usb = vault('usb');
    paths.blessVaultRoot(usb);
    expect(paths.getTargetDir(usb)).toBe(usb);
  });

  it('refuses a chosen vault that is not there (a drive not mounted) instead of using the default one', () => {
    const usb = vault('gone');
    paths.blessVaultRoot(usb);
    fs.rmSync(usb, { recursive: true });
    const err = refusal(() => paths.getTargetDir(usb));
    expect(err).toBeInstanceOf(paths.VaultUnavailableError);
    expect((err as InstanceType<Paths['VaultUnavailableError']>).code).toBe('vault-unavailable');
    expect((err as Error).message).toContain(usb);
    expect(paths.availableTargetDir(usb)).toBeNull();
  });

  it('refuses a folder that was never chosen in the folder picker', () => {
    const other = vault('never-chosen');
    expect(refusal(() => paths.getTargetDir(other))).toBeInstanceOf(paths.VaultUnavailableError);
  });

  it('refuses rather than falls back when the allowlist file is damaged', async () => {
    const usb = vault('damaged-list');
    fs.writeFileSync(rootsFile, `["${usb}"`); // torn: cut before the closing bracket
    vi.resetModules();
    paths = await import('./paths');
    paths.initNotesDir();
    expect(refusal(() => paths.getTargetDir(usb))).toBeInstanceOf(paths.VaultUnavailableError);
  });
});

describe('blessVaultRoot', () => {
  it('writes the allowlist whole, through a temporary file, and it reads back', async () => {
    const a = vault('a');
    const b = vault('b');
    paths.blessVaultRoot(a);
    paths.blessVaultRoot(b);
    expect(JSON.parse(fs.readFileSync(rootsFile, 'utf8'))).toEqual(expect.arrayContaining([a, b]));
    expect(fs.readdirSync(userData).filter(f => f.endsWith('.tmp'))).toEqual([]);
    vi.resetModules();
    paths = await import('./paths');
    paths.initNotesDir();
    expect(paths.getTargetDir(b)).toBe(b);
  });
});
