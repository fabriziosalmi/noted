// Generators for the property tests of the Markdown codec and of the HTML wire format. Test support only:
// nothing in the app imports this file.
import fc from 'fast-check';
import { documentSchema } from './schema';

export const schema = documentSchema();
// FC_RUNS=5000 npx vitest run shared/markdown/roundtrip.property.test.ts digs deeper than the default
export const RUNS = Number(process.env.FC_RUNS ?? 400);

// Characters that are syntax somewhere in Markdown or in our extensions, plus plain ones.
export const ALPHABET = ['a', 'b', 'Z', '7', ' ', ' ', '*', '_', '~', '`', '[', ']', '(', ')', '<', '>', '&', '#', '!', '|', '\\', '$', '=', '%', ':', '-', '+', '.', '"', "'", '{', '}', '/', '^', ';'];

/** Text that does not begin or end with a space (Markdown trims those) and has no line break. */
const word = fc
  .array(fc.constantFrom(...ALPHABET), { minLength: 1, maxLength: 10 })
  .map((cs) => cs.join('').trim())
  .filter((s) => s.length > 0);

const text = (value: string, marks: string[] = []) => ({ type: 'text', text: value, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });

/** Inline content: runs of words joined by single spaces, some with simple marks. */
const MARKS = ['bold', 'italic', 'strike', 'highlight'];
const inline = fc
  .array(
    fc.record({ value: word, mark: fc.option(fc.constantFrom(...MARKS), { nil: undefined }) }),
    { minLength: 1, maxLength: 4 },
  )
  .map((parts) => {
    const out: ReturnType<typeof text>[] = [];
    parts.forEach((p, i) => {
      // marked runs need a word on each side to be unambiguous; a plain separator run carries the space
      if (i > 0) out.push(text(' '));
      out.push(text(p.value, p.mark ? [p.mark] : []));
    });
    return out;
  });

const paragraph = inline.map((content) => ({ type: 'paragraph', content }));
const heading = fc.tuple(fc.integer({ min: 1, max: 6 }), inline).map(([level, content]) => ({ type: 'heading', attrs: { level }, content }));
const codeBlock = fc
  .tuple(fc.option(fc.constantFrom('js', 'py', 'sh'), { nil: null }), fc.array(fc.string({ unit: fc.constantFrom('a', ' ', '`', '~', '\n', 'x'), maxLength: 12 }), { minLength: 1, maxLength: 3 }))
  .map(([language, lines]) => ({ type: 'codeBlock', attrs: { language }, content: [text(lines.join('\n').replace(/^\n+|\n+$/g, '') || 'x')] }));

const leaf = fc.oneof({ weight: 6, arbitrary: paragraph }, { weight: 2, arbitrary: heading }, { weight: 1, arbitrary: codeBlock });

// A list item starts with a paragraph (the schema says so); it may be followed by more blocks.
const item = (more: fc.Arbitrary<object>) =>
  fc.tuple(paragraph, fc.option(more, { nil: undefined })).map(([p, extra]) => ({ type: 'listItem', content: extra ? [p, extra] : [p] }));

const listOf = (kind: 'bulletList' | 'orderedList', more: fc.Arbitrary<object>) =>
  fc
    .tuple(fc.boolean(), fc.array(item(more), { minLength: 1, maxLength: 3 }))
    .map(([wantTight, items]) => ({
      type: kind,
      // Tightness follows the content: a list with a multi-block item is loose, and a lone one-paragraph item is tight.
      attrs: { tight: items.every((i) => i.content.length === 1) && (wantTight || items.length === 1), ...(kind === 'orderedList' ? { start: 1 } : {}) },
      content: items,
    }));

const tasks = fc
  .array(fc.tuple(fc.boolean(), paragraph), { minLength: 1, maxLength: 3 })
  .map((items) => ({ type: 'taskList', attrs: { tight: true }, content: items.map(([checked, p]) => ({ type: 'taskItem', attrs: { checked }, content: [p] })) }));

const quote = (block: fc.Arbitrary<object>) => fc.array(block, { minLength: 1, maxLength: 2 }).map((content) => ({ type: 'blockquote', content }));

const block: fc.Arbitrary<object> = fc.letrec((tie) => ({
  tree: fc.oneof(
    { weight: 6, arbitrary: leaf },
    { weight: 2, arbitrary: listOf('bulletList', leaf) },
    { weight: 1, arbitrary: listOf('orderedList', leaf) },
    { weight: 1, arbitrary: tasks },
    { weight: 1, arbitrary: quote(leaf) },
    { weight: 1, arbitrary: quote(tie('tree') as fc.Arbitrary<object>) },
  ),
})).tree;

export const documentArb = fc.array(block, { minLength: 1, maxLength: 5 }).map((content) => {
  const doc = schema.nodeFromJSON({ type: 'doc', content });
  doc.check(); // the generator itself must only build documents the schema allows
  return doc;
});

