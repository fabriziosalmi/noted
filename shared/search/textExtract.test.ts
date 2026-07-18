import { describe, it, expect } from 'vitest';
import { htmlToPlainText, deriveTitleFromRelPath } from './textExtract';

describe('htmlToPlainText', () => {
  it('strips tags and collapses whitespace', () => {
    expect(htmlToPlainText('<h1>Title</h1><p>Hello   world</p>')).toBe('Title Hello world');
  });

  it('drops HTML comments including the frontmatter block', () => {
    expect(htmlToPlainText('<!--noted-frontmatter:eyJ0IjoxfQ==--><p>body</p>')).toBe('body');
  });

  it('inserts spaces at block boundaries so words do not merge', () => {
    expect(htmlToPlainText('<p>one</p><p>two</p>')).toBe('one two');
    expect(htmlToPlainText('a<br>b')).toBe('a b');
  });

  it('decodes common entities', () => {
    expect(htmlToPlainText('<p>a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;</p>')).toBe('a & b <c> "d" \'e\'');
  });

  it('returns empty for empty input', () => {
    expect(htmlToPlainText('')).toBe('');
  });
});

describe('deriveTitleFromRelPath', () => {
  it('strips folder, extension and underscores', () => {
    expect(deriveTitleFromRelPath('Work/My_Note.md')).toBe('My Note');
    expect(deriveTitleFromRelPath('Minerva.md')).toBe('Minerva');
  });
});
