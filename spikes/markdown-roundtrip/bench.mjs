// Rough cost of a full parse + serialize for a large note (the editor does this on load and per autosave).
import { CORPUS } from './corpus.mjs';
import { PIPELINES as BASE, customEditor } from './pipelines.mjs';
import { pmMarkdown } from './pm-markdown.mjs';

const body = CORPUS.filter((c) => c.cat !== 'doc').map((c) => c.md).join('\n\n');
for (const reps of [10, 100]) {
  const doc = Array.from({ length: reps }, () => body).join('\n\n');
  // text -> ProseMirror JSON/doc -> text, without loading the document into a live editor
  const tiptapPure = { name: 'tiptap-md (pure)', roundTrip: (t) => customEditor.markdown.serialize(customEditor.markdown.parse(t)) };
  const pmPure = { name: 'prosemirror-md', roundTrip: (t) => pmMarkdown.roundTrip(t) };
  const tiptapFull = BASE.find((x) => x.name === 'tiptap-custom');
  for (const p of [tiptapPure, tiptapFull, pmPure]) {
    p.roundTrip(doc); // warm up
    const t0 = performance.now();
    p.roundTrip(doc);
    console.log(`${p.name.padEnd(17)} ${(doc.length / 1024).toFixed(0).padStart(5)} KB  ${(performance.now() - t0).toFixed(0).padStart(5)} ms`);
  }
}
