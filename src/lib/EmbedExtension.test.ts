// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { findEmbeds } from './EmbedExtension';

const schema = getSchema([StarterKit]);
const p = (...content: object[]) => ({ type: 'paragraph', content });
const t = (text: string, marks?: object[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const doc = (...content: object[]) => schema.nodeFromJSON({ type: 'doc', content });

describe('findEmbeds', () => {
  it('finds each embed, at the end of the block that holds it', () => {
    const d = doc(p(t('see ![[Plan#Risks]] and ![[a.png|200]] now')), p(t('plain [[link]]')));
    const sites = findEmbeds(d);
    expect(sites.map(s => s.literal)).toEqual(['![[Plan#Risks]]', '![[a.png|200]]']);
    expect(sites.map(s => s.parts.target)).toEqual(['Plan', 'a.png']);
    expect(sites[0].pos).toBe(1 + 'see ![[Plan#Risks]] and ![[a.png|200]] now'.length);
    expect(sites[0].pos).toBe(sites[1].pos);
  });

  it('sees an embed whose "!" and link are marked differently', () => {
    const link = [{ type: 'bold' }];
    expect(findEmbeds(doc(p(t('!'), t('[[Plan]]', link)))).map(s => s.literal)).toEqual(['![[Plan]]']);
  });

  it('is not fooled by an inline node before it', () => {
    const d = doc(p(t('a'), { type: 'hardBreak' }, t('![[Plan]]')));
    expect(findEmbeds(d)[0].pos).toBe(d.content.size - 1);
  });

  it('leaves code alone, and a link inside the same note has nothing to embed', () => {
    expect(findEmbeds(doc({ type: 'codeBlock', content: [t('![[Plan]]')] }))).toEqual([]);
    expect(findEmbeds(doc(p(t('![[#Heading]]'))))).toEqual([]);
  });
});
