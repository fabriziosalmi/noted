// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { anchorPosition } from './anchors';

const schema = getSchema([StarterKit]);
const doc = schema.nodeFromJSON({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Plan' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'A claim worth citing ^claim-1' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Risks' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'not ^this-one but text' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'an item ^item.2' }] }] }] },
  ],
});
const textAt = (pos: number | null): string | undefined => (pos === null ? undefined : doc.nodeAt(pos)?.textContent);

describe('anchorPosition', () => {
  it('finds a heading by its text', () => {
    expect(textAt(anchorPosition(doc, { heading: 'risks' }))).toBe('Risks');
  });

  it('finds a block by the id that ends its text, also inside a list', () => {
    expect(textAt(anchorPosition(doc, { block: 'claim-1' }))).toBe('A claim worth citing ^claim-1');
    expect(textAt(anchorPosition(doc, { block: 'item.2' }))).toBe('an item ^item.2');
  });

  it('does not take an id in the middle of a sentence, or one that is not there', () => {
    expect(anchorPosition(doc, { block: 'this-one' })).toBeNull();
    expect(anchorPosition(doc, { block: 'nope' })).toBeNull();
    expect(anchorPosition(doc, { heading: 'Missing' })).toBeNull();
    expect(anchorPosition(doc, {})).toBeNull();
  });
});
