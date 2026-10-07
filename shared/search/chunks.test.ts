import { describe, it, expect } from 'vitest';
import { chunkNote, embedText, MAX_CHUNK_CHARS, MAX_CHUNKS_PER_NOTE } from './chunks';

const at = (chunks: ReturnType<typeof chunkNote>) => chunks.map(c => [c.headingPath.join(' > '), c.text]);

describe('chunkNote (Markdown)', () => {
  const note = `---
title: Plan
tags: [a]
---
# Plan

Intro paragraph.

## Goals

- ship it
- test it

## Risks

### Technical

Flaky **tests**.

### People

Holiday season.

## Goals again
Back to level two.
`;

  it('cuts at headings, keeps the path of each, leaves out frontmatter, markup and the title heading', () => {
    expect(at(chunkNote('Plan', note))).toEqual([
      ['', 'Intro paragraph.'],
      ['Goals', 'ship it test it'],
      ['Risks > Technical', 'Flaky tests.'],
      ['Risks > People', 'Holiday season.'],
      ['Goals again', 'Back to level two.'],
    ]);
  });

  it('a heading that is not the title stays in the path (and the match with the title ignores case)', () => {
    expect(chunkNote('plan', '# PLAN\n\nx\n').map(c => c.headingPath)).toEqual([[]]);
    expect(chunkNote('Other', '# Plan\n\nx\n').map(c => c.headingPath)).toEqual([['Plan']]);
  });

  it('numbers the chunks in order', () => {
    expect(chunkNote('Plan', note).map(c => c.ord)).toEqual([0, 1, 2, 3, 4]);
  });

  it('does not take a "#" line inside a code fence for a heading, and keeps the code with its section', () => {
    const chunks = chunkNote('N', '## Setup\n\n```sh\n# install\nnpm i\n\n# run\nnpm start\n```\n\nDone.\n');
    expect(chunks.map(c => c.headingPath.join('>'))).toEqual(['Setup']);
    expect(chunks[0].text).toContain('install');
    expect(chunks[0].text).toContain('npm start');
    expect(chunks[0].text).toContain('Done.');
  });

  it('a note with no headings is one chunk, an empty note or one that is only headings has none', () => {
    expect(at(chunkNote('N', 'Just text.\n\nMore text.\n'))).toEqual([['', 'Just text.\nMore text.']]);
    expect(chunkNote('N', '')).toEqual([]);
    expect(chunkNote('N', '# N\n\n## Empty\n\n## Also empty\n')).toEqual([]);
    expect(chunkNote('N', '---\ntitle: x\n---\n')).toEqual([]);
  });

  it('closes a heading with trailing hashes, and takes #, ## and the others at any indent up to three', () => {
    expect(chunkNote('N', '## Closed ##\n\nx\n\n   ### Indented\n\ny\n').map(c => c.headingPath.join('>'))).toEqual(['Closed', 'Closed>Indented']);
    expect(chunkNote('N', '    ## four spaces is code\n').map(c => c.headingPath)).toEqual([[]]);
  });

  it('a long section is packed into chunks under the limit, cut between paragraphs first', () => {
    const para = (n: number) => `Paragraph ${n}. ${'word '.repeat(60)}`.trim();
    const chunks = chunkNote('N', `## Long\n\n${[1, 2, 3, 4, 5, 6, 7, 8].map(para).join('\n\n')}\n`, 800);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every(c => c.text.length <= 800)).toBe(true);
    expect(chunks.every(c => c.headingPath.join('>') === 'Long')).toBe(true);
    expect(chunks.every(c => /^Paragraph \d\./.test(c.text))).toBe(true); // never starts mid-paragraph
    expect(chunks.map(c => c.text).join(' ')).toContain('Paragraph 8.');
  });

  it('one paragraph longer than the limit is cut at sentence ends, then at spaces, then anywhere', () => {
    const sentences = chunkNote('N', `${'This is a sentence. '.repeat(200)}\n`, 300);
    expect(sentences.every(c => c.text.length <= 300 && c.text.endsWith('.'))).toBe(true);
    const words = chunkNote('N', `${'word '.repeat(300)}\n`, 300);
    expect(words.every(c => c.text.length <= 300)).toBe(true);
    const solid = chunkNote('N', `${'x'.repeat(1000)}\n`, 300);
    expect(solid.map(c => c.text.length)).toEqual([300, 300, 300, 100]);
    expect(solid.map(c => c.text).join('')).toBe('x'.repeat(1000)); // nothing lost, nothing repeated
  });

  it('never gives a chunk over the default limit, and stops at the per-note cap', () => {
    const huge = Array.from({ length: MAX_CHUNKS_PER_NOTE + 50 }, (_, i) => `## S${i}\n\ntext ${i}\n`).join('\n');
    const chunks = chunkNote('N', huge);
    expect(chunks).toHaveLength(MAX_CHUNKS_PER_NOTE);
    expect(chunkNote('N', 'a '.repeat(10_000)).every(c => c.text.length <= MAX_CHUNK_CHARS)).toBe(true);
  });

  it('is deterministic, and a change in one section changes only that section', () => {
    const a = chunkNote('Plan', note);
    expect(chunkNote('Plan', note)).toEqual(a);
    const b = chunkNote('Plan', note.replace('Holiday season.', 'Holiday season and flu.'));
    expect(b.map((c, i) => c.text === a[i].text)).toEqual([true, true, true, false, true]);
  });

  it('handles CRLF line ends and a BOM', () => {
    expect(at(chunkNote('N', '﻿## A\r\n\r\ntext\r\n\r\n## B\r\n\r\nmore\r\n'))).toEqual([['A', 'text'], ['B', 'more']]);
  });
});

describe('chunkNote (HTML vaults)', () => {
  it('cuts at h1-h6, drops the comments (frontmatter included) and the tags', () => {
    const html = '<!--noted-frontmatter:{"a":1}--><h1>Plan</h1><p>Intro &amp; more.</p><h2>Risks</h2><p>One.</p><p>Two.</p><h3>People</h3><ul><li>Ana</li></ul>';
    expect(at(chunkNote('Plan', html))).toEqual([
      ['', 'Intro & more.'],
      ['Risks', 'One. Two.'],
      ['Risks > People', 'Ana'],
    ]);
  });
});

describe('embedText', () => {
  it('puts the place of the chunk before its text', () => {
    expect(embedText('Plan', { headingPath: ['Risks', 'People'], text: 'Holiday.' })).toBe('Plan › Risks › People\n\nHoliday.');
    expect(embedText('Plan', { headingPath: [], text: 'Intro.' })).toBe('Plan\n\nIntro.');
  });
});
