// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeMarkdown } from './codec';
import { GOLDEN } from './golden';

const strip = (s: string): string => s.replace(/\n$/, '');

describe('golden corpus', () => {
  it('has at least 200 cases and unique ids', () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(200);
    const ids = GOLDEN.map((c) => c[1]);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  for (const [group, id, markdown, expected] of GOLDEN) {
    describe(`${group}/${id}`, () => {
      const want = expected ?? markdown;

      it('comes back as written (or as the listed normalisation)', () => {
        expect(strip(normalizeMarkdown(markdown))).toBe(want);
      });

      it('is stable: a second pass changes nothing', () => {
        const once = normalizeMarkdown(markdown);
        expect(normalizeMarkdown(once)).toBe(once);
      });
    });
  }
});
