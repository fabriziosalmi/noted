// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ALPHABET, RUNS, documentArb, withWikilinkMarks } from './test-arbitraries';
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseMarkdownBody } from './parser';
import { serializeMarkdownBody } from './serializer';
import { normalizeMarkdown } from './codec';

// Two guarantees, checked on generated input instead of hand-picked examples:
//
//  1. What we write, we read back as the same document (no escaping hole: nothing the user typed
//     turns into syntax, nothing is dropped).
//  2. Saving twice is the same as saving once (quiet diffs).
//
// A failing run prints the smallest counterexample fast-check can find.

const json = (n: PMNode): string => JSON.stringify(n.toJSON());

describe('Markdown round trip (generated documents)', () => {
  it('writes what it can read back as the same document', () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        const md = serializeMarkdownBody(doc);
        const back = parseMarkdownBody(md);
        expect(json(back), `markdown was:\n${md}`).toBe(json(withWikilinkMarks(doc)));
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it('is stable: saving a saved note changes nothing', () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        const once = normalizeMarkdown(serializeMarkdownBody(doc));
        expect(normalizeMarkdown(once)).toBe(once);
      }),
      { numRuns: RUNS },
    );
  }, 600_000);
});

describe('Markdown text (arbitrary input)', () => {
  const line = fc.array(fc.constantFrom(...ALPHABET, ' ', ' ', '\t', '\n', '\n'), { minLength: 0, maxLength: 60 }).map((cs) => cs.join(''));

  it('never throws, and one pass reaches a fixed point', () => {
    fc.assert(
      fc.property(line, (source) => {
        const once = normalizeMarkdown(source);
        expect(normalizeMarkdown(once)).toBe(once);
      }),
      { numRuns: RUNS * 4 },
    );
  }, 600_000);

  it('keeps every visible character the author typed (letters and digits only change place with the document)', () => {
    const letters = (s: string): string => s.replace(/[^A-Za-z0-9]/g, '');
    fc.assert(
      fc.property(line, (source) => {
        // front matter is kept byte for byte, and an entity ("&copy;", "&#7;") becomes its character and a link destination is percent-encoded ("%3E")
        fc.pre(!/^---/.test(source.trimStart()) && !source.includes('&') && !source.includes(']('));
        // raw html, footnote and link definitions are kept verbatim, so their letters are kept too
        expect(letters(normalizeMarkdown(source))).toBe(letters(source));
      }),
      { numRuns: RUNS * 4 },
    );
  }, 600_000);
});
