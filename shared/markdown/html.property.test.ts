// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Node as PMNode } from '@tiptap/pm/model';
import { docToHtml, htmlToDoc } from './html';
import { parseNote, serializeNote } from './codec';
import { GOLDEN } from './golden';
import { RUNS, documentArb, schema } from './test-arbitraries';

const env = { document, DOMParser };
const json = (n: PMNode): string => JSON.stringify(n.toJSON());

// While the editor is still fed HTML, a note read from Markdown goes document -> HTML -> editor and back
// editor -> HTML -> document -> Markdown. Nothing may be lost on that trip.
describe('document <-> HTML', () => {
  it('turns every generated document into HTML and back unchanged', () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        const html = docToHtml(doc, env);
        expect(json(htmlToDoc(html, schema, env)), `html was:\n${html}`).toBe(json(doc));
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it('keeps every golden note intact through HTML (callouts, raw blocks, loose lists, alignment, wikilinks, math)', () => {
    for (const [, id, markdown, expected] of GOLDEN) {
      const note = parseNote(markdown);
      const viaHtml = htmlToDoc(docToHtml(note.doc, env), schema, env);
      expect(serializeNote({ frontmatter: note.frontmatter, doc: viaHtml }), id).toBe(serializeNote(parseNote(expected ?? markdown)));
    }
  });
});
