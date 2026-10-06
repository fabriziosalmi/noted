// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import type * as Codec from '../shared/markdown/codec';
import type * as Migrate from '../shared/markdown/migrate';
import fs from 'node:fs';
import path from 'node:path';

// Inside node_modules so the externals (markdown-it, prosemirror...) resolve from the bundle, as they do from dist-electron/.
const outDir = (): string => {
  const d = path.join(process.cwd(), 'node_modules', '.cache', 'noted-bundle-test');
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// The main process (and the MCP server) are bundled by esbuild as CommonJS with the packages left external.
// This package is "type": "module", so esbuild reads our files as ES modules and gives `import X from 'cjs-package'`
// Node's meaning (X = module.exports): a package whose CJS build exports `{ default: X }` then yields an object, and
// `X.configure(...)` is "not a function". Vitest resolves packages its own way and never sees this, so the codec is
// bundled and run here exactly as the app's build does it.
describe('the codec as the main process bundles it', { timeout: 60_000 }, () => {
  it('loads and converts', async () => {
    const out = path.join(fs.mkdtempSync(path.join(outDir(), 'b-')), 'codec.cjs');
    try {
      await build({
        entryPoints: ['shared/markdown/codec.ts'],
        bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: out, logLevel: 'silent',
      });
      const codec = createRequire(import.meta.url)(out) as typeof Codec;
      expect(codec.normalizeMarkdown('# T\n\n*a*  [[Link]] ==x==')).toBe('# T\n\n*a*  [[Link]] ==x==\n');
      expect(codec.plainTextToMarkdown('one\ntwo')).toBe('one\n\ntwo\n');
    } finally {
      fs.rmSync(path.dirname(out), { recursive: true, force: true });
    }
  });

  it('converts a legacy note through the same bundle, with a DOM', async () => {
    const out = path.join(fs.mkdtempSync(path.join(outDir(), 'b-')), 'migrate.cjs');
    try {
      await build({
        entryPoints: ['shared/markdown/migrate.ts'],
        bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: out, logLevel: 'silent',
      });
      const { convertHtmlNote } = createRequire(import.meta.url)(out) as typeof Migrate;
      const { JSDOM } = await import('jsdom');
      const { window } = new JSDOM('');
      const r = convertHtmlNote('<h1>T</h1><p>a <strong>b</strong></p>', { document: window.document, DOMParser: window.DOMParser as unknown as typeof DOMParser });
      expect(r).toEqual({ text: '# T\n\na **b**\n', verdict: 'exact', findings: [] });
    } finally {
      fs.rmSync(path.dirname(out), { recursive: true, force: true });
    }
  });
});
