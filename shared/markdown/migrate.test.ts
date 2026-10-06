// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { Table } from '@tiptap/extension-table';
import { Link } from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import { documentExtensions, withCodeInfo } from './schema';
import { convertHtmlNote, convertMarkdownNoteToHtml, isLegacyHtml, readableVersions } from './migrate';
import { normalizeMarkdown, parseNote } from './codec';
import { GOLDEN } from './golden';
import { diskToWire } from '../../src/lib/noteIo';
import { extractHtmlFrontmatterComment, prependFrontmatterComment } from './frontmatter';

const env = { document, DOMParser };

/** The HTML the editor writes for a note: what a vault written by earlier versions contains. */
function legacyHtml(markdown: string): string {
  const { frontmatter, body } = extractHtmlFrontmatterComment(diskToWire(markdown, 'markdown'));
  const editor = new Editor({
    extensions: documentExtensions({
      codeBlock: withCodeInfo(CodeBlockLowlight.configure({ lowlight: createLowlight(common) })),
      table: Table.configure({ resizable: true }),
      link: Link.configure({ openOnClick: true, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }),
    }),
    content: body,
    parseOptions: { preserveWhitespace: 'full' },
  });
  const html = editor.getHTML();
  editor.destroy();
  return prependFrontmatterComment(html, frontmatter);
}

// Legacy HTML collapses whitespace (a line break inside a paragraph was a space), so golden cases that are
// about whitespace say nothing about HTML.
const WHITESPACE = new Set(['soft-break', 'tab-text', 'quote', 'quote-lazy', 'item-multiline', 'wikilink-spaces', 'wikilink-multiline', 'callout-title', 'callout-bad-kind', 'lt-line-start', 'deep-mix', 'footnote-continued', 'details']);

function hasRaw(md: string): boolean {
  let found = false;
  parseNote(md).doc.descendants((n) => { if (n.type.name === 'rawBlock' || n.type.name === 'rawInline') found = true; return !found; });
  return found;
}

describe('isLegacyHtml', () => {
  it('tells an HTML note from a Markdown one', () => {
    expect(isLegacyHtml('<h1>T</h1>')).toBe(true);
    expect(isLegacyHtml('﻿  <p>x</p>')).toBe(true);
    expect(isLegacyHtml('<!--noted-frontmatter:x--><p>x</p>')).toBe(true);
    expect(isLegacyHtml('# T')).toBe(false);
    expect(isLegacyHtml('---\na: 1\n---\n')).toBe(false);
    expect(isLegacyHtml('')).toBe(false);
  });
});

describe('convertHtmlNote', () => {
  // What earlier versions wrote for every kind of note must convert without losing anything.
  it.each(GOLDEN.filter((c) => !WHITESPACE.has(c[1]) && !hasRaw(c[2]) && (c[0] !== 'doc' || c[1].startsWith('fm-'))).map((c) => [`${c[0]}/${c[1]}`, c[2]] as const))('%s is converted exactly', (_id, markdown) => {
    const expected = normalizeMarkdown(markdown);
    if (!expected.trim()) return;
    const result = convertHtmlNote(legacyHtml(markdown), env);
    expect(result.text).toBe(expected);
    expect(result.findings, result.findings.join('; ')).toEqual([]);
    expect(result.verdict).toBe('exact');
  });

  it('keeps the frontmatter byte for byte', () => {
    const html = prependFrontmatterComment('<h1>T</h1><p>x</p>', '---\ntitle: T\n# kept comment\n---');
    expect(convertHtmlNote(html, env).text).toBe('---\ntitle: T\n# kept comment\n---\n\n# T\n\nx\n');
  });

  it('reads HTML whitespace the way the editor did', () => {
    expect(convertHtmlNote('<p>a   b\n c</p>', env).text).toBe('a b c\n');
  });

  it('is exact for an empty note', () => {
    expect(convertHtmlNote('', env)).toEqual({ text: '', verdict: 'exact', findings: [] });
    expect(convertHtmlNote('<p></p>', env).text).toBe('');
  });

  it('reports presentation it drops as formatting, and keeps every word', () => {
    const r = convertHtmlNote('<p>plain <span style="color:red">red</span> <b class="x">bold</b></p><table><tr><td colspan="2">wide</td></tr></table>', env);
    expect(r.verdict).toBe('formatting');
    expect(r.findings).toEqual(expect.arrayContaining(['inline styles dropped', 'custom classes dropped', 'merged table cells unmerged']));
    expect(r.text).toContain('red');
    expect(r.text).toContain('bold');
    expect(r.text).toContain('wide');
  });

  it('keeps what the editor cannot show as raw HTML, verbatim', () => {
    const r = convertHtmlNote('<p>E = mc<sup>2</sup></p><details><summary>More</summary><p>Hidden</p></details><iframe src="https://x.io/v"></iframe>', env);
    expect(r.verdict).toBe('raw');
    expect(r.findings).toEqual(expect.arrayContaining(['<sup> kept as raw HTML', '<details> kept as raw HTML', '<iframe> kept as raw HTML']));
    expect(r.text).toBe('E = mc<sup>2</sup>\n\n<details><summary>More</summary><p>Hidden</p></details>\n\n<iframe src="https://x.io/v"></iframe>\n');
    // and it reads back: the raw HTML is a raw block, not text
    expect(normalizeMarkdown(r.text)).toBe(r.text);
  });

  it('calls it lossy only when words are missing', () => {
    // a comment is not a word; text that vanishes would be
    expect(convertHtmlNote('<p>a</p><!-- note --><p>b</p>', env).verdict).toBe('exact');
  });

  it('does not mistake what the editor writes for something dropped', () => {
    const html = '<table style="min-width: 50px"><colgroup><col style="min-width: 25px"></colgroup><tbody><tr><td colspan="1" rowspan="1"><p>a</p></td></tr></tbody></table><pre><code class="language-js">x</code></pre>';
    expect(convertHtmlNote(html, env).verdict).toBe('exact');
  });
});

