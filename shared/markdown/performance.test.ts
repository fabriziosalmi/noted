// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GOLDEN } from './golden';
import { parseMarkdownBody } from './parser';
import { serializeMarkdownBody } from './serializer';

// The codec runs on every autosave, so it has to stay linear in the size of the note. An accidental
// quadratic step (the first version took 14 s for 1 MB) shows up here long before it reaches a user.
describe('codec speed', () => {
  const body = GOLDEN.filter((c) => c[0] !== 'doc').map((c) => c[2]).join('\n\n');

  // The first version took 14 s for 1 MB and would take about 2 minutes for 3 MB; a linear codec does 3 MB in a
  // second or two, so a bound far above that and far below the quadratic time holds on any busy machine.
  it('converts a 3 MB note in well under a minute (it is linear)', () => {
    const note = Array.from({ length: 480 }, () => body).join('\n\n'); // ~3 MB, ~110,000 blocks
    expect(note.length).toBeGreaterThan(2_800_000);
    const t0 = performance.now();
    const markdown = serializeMarkdownBody(parseMarkdownBody(note));
    const elapsed = performance.now() - t0;
    expect(markdown.length).toBeGreaterThan(1_500_000);
    expect(elapsed).toBeLessThan(45_000);
  }, 180_000);
});
