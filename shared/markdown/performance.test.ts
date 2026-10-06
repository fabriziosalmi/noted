// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GOLDEN } from './golden';
import { parseMarkdownBody } from './parser';
import { serializeMarkdownBody } from './serializer';

// The codec runs on every autosave, so it has to stay linear in the size of the note. An accidental
// quadratic step (the first version took 14 s for 1 MB) shows up here long before it reaches a user.
describe('codec speed', () => {
  const body = GOLDEN.filter((c) => c[0] !== 'doc').map((c) => c[2]).join('\n\n');
  const note = Array.from({ length: 160 }, () => body).join('\n\n'); // ~1 MB, ~37,000 blocks

  it('reads and writes a 1 MB note in well under a few seconds', () => {
    expect(note.length).toBeGreaterThan(900_000);
    const t0 = performance.now();
    const doc = parseMarkdownBody(note);
    const markdown = serializeMarkdownBody(doc);
    const elapsed = performance.now() - t0;
    expect(markdown.length).toBeGreaterThan(500_000);
    expect(elapsed).toBeLessThan(5_000);
  }, 60_000);
});
