import { describe, expect, it } from 'vitest';
import { documentSchema } from '../../shared/markdown/schema';
import { findMatches } from './findHighlight';

const text = (t: string, marks?: string[]) => ({ type: 'text', text: t, ...(marks ? { marks: marks.map(type => ({ type })) } : {}) });
const para = (...content: object[]) => ({ type: 'paragraph', content });
const doc = (...content: object[]) => documentSchema().nodeFromJSON({ type: 'doc', content });
const found = (d: ReturnType<typeof doc>, q: string) => findMatches(d, q).map(m => d.textBetween(m.from, m.to));

describe('findMatches', () => {
  it('finds every occurrence, ignoring case', () => {
    const d = doc(para(text('The cat and the hat')), para(text('THE end')));
    expect(found(d, 'the')).toEqual(['The', 'the', 'THE']);
  });

  it('finds a phrase that is partly bold or partly a link', () => {
    const d = doc(para(text('read the '), text('docs', ['bold']), text(' site')));
    expect(found(d, 'the docs site')).toEqual(['the docs site']);
  });

  it('does not run a match from one paragraph into the next, or across a line break', () => {
    const d = doc(para(text('end of one')), para(text('start of two')));
    expect(findMatches(d, 'onestart')).toEqual([]);
    const br = doc(para(text('left'), { type: 'hardBreak' }, text('right')));
    expect(findMatches(br, 'leftright')).toEqual([]);
    expect(found(br, 'right')).toEqual(['right']);
  });

  it('takes regex characters literally and finds nothing for a blank query', () => {
    const d = doc(para(text('cost (a+b) is $5.00')));
    expect(found(d, '(a+b)')).toEqual(['(a+b)']);
    expect(found(d, '$5.00')).toEqual(['$5.00']);
    expect(findMatches(d, '   ')).toEqual([]);
  });

  it('searches headings and code blocks too', () => {
    const d = doc({ type: 'heading', attrs: { level: 1 }, content: [text('Plan')] }, { type: 'codeBlock', content: [text('const plan = 1')] });
    expect(found(d, 'plan')).toEqual(['Plan', 'plan']);
  });
});
