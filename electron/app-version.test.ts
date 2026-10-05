// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAppVersion } from './app-version';

const dirs: string[] = [];
function pkg(content: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-ver-'));
  dirs.push(d);
  const p = path.join(d, 'package.json');
  fs.writeFileSync(p, content);
  return p;
}
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('resolveAppVersion', () => {
  it('trusts the packaged app', () => {
    expect(resolveAppVersion({ isPackaged: true, electronReported: '1.3.7', packageJsonPath: pkg('{"version":"9.9.9"}') })).toBe('1.3.7');
  });

  it("shows the project's version in development, not Electron's", () => {
    expect(resolveAppVersion({ isPackaged: false, electronReported: '42.10.0', packageJsonPath: pkg('{"version":"1.3.7"}') })).toBe('1.3.7');
  });

  it('falls back to what Electron reports when package.json is missing, broken or has no version', () => {
    const missing = path.join(os.tmpdir(), 'noted-no-such-dir', 'package.json');
    expect(resolveAppVersion({ isPackaged: false, electronReported: '42.10.0', packageJsonPath: missing })).toBe('42.10.0');
    expect(resolveAppVersion({ isPackaged: false, electronReported: '42.10.0', packageJsonPath: pkg('not json') })).toBe('42.10.0');
    expect(resolveAppVersion({ isPackaged: false, electronReported: '42.10.0', packageJsonPath: pkg('{"name":"x"}') })).toBe('42.10.0');
    expect(resolveAppVersion({ isPackaged: false, electronReported: '42.10.0', packageJsonPath: pkg('{"version":"latest"}') })).toBe('42.10.0');
  });
});
