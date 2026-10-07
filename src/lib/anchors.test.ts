// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { anchorPosition, passageRange } from './anchors';

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

describe('passageRange', () => {
  const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
  const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const li = (text: string) => ({ type: 'listItem', content: [p(text)] });
  const note = schema.nodeFromJSON({
    type: 'doc',
    content: [
      p('Preamble before any heading.'),
      h(1, 'Plan'),
      p('Intro of the plan.'),
      h(2, 'Goals'),
      p('Ship the first release in October.'),
      { type: 'bulletList', content: [li('write the docs'), { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'test ' }, { type: 'text', text: 'it', marks: [{ type: 'bold' }] }, { type: 'text', text: ' twice' }] }] }] },
      p('Then announce it.'),
      h(2, 'Risks'),
      p('Ship the first release in October, said the risks section too.'),
      h(3, 'People'),
      p('Holiday season hits in August.'),
      h(2, 'Goals'),
      p('A second Goals heading with other words.'),
    ],
  });
  const text = (r: { from: number; to: number } | null) => (r ? note.textBetween(r.from, r.to, ' | ') : null);

  it('finds the blocks a passage runs through, under its heading, even when the quoted text lost its markup', () => {
    const r = passageRange(note, { heading: 'Goals', passage: 'Ship the first release in October.\nwrite the docs test it twice\nThen announce it.' });
    expect(text(r)).toBe('Ship the first release in October. | write the docs | test it twice | Then announce it.');
  });

  it('a passage that is one block marks that block, and matches in spite of case and punctuation', () => {
    expect(text(passageRange(note, { heading: 'Plan#Goals', passage: 'ship the FIRST release, in october' }))).toBe('Ship the first release in October.');
  });

  it('looks only inside the section: the same words under another heading are not what was cited', () => {
    expect(text(passageRange(note, { heading: 'Risks', passage: 'Ship the first release in October' }))).toBe('Ship the first release in October, said the risks section too.');
    expect(passageRange(note, { heading: 'People', passage: 'Ship the first release in October' })).toBeNull();
  });

  it('a section runs to the next heading of its level or higher, so it includes its subsections', () => {
    expect(text(passageRange(note, { heading: 'Risks', passage: 'Holiday season hits in August' }))).toBe('Holiday season hits in August.');
  });

  it('with no heading it is the text before the first heading', () => {
    expect(text(passageRange(note, { passage: 'Preamble before any heading' }))).toBe('Preamble before any heading.');
    expect(passageRange(note, { passage: 'Intro of the plan' })).toBeNull();
  });

  it('is null when the heading or the passage is no longer in the note', () => {
    expect(passageRange(note, { heading: 'Gone', passage: 'Ship the first release in October' })).toBeNull();
    expect(passageRange(note, { heading: 'Goals', passage: 'completely different words about nothing at all' })).toBeNull();
    expect(passageRange(note, { heading: 'Goals', passage: '' })).toBeNull();
  });

  it('finds a passage by its first words when the note was edited further down', () => {
    expect(text(passageRange(note, { heading: 'Plan#Goals', passage: 'Ship the first release in October and then something that has since been rewritten entirely' }))).toBe('Ship the first release in October. | write the docs | test it twice | Then announce it.');
  });
});
