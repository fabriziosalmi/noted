import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// The MCP server ships jsdom from mcp-server/runtime's lockfile, the app from the root one: the same version in both,
// so the server parses notes as the app does and an upgrade cannot reach one and not the other.
const lock = (file) => JSON.parse(readFileSync(file, 'utf8'));

describe('MCP runtime dependencies', () => {
  it('pin jsdom to the version the root lockfile resolves', () => {
    const root = lock('package-lock.json').packages['node_modules/jsdom'].version;
    const runtime = lock('mcp-server/runtime/package-lock.json');
    expect(runtime.packages['node_modules/jsdom'].version).toBe(root);
    expect(runtime.packages[''].dependencies.jsdom).toBe(root);
  });

  it('are installed from the lockfile, never resolved at build time', () => {
    const build = lock('package.json').scripts['build:mcp'];
    expect(build).toContain('node scripts/install-mcp-runtime.mjs');
    expect(build).not.toMatch(/npm install\b/);
    expect(readFileSync('scripts/install-mcp-runtime.mjs', 'utf8')).toMatch(/'ci', '--omit=dev', '--ignore-scripts'/);
  });
});