describe('convertMarkdownNoteToHtml (the way back)', () => {
  it('gives HTML with the frontmatter comment the app reads', () => {
    const html = convertMarkdownNoteToHtml('---\na: 1\n---\n\n# T\n\n**x**\n', env);
    expect(html).toMatch(/^<!--noted-frontmatter:/);
    expect(html).toContain('<h1>T</h1>');
    expect(html).toContain('<strong>x</strong>');
  });

  it('keeps raw HTML through the way back and forward again, without calling it lost text', () => {
    const markdown = 'E = mc<sup>2</sup>\n\n<details><summary>More</summary><p>Hidden</p></details>\n';
    const back = convertMarkdownNoteToHtml(markdown, env);
    const again = convertHtmlNote(back, env);
    expect(again.text).toBe(markdown);
    expect(again.verdict).not.toBe('lossy');
    expect(again.findings.filter((f) => f.startsWith('text differs'))).toEqual([]);
  });

  it('round-trips every golden note: Markdown -> HTML -> Markdown (soft line breaks become spaces on the way, as in HTML)', () => {
    for (const [, id, markdown] of GOLDEN) {
      if (WHITESPACE.has(id) || hasRaw(markdown)) continue;
      const expected = normalizeMarkdown(markdown);
      if (!expected.trim()) continue;
      expect(convertHtmlNote(convertMarkdownNoteToHtml(markdown, env), env).text, id).toBe(expected);
    }
  }, 60_000); // about 5 s on its own, which is the default limit; it must not depend on how busy the machine is
});

describe('readableVersions (diffs in the Git panel)', () => {
  const oldHtml = '<h1>Plan</h1><p>We ship <strong>Friday</strong>.</p>';

  it('an HTML vault: both versions become Markdown, so only the words differ', () => {
    const out = readableVersions(oldHtml, '<h1>Plan</h1><p>We ship <strong>Monday</strong>.</p>', 'html', env);
    expect(out).toEqual({ before: '# Plan\n\nWe ship **Friday**.\n', after: '# Plan\n\nWe ship **Monday**.\n' });
  });

  it('a vault converted since: the old HTML version is shown as Markdown next to the new Markdown one', () => {
    const out = readableVersions(oldHtml, '# Plan\n\nWe ship **Monday**.\n', 'markdown', env);
    expect(out.before).toBe('# Plan\n\nWe ship **Friday**.\n');
    expect(out.after).toBe('# Plan\n\nWe ship **Monday**.\n');
  });

  it('a Markdown note that starts with an HTML block is not misread as the old format', () => {
    const md = '<p>Intro in HTML</p>\n\n# Title\n';
    expect(readableVersions(md, md + 'more\n', 'markdown', env)).toEqual({ before: md, after: md + 'more\n' });
  });

  it('a new or deleted note has an empty side', () => {
    expect(readableVersions(null, '# New\n', 'markdown', env)).toEqual({ before: '', after: '# New\n' });
    expect(readableVersions('# Gone\n', null, 'markdown', env)).toEqual({ before: '# Gone\n', after: '' });
  });

  it('plain Markdown in an HTML vault (older notes) is left alone', () => {
    expect(readableVersions('# A\n\ntext\n', '# A\n\nmore\n', 'html', env)).toEqual({ before: '# A\n\ntext\n', after: '# A\n\nmore\n' });
  });
});
