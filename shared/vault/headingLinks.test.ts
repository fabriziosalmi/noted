import { describe, it, expect } from 'vitest';
import { buildLinkResolver } from './resolve';
import { rewriteHeadingLinks, type HeadingRewritePlan } from './headingLinks';

const resolver = buildLinkResolver(['Plan.md', 'Work/Other.md', 'Home.md'], { 'Home.md': ['Start'] });
const plan = (renames: HeadingRewritePlan['renames'], note = 'Plan.md', oldHeadings = ['Plan', 'Risks', 'Budget', 'Risks']): HeadingRewritePlan => ({
  note, oldHeadings, renames, resolver,
});

describe('rewriteHeadingLinks', () => {
  it('moves the links to a renamed heading, keeping alias and the rest of the text', () => {
    const raw = 'see [[Plan#Risks]] and [[Plan#risks|the risks]] and [[Plan.md#Risks]] and ![[Plan#Risks]] ok';
    const out = rewriteHeadingLinks(raw, plan([{ index: 1, to: 'Threats' }]));
    expect(out.content).toBe('see [[Plan#Threats]] and [[Plan#Threats|the risks]] and [[Plan.md#Threats]] and ![[Plan#Threats]] ok');
    expect(out.changed).toBe(4);
  });

  it('follows an alias of the note, and a link in another folder resolved by name', () => {
    const resolve = buildLinkResolver(['Home.md', 'Work/Plan.md'], { 'Home.md': ['Start'] });
    const raw = '[[Start#Welcome]] [[Plan#Welcome]]';
    expect(rewriteHeadingLinks(raw, { note: 'Home.md', oldHeadings: ['Welcome'], renames: [{ index: 0, to: 'Hello' }], resolver: resolve }).content)
      .toBe('[[Start#Hello]] [[Plan#Welcome]]');
  });

  it('leaves links to other notes, other headings, blocks and plain links alone', () => {
    const raw = '[[Other#Risks]] [[Plan#Budget]] [[Plan#^Risks]] [[Plan]] [[Work/Other#Risks]]';
    const out = rewriteHeadingLinks(raw, plan([{ index: 1, to: 'Threats' }]));
    expect(out.content).toBe(raw);
    expect(out.changed).toBe(0);
  });

  it('writes a heading as a link can hold it', () => {
    expect(rewriteHeadingLinks('[[Plan#Budget]]', plan([{ index: 2, to: 'Costs: [Q1] #2 | ^x' }])).content).toBe('[[Plan#Costs: Q1 2 x]]');
  });

  it('follows a heading path', () => {
    expect(rewriteHeadingLinks('[[Plan#Budget#Risks]]', plan([{ index: 2, to: 'Costs' }])).content).toBe('[[Plan#Costs#Risks]]');
  });

  it('with two headings alike, only the first one takes the links with it', () => {
    const raw = '[[Plan#Risks]]';
    expect(rewriteHeadingLinks(raw, plan([{ index: 3, to: 'Other risks' }])).content).toBe(raw);
    expect(rewriteHeadingLinks(raw, plan([{ index: 1, to: 'Threats' }])).content).toBe('[[Plan#Threats]]');
  });

  it('is exact on HTML notes, where the text is entity-escaped', () => {
    const raw = '<p><span data-wikilink="Plan">[[Plan#Q&amp;A|why &lt;this&gt;]]</span></p>';
    const out = rewriteHeadingLinks(raw, plan([{ index: 0, to: 'Questions & answers' }], 'Plan.md', ['Q&A']));
    expect(out.content).toBe('<p><span data-wikilink="Plan">[[Plan#Questions &amp; answers|why &lt;this&gt;]]</span></p>');
  });

  it('does nothing without renames', () => {
    expect(rewriteHeadingLinks('[[Plan#Risks]]', plan([]))).toEqual({ content: '[[Plan#Risks]]', changed: 0 });
  });
});
