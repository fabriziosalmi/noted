import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Every action a workflow runs is named by commit: a tag can be moved by whoever controls the action's repository, and
// these workflows sign, attest and publish the releases.
const dir = '.github/workflows';
const uses = readdirSync(dir).filter(f => f.endsWith('.yml')).flatMap(file =>
  readFileSync(path.join(dir, file), 'utf8').split('\n')
    .map(line => /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(line)?.[1])
    .filter(Boolean)
    .map(ref => ({ file, ref })));

describe('workflows', () => {
  it('use actions', () => expect(uses.length).toBeGreaterThan(10));

  it.each(uses)('$file runs $ref by commit', ({ ref }) => {
    expect(ref).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
  });

  it('install tools by exact version', () => {
    for (const file of readdirSync(dir)) {
      for (const m of readFileSync(path.join(dir, file), 'utf8').matchAll(/npx (?:--yes )?(@?[\w./-]+)@(\S+)/g)) {
        expect(m[2], `${file}: ${m[1]}`).toMatch(/^\d+\.\d+\.\d+$/);
      }
    }
  });
});
