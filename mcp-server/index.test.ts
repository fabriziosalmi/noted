// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  validateNoteName,
  markdownToHtml,
  stripUnsafeHtml,
  toHtml,
  htmlToText,
} from './index';

describe('MCP validateNoteName', () => {
  it('accepts valid markdown filenames and single subfolder notes', () => {
    expect(() => validateNoteName('nota.md')).not.toThrow();
    expect(() => validateNoteName('Nuova Nota.md')).not.toThrow();
    expect(() => validateNoteName('my-note_1.md')).not.toThrow();
    expect(() => validateNoteName('note (copy).md')).not.toThrow();
    expect(() => validateNoteName('Lavoro/sprint.md')).not.toThrow();
  });

  it('rejects invalid types and empty strings', () => {
    expect(() => validateNoteName(null)).toThrow('Note name must be a non-empty string');
    expect(() => validateNoteName(undefined)).toThrow('Note name must be a non-empty string');
    expect(() => validateNoteName(42)).toThrow('Note name must be a non-empty string');
    expect(() => validateNoteName('')).toThrow('Note name must be a non-empty string');
    expect(() => validateNoteName('   ')).toThrow('Note name must be a non-empty string');
  });

  it('rejects path traversal and absolute paths', () => {
    expect(() => validateNoteName('../nota.md')).toThrow('not contain ".."');
    expect(() => validateNoteName('../../secret.md')).toThrow('not contain ".."');
    expect(() => validateNoteName('a/../b.md')).toThrow('not contain ".."');
    expect(() => validateNoteName('/etc/passwd.md')).toThrow('absolute path');
  });

  it('rejects notes with more than one subfolder level', () => {
    expect(() => validateNoteName('dir1/dir2/note.md')).toThrow('Only one level of subfolder is allowed');
  });

  it('rejects filenames without .md extension', () => {
    expect(() => validateNoteName('nota.txt')).toThrow('must end with .md');
    expect(() => validateNoteName('nota')).toThrow('must end with .md');
  });

  it('rejects segment names with forbidden characters', () => {
    expect(() => validateNoteName('nota;rm.md')).toThrow('only alphanumeric');
    expect(() => validateNoteName('nota|cat.md')).toThrow('only alphanumeric');
    expect(() => validateNoteName('nota`whoami`.md')).toThrow('only alphanumeric');
    expect(() => validateNoteName('Lavoro/sprint#.md')).toThrow('only alphanumeric');
  });
});

describe('MCP markdownToHtml (escaping and inline elements)', () => {
  it('escapes &, <, > in paragraphs', () => {
    const md = 'Comparison: A < B & B > C';
    const html = markdownToHtml(md);
    expect(html).toBe('<p>Comparison: A &lt; B &amp; B &gt; C</p>');
  });

  it('escapes and formats inline code segments', () => {
    const md = 'This is inline code: `x < y & z`';
    const html = markdownToHtml(md);
    expect(html).toBe('<p>This is inline code: <code>x &lt; y &amp; z</code></p>');
  });

  it('avoids parsing markdown tags inside inline code', () => {
    const md = 'Code like `**not bold**` or `_not italic_`';
    const html = markdownToHtml(md);
    expect(html).toBe('<p>Code like <code>**not bold**</code> or <code>_not italic_</code></p>');
  });

  it('escapes and formats fenced code blocks', () => {
    const md = '```typescript\nconst x = 1 < 2 && 2 > 1;\n```';
    const html = markdownToHtml(md);
    expect(html).toBe('<pre><code class="language-typescript">const x = 1 &lt; 2 &amp;&amp; 2 &gt; 1;</code></pre>');
  });

  it('renders inline formatting correctly', () => {
    const md = 'This is **bold**, __also bold__, *italic*, _also italic_, and [link](http://x.com?a=1&b=2)';
    const html = markdownToHtml(md);
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<strong>also bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<em>also italic</em>');
    expect(html).toContain('<a href="http://x.com?a=1&amp;b=2">link</a>');
  });
});

describe('MCP markdownToHtml (Lists)', () => {
  it('renders simple unordered lists', () => {
    const md = '- Item 1\n- Item 2';
    const html = markdownToHtml(md);
    expect(html).toBe('<ul>\n<li>Item 1</li>\n<li>Item 2</li>\n</ul>');
  });

  it('renders simple ordered lists', () => {
    const md = '1. Item 1\n2. Item 2';
    const html = markdownToHtml(md);
    expect(html).toBe('<ol>\n<li>Item 1</li>\n<li>Item 2</li>\n</ol>');
  });

  it('renders nested unordered lists', () => {
    const md = '- Item 1\n  - Subitem 1.1\n  - Subitem 1.2\n- Item 2';
    const html = markdownToHtml(md);
    expect(html).toBe('<ul>\n<li>Item 1</li>\n<ul>\n<li>Subitem 1.1</li>\n<li>Subitem 1.2</li>\n</ul>\n<li>Item 2</li>\n</ul>');
  });

  it('renders nested ordered lists within unordered lists', () => {
    const md = '- Item 1\n  1. Ordered A\n  2. Ordered B';
    const html = markdownToHtml(md);
    expect(html).toBe('<ul>\n<li>Item 1</li>\n<ol>\n<li>Ordered A</li>\n<li>Ordered B</li>\n</ol>\n</ul>');
  });

  it('correctly handles list transitions', () => {
    const md = '- Bullet\n1. Number';
    const html = markdownToHtml(md);
    expect(html).toBe('<ul>\n<li>Bullet</li>\n</ul>\n<ol>\n<li>Number</li>\n</ol>');
  });
});

describe('MCP htmlToText', () => {
  it('converts basic formatting back to plaintext', () => {
    const html = '<h1>Title</h1><p>Paragraph with <br> break and <strong>bold</strong> text</p>';
    const text = htmlToText(html);
    expect(text).toBe('Title\nParagraph with \n break and bold text');
  });

  it('unescapes HTML entities', () => {
    const html = '<p>A &lt; B &amp; B &gt; C &quot;quoted&quot; &#39;single&#39;</p>';
    const text = htmlToText(html);
    expect(text).toBe("A < B & B > C \"quoted\" 'single'");
  });
});

describe('MCP stripUnsafeHtml', () => {
  it('removes scripts, iframes, objects, embeds, event handlers', () => {
    const dirty = '<div>Safe</div><script>alert(1)</script><iframe src="xyz"></iframe><img src="x" onerror="bad()">';
    const clean = stripUnsafeHtml(dirty);
    expect(clean).toBe('<div>Safe</div><img src="x">');
  });

  it('decodes numeric HTML entities before filtering to catch obfuscated payloads', () => {
    const obfuscated = '&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;';
    const clean = stripUnsafeHtml(obfuscated);
    expect(clean).toBe('');
  });
});

describe('MCP toHtml', () => {
  it('converts markdown to safe html', () => {
    const md = 'This is **bold** and <script>alert(1)</script>';
    const html = toHtml(md);
    expect(html).toBe('<p>This is <strong>bold</strong> and &lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('passes through safe HTML as-is', () => {
    const raw = '<p>Already HTML</p>';
    const html = toHtml(raw);
    expect(html).toBe('<p>Already HTML</p>');
  });

  it('sanitizes unsafe HTML passed as HTML', () => {
    const raw = '<div>Hello</div><script>alert(1)</script>';
    const html = toHtml(raw);
    expect(html).toBe('<div>Hello</div>');
  });
});
