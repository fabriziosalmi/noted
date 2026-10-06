// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { documentSchema } from './schema';
import { createMarkdownParser } from './parser';
import { serializerEntries } from './serializer';

// The guard that makes the schema safe to extend: every node and mark the document model can hold must
// be written by the serializer and produced by the parser. Adding a TipTap extension without teaching the
// codec about it fails here, instead of losing data on the next save.
describe('codec covers the whole schema', () => {
  const schema = documentSchema();
  const nodeNames = Object.keys(schema.nodes);
  const markNames = Object.keys(schema.marks);
  // The document root and text are structure, not content with a Markdown form of their own.
  const structural = new Set(['doc', 'text']);

  it('serializes every node type', () => {
    const written = new Set(serializerEntries().nodes);
    const missing = nodeNames.filter((n) => !structural.has(n) && !written.has(n));
    expect(missing, `nodes with no serializer entry: ${missing.join(', ')}`).toEqual([]);
  });

  it('serializes every mark type', () => {
    const written = new Set(serializerEntries().marks);
    const missing = markNames.filter((n) => !written.has(n));
    expect(missing, `marks with no serializer entry: ${missing.join(', ')}`).toEqual([]);
  });

  it('parses into every node and mark type', () => {
    const parser = createMarkdownParser(schema) as unknown as { tokens: Record<string, { node?: string; block?: string; mark?: string }> };
    const produced = new Set(Object.values(parser.tokens).flatMap((s) => [s.node, s.block, s.mark].filter(Boolean) as string[]));
    const missing = [...nodeNames, ...markNames].filter((n) => !structural.has(n) && !produced.has(n));
    expect(missing, `schema entries no Markdown token produces: ${missing.join(', ')}`).toEqual([]);
  });

  it('the serializer writes nothing the schema does not have', () => {
    const { nodes, marks } = serializerEntries();
    expect(nodes.filter((n) => !(n in schema.nodes))).toEqual([]);
    expect(marks.filter((m) => !(m in schema.marks))).toEqual([]);
  });
});
