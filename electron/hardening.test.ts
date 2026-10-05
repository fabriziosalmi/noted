// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const mainSrc = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

describe('Electron hardening (#100)', () => {
  it('every BrowserWindow enables the renderer sandbox explicitly', () => {
    const windows = mainSrc.match(/new BrowserWindow\(/g) ?? [];
    const sandboxed = mainSrc.match(/sandbox:\s*true/g) ?? [];
    expect(windows.length).toBeGreaterThan(0);
    expect(sandboxed.length).toBe(windows.length);
    expect(mainSrc).not.toMatch(/sandbox:\s*false/);
    expect(mainSrc).not.toMatch(/nodeIntegration:\s*true/);
  });

  it('configures the release fuses', () => {
    expect(pkg.build.electronFuses).toMatchObject({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
    });
  });

  it('does not rely on ELECTRON_RUN_AS_NODE, which the RunAsNode fuse disables', () => {
    expect(mainSrc).not.toMatch(/ELECTRON_RUN_AS_NODE\s*:/);
    expect(mainSrc).toMatch(/utilityProcess\.fork\(/);
  });
});
