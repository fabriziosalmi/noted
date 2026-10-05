// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { rewriteWikilinks } from './links';
import { parseWikilinks } from './extract';

const R = (from: string, to: string) => ({ from, to });

describe('rewriteWikilinks', () => {
  it('rewrites every link form and keeps alias and heading', () => {
    const raw = '<p>[[Old]] [[Old|the alias]] [[Old#Setup]] [[Old#Setup|both]] [[Old.md]]</p>';
    const out = rewriteWikilinks(raw, [R('Old.md', 'New name.md')]);
    expect(out.changed).toBe(5);
    expect(out.content).toBe('<p>[[New name]] [[New name|the alias]] [[New name#Setup]] [[New name#Setup|both]] [[New name]]</p>');
  });

  it('matches case-insensitively, and by full folder path only', () => {
    const raw = '[[old]] [[OLD]] [[Work/Old]] [[Other/Old]] [[Older]] [[Old 2]]';
    const out = rewriteWikilinks(raw, [R('Old.md', 'New.md')]);
    expect(out.content).toBe('[[New]] [[New]] [[Work/Old]] [[Other/Old]] [[Older]] [[Old 2]]');
    expect(out.changed).toBe(2);
  });

  it('handles folders in either name (a move between folders)', () => {
    const out = rewriteWikilinks('[[Work/Plan]] [[Work/Plan|p]]', [R('Work/Plan.md', 'Archive/Plan.md')]);
    expect(out.content).toBe('[[Archive/Plan]] [[Archive/Plan|p]]');
  });

  it('rewrites the editor\'s persisted form: the visible text AND the data-wikilink attribute', () => {
    const raw = '<p>see <span data-wikilink="Old" class="wikilink" role="link">[[Old]]</span> now</p>';
    const out = rewriteWikilinks(raw, [R('Old.md', 'New.md')]);
    expect(out.content).toBe('<p>see <span data-wikilink="New" class="wikilink" role="link">[[New]]</span> now</p>');
    expect(out.changed).toBe(1); // one link, however many places store it
  });

  it('escapes the new name for HTML and reads escaped old names', () => {
    const raw = '<span data-wikilink="Q&amp;A" class="wikilink">[[Q&amp;A]]</span>';
    const out = rewriteWikilinks(raw, [R('Q&A.md', 'Tom & "Jerry" <b>.md')]);
    expect(out.content).toBe('<span data-wikilink="Tom &amp; &quot;Jerry&quot; &lt;b&gt;" class="wikilink">[[Tom &amp; "Jerry" &lt;b&gt;]]</span>');
    // and it parses back to the new name
    expect(parseWikilinks(out.content).map(l => l.target)).toEqual(['Tom & "Jerry" <b>']);
  });

  it('applies several renames at once without chaining them', () => {
    const out = rewriteWikilinks('[[A]] [[B]] [[C]]', [R('A.md', 'B.md'), R('B.md', 'C.md')]);
    expect(out.content).toBe('[[B]] [[C]] [[C]]'); // A->B, B->C; the new B is not renamed again
    expect(out.changed).toBe(2);
  });

  it('leaves unrelated text, other links and the rest of the document untouched', () => {
    const raw = '<h1>Title</h1><p>text [[Keep]] and [not a link] and #tag</p><a href="#Old">anchor</a>';
    const out = rewriteWikilinks(raw, [R('Old.md', 'New.md')]);
    expect(out.content).toBe(raw);
    expect(out.changed).toBe(0);
  });

  it('returns the input unchanged for no renames', () => {
    expect(rewriteWikilinks('[[A]]', [])).toEqual({ content: '[[A]]', changed: 0 });
  });

  it('ignores links that point at no note ([[#Heading]], [[|x]])', () => {
    const raw = '[[#Setup]] [[|x]]';
    expect(rewriteWikilinks(raw, [R('Old.md', 'New.md')]).content).toBe(raw);
  });

  it('is idempotent: running it again changes nothing', () => {
    const once = rewriteWikilinks('[[Old|a]] [[Old#h]]', [R('Old.md', 'New.md')]).content;
    expect(rewriteWikilinks(once, [R('Old.md', 'New.md')])).toEqual({ content: once, changed: 0 });
  });

  it('after rewriting, no link to the old name remains and links to the new one exist', () => {
    const raw = '<p>[[Old]] [[old|x]] [[Old#a]]</p>';
    const { content } = rewriteWikilinks(raw, [R('Old.md', 'New.md')]);
    const targets = parseWikilinks(content).map(l => l.target);
    expect(targets).toEqual(['New', 'New', 'New']);
  });
});
