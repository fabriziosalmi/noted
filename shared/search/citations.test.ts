import { describe, it, expect } from 'vitest';
import { citationNumbers, citationOfHref, linkCitations, readCitations, sourceLabel, sourcesBlock, stripCitations, supports, type Source } from './citations';
import { STOPWORDS } from './stopwords';

const src = (n: number, over: Partial<Source> = {}): Source => ({ n, name: `N${n}.md`, title: `Note ${n}`, headingPath: [`Part ${n}`], text: `text ${n}`, ...over });

describe('sourcesBlock', () => {
  it('numbers the sources and says where each is from', () => {
    expect(sourcesBlock([src(1), src(2, { headingPath: [] })])).toBe('[1] Note 1 › Part 1\ntext 1\n\n---\n\n[2] Note 2\ntext 2');
    expect(sourceLabel(src(3, { headingPath: ['A', 'B'] }))).toBe('Note 3 › A › B');
    expect(sourcesBlock([])).toBe('');
  });
});

describe('readCitations', () => {
  it('lists the sources cited, once each, in order of first appearance', () => {
    const r = readCitations('Yes [2]. Also [1] and again [2], then [1, 3].', 3);
    expect(r.cited).toEqual([2, 1, 3]);
    expect(r.invalid).toEqual([]);
    expect(r.text).toBe('Yes [2]. Also [1] and again [2], then [1, 3].');
  });

  it('removes a marker for a source that does not exist, keeps the valid ones in a group, and reports them', () => {
    const r = readCitations('One [1]. Two [7]. Three [2, 9]. Zero [0].', 2);
    expect(r.text).toBe('One [1]. Two. Three [2]. Zero.');
    expect(r.cited).toEqual([1, 2]);
    expect(r.invalid).toEqual([7, 9, 0]);
  });

  it('with no sources every marker is invalid', () => {
    expect(readCitations('Claim [1].', 0)).toMatchObject({ text: 'Claim.', cited: [], invalid: [1] });
  });

  it('leaves what is not a citation alone: links, words in brackets, years, placeholders', () => {
    const text = 'See [the docs](http://x.y), [note], [2024 plan], [EMAIL_1] and [123] and arr[i].';
    expect(readCitations(text, 5)).toEqual({ text, cited: [], invalid: [] });
  });

  it('handles adjacent markers and a marker at the start', () => {
    expect(readCitations('[1][2] both say so.', 2).cited).toEqual([1, 2]);
    expect(readCitations('Claim [1][5].', 2).text).toBe('Claim [1].');
  });
});

describe('stripCitations and citationNumbers', () => {
  it('an earlier answer loses its markers, and the space before punctuation they leave', () => {
    expect(stripCitations('It is due Friday [1]. The rest [2, 3] is open.')).toBe('It is due Friday. The rest is open.');
    expect(stripCitations('plain')).toBe('plain');
  });
  it('reads the numbers of a marker', () => {
    expect(citationNumbers('[1]')).toEqual([1]);
    expect(citationNumbers('[1, 12]')).toEqual([1, 12]);
    expect(citationNumbers('[a]')).toEqual([]);
    expect(citationNumbers('1')).toEqual([]);
  });
});

describe('supports', () => {
  it('a section is evidence when it shares the question\'s words, or is close in meaning', () => {
    expect(supports({ coverage: 1, similarity: null })).toBe(true);
    expect(supports({ coverage: 0.5, similarity: null })).toBe(true);
    expect(supports({ coverage: 0.2, similarity: null })).toBe(false);
    expect(supports({ coverage: 0, similarity: 0.45 })).toBe(true);
    expect(supports({ coverage: 0, similarity: 0.1 })).toBe(false);
  });
});

describe('STOPWORDS', () => {
  it('has the function words of the app\'s languages, and not the words that carry a question', () => {
    for (const w of ['the', 'is', 'of', 'che', 'della', 'el', 'qué', 'les', 'und', 'não']) expect(STOPWORDS.has(w)).toBe(true);
    for (const w of ['france', 'capital', 'oil', 'dog', 'ottobre']) expect(STOPWORDS.has(w)).toBe(false);
  });
});

describe('linkCitations', () => {
  const sources = [src(1), src(2, { headingPath: ['A', 'B'] })];
  it('turns each marker into a link to its source, with where it is from as the title', () => {
    expect(linkCitations('Yes [1]. And [2].', sources)).toBe('Yes [1](#cite-1 "Note 1 › Part 1"). And [2](#cite-2 "Note 2 › A › B").');
    expect(linkCitations('Both [1, 2].', sources)).toBe('Both [1](#cite-1 "Note 1 › Part 1")[2](#cite-2 "Note 2 › A › B").');
  });
  it('leaves code and what is no source alone', () => {
    expect(linkCitations('inline `a[1]` and [1]', sources)).toBe('inline `a[1]` and [1](#cite-1 "Note 1 › Part 1")');
    expect(linkCitations('```\nx[1]\n```\nthen [2]', sources)).toBe('```\nx[1]\n```\nthen [2](#cite-2 "Note 2 › A › B")');
    expect(linkCitations('unfinished ```\nx[1]', sources)).toBe('unfinished ```\nx[1]');
    expect(linkCitations('Nine [9].', sources)).toBe('Nine [9].');
  });
  it('a quote in a title cannot break the link', () => {
    expect(linkCitations('x [1]', [src(1, { title: 'The "plan"' })])).toBe('x [1](#cite-1 "The \'plan\' › Part 1")');
  });
  it('reads the number back from the link', () => {
    expect(citationOfHref('#cite-3')).toBe(3);
    expect(citationOfHref('#cite-')).toBeNull();
    expect(citationOfHref('https://x.y/#cite-3')).toBeNull();
    expect(citationOfHref(null)).toBeNull();
  });
});
