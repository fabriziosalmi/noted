// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeMarkdown, plainTextToMarkdown } from './codec';
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

describe('plainTextToMarkdown (quick capture)', () => {
  it('writes one paragraph per non-empty line, as typed', () => {
    expect(plainTextToMarkdown('first line\n\nsecond *line* with [[Link]] and #tag\r\n  third  ')).toBe('first line\n\nsecond \\*line\\* with [[Link]] and #tag\n\nthird\n');
  });

  it('keeps syntax characters from becoming syntax', () => {
    const md = plainTextToMarkdown('# not a heading\n- not a list\n1. nor this\n<script>x</script>');
    expect(md).toBe('\\# not a heading\n\n\\- not a list\n\n1\\. nor this\n\n\\<script>x\\</script>\n');
    expect(normalizeMarkdown(md)).toBe(md);
  });

  it('is empty for blank input', () => {
    expect(plainTextToMarkdown('  \n\n')).toBe('');
  });
});
