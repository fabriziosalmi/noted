import fs from 'node:fs';

/**
 * The version to show the user. A packaged app reports its own (electron-builder
 * stamps it from package.json). An unpackaged run is started as `electron
 * dist-electron/main.cjs`, so Electron finds no package.json next to the app and
 * answers with the version of Electron itself (e.g. "42.10.0"): in that case read
 * the project's package.json instead.
 */
export function resolveAppVersion(opts: { isPackaged: boolean; electronReported: string; packageJsonPath: string }): string {
  if (opts.isPackaged) return opts.electronReported;
  try {
    const v = (JSON.parse(fs.readFileSync(opts.packageJsonPath, 'utf8')) as { version?: unknown }).version;
    if (typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v)) return v;
  } catch { /* fall through */ }
  return opts.electronReported;
}
