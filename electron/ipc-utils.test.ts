// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { validateFileName, stripUnsafeHtml, formatAppleNoteToMarkdown } from './ipc-utils';
import type TurndownService from 'turndown';

describe('validateFileName', () => {
  it('accepts valid markdown filenames', () => {
    expect(() => validateFileName('nota.md')).not.toThrow();
    expect(() => validateFileName('Nuova Nota.md')).not.toThrow();
    expect(() => validateFileName('my-note_1.md')).not.toThrow();
    expect(() => validateFileName('note (copy).md')).not.toThrow();
  });

  it('rejects non-string values', () => {
    expect(() => validateFileName(null)).toThrow('non-empty string');
    expect(() => validateFileName(undefined)).toThrow('non-empty string');
    expect(() => validateFileName(42)).toThrow('non-empty string');
  });

  it('rejects empty string', () => {
    expect(() => validateFileName('')).toThrow('non-empty string');
  });

  it('rejects path traversal with ..', () => {
    expect(() => validateFileName('../etc/passwd')).toThrow('Path traversal');
    expect(() => validateFileName('../../secret.md')).toThrow('Path traversal');
    expect(() => validateFileName('a/../b.md')).toThrow('Path traversal');
  });

  it('rejects absolute paths', () => {
    expect(() => validateFileName('/etc/passwd')).toThrow('Absolute paths');
  });

  it('rejects filenames without .md extension', () => {
    expect(() => validateFileName('nota.txt')).toThrow('.md extension');
    expect(() => validateFileName('nota')).toThrow('.md extension');
    expect(() => validateFileName('nota.md.sh')).toThrow('.md extension');
  });

  it('rejects filenames with shell-injection characters', () => {
    expect(() => validateFileName('nota;rm -rf.md')).toThrow('Invalid file name');
    expect(() => validateFileName('nota|cat.md')).toThrow('Invalid file name');
    expect(() => validateFileName('nota`whoami`.md')).toThrow('Invalid file name');
  });
});

describe('stripUnsafeHtml', () => {
  it('strips script tags', () => {
    const input = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
    expect(stripUnsafeHtml(input)).toBe('<p>Hello</p><p>World</p>');
  });

  it('strips inline event handlers', () => {
    const input = '<p onclick="alert(1)">Click me</p>';
    expect(stripUnsafeHtml(input)).not.toContain('onclick');
  });

  it('strips onerror on images', () => {
    const input = '<img src="x" onerror="alert(1)">';
    expect(stripUnsafeHtml(input)).not.toContain('onerror');
  });

  it('strips iframe tags', () => {
    const input = '<p>text</p><iframe src="evil.com"></iframe>';
    expect(stripUnsafeHtml(input)).toBe('<p>text</p>');
  });

  it('strips multiline script tags', () => {
    const input = '<p>ok</p>\n<script>\n  var x = 1;\n  alert(x);\n</script>\n<p>end</p>';
    const result = stripUnsafeHtml(input);
    expect(result).not.toContain('<script>');
    expect(result).toContain('<p>ok</p>');
    expect(result).toContain('<p>end</p>');
  });

  it('preserves safe html untouched', () => {
    const input = '<h1>Title</h1><p><strong>bold</strong> and <em>italic</em></p><ul><li>item</li></ul>';
    expect(stripUnsafeHtml(input)).toBe(input);
  });

  it('is case-insensitive for tag names', () => {
    const input = '<SCRIPT>alert(1)</SCRIPT><p>ok</p>';
    expect(stripUnsafeHtml(input)).not.toContain('SCRIPT');
    expect(stripUnsafeHtml(input)).toContain('<p>ok</p>');
  });
});

describe('formatAppleNoteToMarkdown', () => {
  const dummyTurndown = {
    turndown: (body: string) => `converted: ${body}`
  } as unknown as TurndownService;

  it('correctly converts HTML to markdown and prepends frontmatter with dates', () => {
    const title = 'A Nice Note';
    const body = '<div>Hello World</div>';
    const created = '2026-05-20T10:00:00Z';
    const modified = '2026-05-21T15:30:00Z';

    const result = formatAppleNoteToMarkdown(title, body, created, modified, dummyTurndown);
    expect(result).toBe([
      '---',
      'title: "A Nice Note"',
      'created: 2026-05-20T10:00:00Z',
      'modified: 2026-05-21T15:30:00Z',
      '---',
      '',
      'converted: <div>Hello World</div>'
    ].join('\n'));
  });

  it('handles null dates by omitting them from frontmatter', () => {
    const title = 'Date-less Note';
    const body = 'No dates';
    const result = formatAppleNoteToMarkdown(title, body, null, null, dummyTurndown);
    expect(result).toBe([
      '---',
      'title: "Date-less Note"',
      '---',
      '',
      'converted: No dates'
    ].join('\n'));
  });

  it('escapes quotes inside the title to prevent broken YAML frontmatter', () => {
    const title = 'My "Special" Title';
    const body = 'Content';
    const result = formatAppleNoteToMarkdown(title, body, null, null, dummyTurndown);
    expect(result).toBe([
      '---',
      'title: "My \\"Special\\" Title"',
      '---',
      '',
      'converted: Content'
    ].join('\n'));
  });

  it('sanitizes unsafe HTML body content to prevent stored XSS injections', () => {
    const title = 'Safe Import';
    const body = '<script>alert("XSS")</script><div>Clean content</div><iframe src="malicious.html"></iframe>';
    const result = formatAppleNoteToMarkdown(title, body, null, null, dummyTurndown);
    expect(result).toBe([
      '---',
      'title: "Safe Import"',
      '---',
      '',
      'converted: <div>Clean content</div>'
    ].join('\n'));
  });
});

