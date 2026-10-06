import { describe, it, expect } from 'vitest';
import { parseWikilinkText, findHeadingIndex, normalizeHeading, headingLinkText, linkLabel } from './wikilink';

describe('parseWikilinkText', () => {
  it('reads a plain link, with or without .md', () => {
    expect(parseWikilinkText('[[Plan]]')).toEqual({ embed: false, target: 'Plan' });
    expect(parseWikilinkText('[[Work/Plan.md]]')).toEqual({ embed: false, target: 'Work/Plan' });
  });

  it('reads a heading, a block, an alias and an embed', () => {
    expect(parseWikilinkText('[[Plan#Risks]]')).toEqual({ embed: false, target: 'Plan', heading: 'Risks' });
    expect(parseWikilinkText('[[Plan#^abc-1]]')).toEqual({ embed: false, target: 'Plan', block: 'abc-1' });
    expect(parseWikilinkText('[[Plan#Risks|the risks]]')).toEqual({ embed: false, target: 'Plan', heading: 'Risks', alias: 'the risks' });
    expect(parseWikilinkText('![[Plan#Risks]]')).toEqual({ embed: true, target: 'Plan', heading: 'Risks' });
  });

  it('keeps a nested heading path whole, and reads a link inside the same note', () => {
    expect(parseWikilinkText('[[Plan#Q1#Risks]]')?.heading).toBe('Q1#Risks');
    expect(parseWikilinkText('[[#Risks]]')).toEqual({ embed: false, target: '', heading: 'Risks' });
  });

  it('is not fooled by what is not a link', () => {
    expect(parseWikilinkText('Plan')).toBeNull();
    expect(parseWikilinkText('[[]]')).toBeNull();
    expect(parseWikilinkText('[[a]] and [[b]]')).toBeNull();
    expect(parseWikilinkText('[[Plan#^]]')).toEqual({ embed: false, target: 'Plan' });
  });
});

describe('findHeadingIndex', () => {
  const headings = [
    { text: 'Intro' }, { text: 'Q1' }, { text: 'Risks' }, { text: 'Q2' }, { text: 'Risks' }, { text: '**Bold** idea' },
  ];

  it('matches without caring about case, spacing or emphasis', () => {
    expect(findHeadingIndex(headings, 'intro')).toBe(0);
    expect(findHeadingIndex(headings, '  bold   IDEA ')).toBe(5);
  });

  it('takes the first of two headings alike', () => {
    expect(findHeadingIndex(headings, 'Risks')).toBe(2);
  });

  it('A#B is the B under the A', () => {
    expect(findHeadingIndex(headings, 'Q2#Risks')).toBe(4);
    expect(findHeadingIndex(headings, 'Q1#Risks')).toBe(2);
    expect(findHeadingIndex(headings, 'Nope#Risks')).toBe(2); // no such parent: any B
  });

  it('finds nothing for a heading that is not there', () => {
    expect(findHeadingIndex(headings, 'Missing')).toBe(-1);
    expect(findHeadingIndex(headings, '')).toBe(-1);
  });
});

describe('heading text in a link', () => {
  it('replaces what a link cannot hold with a space', () => {
    expect(headingLinkText('Plan: a [draft] #1 | ^x')).toBe('Plan: a draft 1 x');
    expect(normalizeHeading('Plan: a [draft]')).toBe('plan a draft');
  });

  it('writes the page text of a heading that has Markdown in it', () => {
    expect(headingLinkText('Risks and *limits* of `code` and [a site](https://x.y)')).toBe('Risks and limits of code and a site');
  });
});

describe('linkLabel', () => {
  it('shows the alias, else the note with its heading or block', () => {
    expect(linkLabel('[[Home]]')).toBe('Home');
    expect(linkLabel('[[Home|my home]]')).toBe('my home');
    expect(linkLabel('[[Home#Setup]]')).toBe('Home › Setup');
    expect(linkLabel('[[Home#^id]]')).toBe('Home › ^id');
    expect(linkLabel('not a link')).toBe('not a link');
  });
});
