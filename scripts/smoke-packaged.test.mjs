import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { changed, readLog, snapshot } from './smoke-packaged.mjs';

describe('readLog', () => {
  const line = o => JSON.stringify({ ts: 't', ...o });
  it('sees a start and a loaded window, and no problem', () => {
    const r = readLog([line({ level: 'info', event: 'app_started' }), line({ level: 'info', event: 'renderer_loaded' }), ''].join('\n'));
    expect(r).toEqual({ started: true, loaded: true, problems: [] });
  });

  it('reports errors, a lost renderer and a line that is not JSON', () => {
    const r = readLog([
      line({ level: 'error', event: 'mcp_sse_binary_missing' }),
      line({ level: 'warn', event: 'renderer_gone', reason: 'crashed' }),
      'garbage',
    ].join('\n'));
    expect(r.loaded).toBe(false);
    expect(r.problems.map(p => p.event)).toEqual(['mcp_sse_binary_missing', 'renderer_gone', 'unparsable_log_line']);
  });
});

describe('release.sh', () => {
  it('smoke-tests the packaged app after the build and before notarizing', () => {
    const script = fs.readFileSync('scripts/release.sh', 'utf8');
    const smoke = script.indexOf('node scripts/smoke-packaged.mjs');
    expect(smoke).toBeGreaterThan(script.indexOf('npm run build'));
    expect(smoke).toBeLessThan(script.indexOf('xcrun notarytool submit'));
  });
});

describe('snapshot and changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-smoke-test-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('notices a file written, added or removed, and nothing when nothing happened', async () => {
    fs.writeFileSync(path.join(dir, 'a'), '1');
    const before = snapshot(dir);
    expect(changed(before, snapshot(dir))).toEqual([]);
    const later = new Date(Date.now() + 5_000);
    fs.utimesSync(path.join(dir, 'a'), later, later);
    fs.writeFileSync(path.join(dir, 'b'), '2');
    expect(changed(before, snapshot(dir))).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('treats a folder that does not exist as unchanged while it stays missing', () => {
    expect(snapshot(path.join(dir, 'missing'))).toBeNull();
    expect(changed(null, null)).toEqual([]);
    expect(changed(null, { '.': 1 })).toEqual(['.']);
  });
});
