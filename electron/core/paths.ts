import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// Resolved inside app.whenReady() to ensure app paths are available.
let DEFAULT_NOTES_DIR: string;

export function initNotesDir() {
  // NOTED_NOTES_DIR overrides the vault location — used by the demo harness and
  // integration runs to point at a throwaway directory instead of real notes.
  DEFAULT_NOTES_DIR = process.env.NOTED_NOTES_DIR
    ? process.env.NOTED_NOTES_DIR
    : app.isPackaged
    ? path.join(app.getPath('userData'), 'notes')
    : path.join(__dirname, '../notes_dev');
  if (!fs.existsSync(DEFAULT_NOTES_DIR)) {
    fs.mkdirSync(DEFAULT_NOTES_DIR, { recursive: true });
  }
}

// Allowlist of vault roots the renderer is permitted to target. Without this,
// getTargetDir would return ANY path that exists, so a compromised renderer
// could point wipe-all-notes / copy-vault at an arbitrary directory (arbitrary
// recursive delete/write). Roots become blessed only through the native folder
// picker (a real user gesture) — never from a renderer-supplied string.
let vaultRoots: Set<string> | null = null;
let vaultRootsFileExistedAtStartup = false;
const vaultRootsFile = () => path.join(app.getPath('userData'), 'vault-roots.json');

function loadVaultRoots(): Set<string> {
  if (vaultRoots) return vaultRoots;
  const set = new Set<string>([path.resolve(DEFAULT_NOTES_DIR)]);
  try {
    vaultRootsFileExistedAtStartup = fs.existsSync(vaultRootsFile());
    const arr = JSON.parse(fs.readFileSync(vaultRootsFile(), 'utf8'));
    if (Array.isArray(arr)) for (const p of arr) if (typeof p === 'string') set.add(path.resolve(p));
  } catch { /* first run: only the default root is blessed */ }
  vaultRoots = set;
  return set;
}

export function blessVaultRoot(dir: string): void {
  const set = loadVaultRoots();
  set.add(path.resolve(dir));
  try { fs.writeFileSync(vaultRootsFile(), JSON.stringify([...set]), 'utf8'); } catch { /* best-effort */ }
}

export function isBlessedRoot(dir: string): boolean {
  return loadVaultRoots().has(path.resolve(dir));
}

// A configured vault path is plausible enough to migrate (bless once): absolute,
// an existing directory, and not a shallow/system location.
function isSaneVaultPath(dir: string): boolean {
  try {
    const resolved = path.resolve(dir);
    if (resolved === path.parse(resolved).root) return false;
    if (resolved.split(path.sep).filter(Boolean).length < 2) return false;
    return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
  } catch { return false; }
}

export const getTargetDir = (customDir?: string) => {
  if (customDir && fs.existsSync(customDir) && isBlessedRoot(customDir)) {
    return customDir;
  }
  return DEFAULT_NOTES_DIR;
};

// The renderer's configured vault directory, mirrored in main so windows that
// have no access to the store (quick-capture) still write into the right vault.
let activeVaultDir: string | null = null;

/**
 * Resolve `path.join(targetDir, relName)` and ensure the resulting path stays
 * inside `targetDir` after symlinks are followed. Prevents a malicious symlink
 * planted inside the syncDir from being used to escape to /etc/passwd etc.
 *
 * The fileName argument is assumed to already have passed `validateFileName`
 * (no `..`, no absolute paths) — this is the second line of defence.
 */
export function safeResolve(targetDir: string, relName: string): string {
  const targetReal = fs.realpathSync(targetDir);
  const candidate = path.join(targetDir, relName);
  // The candidate may not exist yet (create flow). Resolve as far as possible:
  // walk up until an existing ancestor is found, realpath it, then re-append
  // the un-resolved tail.
  let ancestor = candidate;
  const unresolved: string[] = [];
  while (!fs.existsSync(ancestor)) {
    unresolved.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break; // hit filesystem root
    ancestor = parent;
  }
  const ancestorReal = fs.realpathSync(ancestor);
  const finalReal = unresolved.length ? path.join(ancestorReal, ...unresolved) : ancestorReal;
  // Match against the real target with a trailing separator to avoid prefix
  // collisions (e.g. /vault matching /vault2).
  const targetWithSep = targetReal.endsWith(path.sep) ? targetReal : targetReal + path.sep;
  if (finalReal !== targetReal && !finalReal.startsWith(targetWithSep)) {
    throw new Error('Path escapes vault directory');
  }
  return finalReal;
}

/** The vault the renderer currently has open (null until it reports one). */
export function getActiveVaultDir(): string | null {
  return activeVaultDir;
}

/**
 * Record the renderer's active vault. The first time a configured vault is seen
 * it is blessed (see below), so an upgrade from before roots were allowlisted
 * doesn't lose it.
 */
export function setActiveVaultDir(dir: unknown): void {
  activeVaultDir = typeof dir === 'string' && dir ? dir : null;
  if (activeVaultDir) {
    loadVaultRoots(); // resolve whether roots were already established
    // One-time migration: bless an already-configured vault the first time we
    // see it (before roots were allowlisted), so an upgrade doesn't lose it.
    // Once the roots file exists, only the native picker can add roots.
    if (!vaultRootsFileExistedAtStartup && !isBlessedRoot(activeVaultDir) && isSaneVaultPath(activeVaultDir)) {
      blessVaultRoot(activeVaultDir);
    }
  }
}
