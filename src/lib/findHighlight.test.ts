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

  it('matches case only when asked to', () => {
    const d = doc(para(text('Plan, plan and PLAN')));
    expect(found(d, 'plan')).toEqual(['Plan', 'plan', 'PLAN']);
    expect(findMatches(d, 'plan', true).map(m => d.textBetween(m.from, m.to))).toEqual(['plan']);
  });

  it('treats regex characters literally when useRegex is absent or false', () => {
    const d = doc(para(text('cost (a+b) is $5.00')));
    expect(found(d, '(a+b)')).toEqual(['(a+b)']);
    expect(findMatches(d, '(a+b)', false, false).map(m => d.textBetween(m.from, m.to))).toEqual(['(a+b)']);
  });

  it('matches a regex when useRegex is true', () => {
    const d = doc(para(text('cat 42 cot 7 cut')));
    expect(findMatches(d, 'c[a-z]t', false, true).map(m => d.textBetween(m.from, m.to))).toEqual(['cat', 'cot', 'cut']);
    expect(findMatches(d, '\\d+', false, true).map(m => d.textBetween(m.from, m.to))).toEqual(['42', '7']);
  });

  it('respects caseSensitive together with useRegex', () => {
    const d = doc(para(text('Plan and plan')));
    expect(findMatches(d, 'plan', true, true).map(m => d.textBetween(m.from, m.to))).toEqual(['plan']);
  });

  it('falls back to literal matching for invalid regex syntax without throwing', () => {
    const d = doc(para(text('a (b [c')));
    expect(() => findMatches(d, '(b', false, true)).not.toThrow();
    expect(findMatches(d, '(', false, true).map(m => d.textBetween(m.from, m.to))).toEqual(['(']);
  });

  it('does not loop forever on zero-length matches', () => {
    const d = doc(para(text('ba')));
    expect(findMatches(d, 'x*', false, true)).toEqual([]); // a pattern that only matches empty strings yields no spans
    // a pattern with both a real match and zero-length matches terminates and keeps the real one
    expect(findMatches(d, 'a*', false, true).map(m => d.textBetween(m.from, m.to))).toEqual(['a']);
  });
});
