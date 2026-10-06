import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Table } from '@tiptap/extension-table';
import { Link } from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import { documentExtensions, documentSchema, withCodeInfo } from '../../shared/markdown/schema';
import { WikilinkMark } from './WikilinkExtension';

// The editor adds editor-only behaviour (a node view, click handling, a translated tooltip) to a few of the
// document model's extensions. If one of those overrides ever changed the shape of a node or mark, a Markdown note
// would load into the editor differently from how the codec describes it. This fails first.
describe('the editor uses the codec\'s document model', () => {
  const editorSchema = getSchema(documentExtensions({
    codeBlock: withCodeInfo(CodeBlockLowlight.configure({ lowlight: createLowlight(common) })),
    table: Table.configure({ resizable: true }),
    link: Link.configure({ openOnClick: true, autolink: true }),
    wikilink: WikilinkMark,
  }));
  const shape = (schema: ReturnType<typeof documentSchema>) => ({
    nodes: Object.fromEntries(Object.entries(schema.nodes).map(([name, type]) => [name, Object.keys(type.spec.attrs ?? {}).sort()])),
    marks: Object.fromEntries(Object.entries(schema.marks).map(([name, type]) => [name, Object.keys(type.spec.attrs ?? {}).sort()])),
  });

  it('has the same nodes and marks with the same attributes', () => {
    expect(shape(editorSchema)).toEqual(shape(documentSchema()));
  });

  it('has the same content rules', () => {
    const rules = (schema: ReturnType<typeof documentSchema>) => Object.fromEntries(Object.entries(schema.nodes).map(([n, t]) => [n, t.spec.content ?? '']));
    expect(rules(editorSchema)).toEqual(rules(documentSchema()));
  });
});
