import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { darwinFor } from './mac-min-darwin.mjs';

describe('darwinFor', () => {
  it('gives the Darwin version electron-updater compares against', () => {
    expect(darwinFor('12.0')).toBe('21.0.0'); // Monterey
    expect(darwinFor('13.0')).toBe('22.0.0'); // Ventura, Electron 44's minimum
    expect(darwinFor('15')).toBe('24.0.0');
    expect(darwinFor('26.3')).toBe('25.0.0'); // the year numbering
  });

  it('refuses a version it does not know rather than guessing', () => {
    expect(() => darwinFor('10.15')).toThrow('no known Darwin version');
    expect(() => darwinFor('16.0')).toThrow();
    expect(() => darwinFor('')).toThrow();
  });

  it('works from the command line, as release.sh calls it', () => {
    const ok = spawnSync('node', ['scripts/mac-min-darwin.mjs', '13.0'], { encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout.trim()).toBe('22.0.0');
    const bad = spawnSync('node', ['scripts/mac-min-darwin.mjs', 'x'], { encoding: 'utf8' });
    expect(bad.status).toBe(1);
  });
});

describe('release.sh', () => {
  const script = readFileSync('scripts/release.sh', 'utf8');
  it('writes the minimum system into the macOS update feed, from the built app', () => {
    expect(script).toContain('LSMinimumSystemVersion');
    expect(script).toContain('node scripts/mac-min-darwin.mjs');
    expect(script).toMatch(/echo "minimumSystemVersion: \$min_darwin"/);
  });
});
