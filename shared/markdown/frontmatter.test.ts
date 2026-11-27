import { describe, expect, it } from 'vitest';
import { extractMarkdownFrontmatter } from './frontmatter';

describe('extractMarkdownFrontmatter', () => {
  it('extracts a populated frontmatter block', () => {
    expect(extractMarkdownFrontmatter('---\ntitle: Note\n---\nBody')).toEqual({
      frontmatter: '---\ntitle: Note\n---',
      body: 'Body',
    });
  });

  it('extracts a populated CRLF frontmatter block', () => {
    expect(extractMarkdownFrontmatter('---\r\ntitle: Note\r\n---\r\nBody')).toEqual({
      frontmatter: '---\ntitle: Note\n---',
      body: 'Body',
    });
  });

  it('extracts an empty frontmatter block (LF) and leaves later horizontal rules alone', () => {
    const markdown = '---\n---\nSome text\n\n---\n\nMore text';
    expect(extractMarkdownFrontmatter(markdown)).toEqual({
      frontmatter: '---\n---',
      body: 'Some text\n\n---\n\nMore text',
    });
  });

  it('extracts an empty frontmatter block (CRLF) and leaves later horizontal rules alone', () => {
    const markdown = '---\r\n---\r\nSome text\r\n\r\n---\r\n\r\nMore text';
    expect(extractMarkdownFrontmatter(markdown)).toEqual({
      frontmatter: '---\n---',
      body: 'Some text\r\n\r\n---\r\n\r\nMore text',
    });
  });

  it('does not treat a document that is just a horizontal rule as frontmatter', () => {
    const markdown = '---\n';
    expect(extractMarkdownFrontmatter(markdown)).toEqual({
      frontmatter: null,
      body: markdown,
    });
  });

  it('leaves documents without frontmatter untouched', () => {
    const markdown = 'Just text\n\n---\n\nMore text';
    expect(extractMarkdownFrontmatter(markdown)).toEqual({
      frontmatter: null,
      body: markdown,
    });
  });
});
