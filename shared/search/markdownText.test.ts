// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { htmlToPlainText, markdownToPlainText, noteToPlainText, notePreview } from './textExtract';

describe('markdownToPlainText', () => {
  it('drops frontmatter and syntax but keeps the words', () => {
    const md = ['---', 'title: Plan', 'tags: [a]', '---', '', '# Project **plan**', '', '- [ ] call [Ann](https://x.io)', '- see ![chart](a.png)', '', '> [!note] Careful', '> mind the `gap`'].join('\n');
    expect(markdownToPlainText(md)).toBe('Project plan call Ann see chart Careful mind the gap');
  });

  it('keeps wikilink targets and aliases searchable, and embeds', () => {
    expect(markdownToPlainText('See [[Alpha plan]] and [[Beta|the second]] and [[Gamma#Setup]] and ![[Snippet]].')).toBe('See Alpha plan and the second and Gamma Setup and Snippet .');
  });

  it('ignores comments, fences and table rules, and drops the operators search never matches on', () => {
    const md = ['Visible %%hidden%% text', '', '```js', 'a = 1', '```', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', '', 'Price 5 \\* 3'].join('\n');
    expect(markdownToPlainText(md)).toBe('Visible text a 1 a b 1 2 Price 5 3');
  });

  it('is empty for empty input', () => {
    expect(markdownToPlainText('')).toBe('');
    expect(markdownToPlainText('---\na: 1\n---\n')).toBe('');
  });
});

describe('noteToPlainText', () => {
  it('chooses by what the file looks like', () => {
    expect(noteToPlainText('<h1>Title</h1><p>Body &amp; more</p>')).toBe(htmlToPlainText('<h1>Title</h1><p>Body &amp; more</p>'));
    expect(noteToPlainText('# Title\n\nBody & more')).toBe('Title Body & more');
  });
});

describe('notePreview', () => {
  it('skips the title and the frontmatter in an HTML note', () => {
    expect(notePreview('<!--noted-frontmatter:abc--><h1>Title</h1><p>First   line</p><p>Second</p>')).toBe('First line Second');
  });

  it('skips the title and the frontmatter in a Markdown note', () => {
    expect(notePreview('---\ntitle: x\n---\n\n# Title\n\nFirst **line** with [[Link]].\n\n- item')).toBe('First line with Link . item');
  });

  it('shows nothing when the read stopped inside the frontmatter, and cuts long previews', () => {
    expect(notePreview('---\ntitle: x\nstatus: draft\nmore: 1')).toBe('');
    expect(notePreview(`# T\n\n${'word '.repeat(100)}`)).toHaveLength(120);
  });
});
