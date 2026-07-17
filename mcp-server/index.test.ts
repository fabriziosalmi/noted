// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const mockFiles = new Map<string, { content: string; mtime: Date; size: number }>();

vi.mock('node:fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    existsSync: (p: fs.PathLike) => {
      const strPath = String(p).replace(/\/$/, '');
      if (strPath.endsWith('symfolder/note.md')) return false;
      if (strPath.endsWith('symfolder')) return true;
      if (mockFiles.has(strPath)) return true;
      if (strPath === '/mockdir') return true;
      for (const key of mockFiles.keys()) {
        if (key.startsWith(strPath + '/')) return true;
      }
      return actual.existsSync(p);
    },
    realpathSync: (p: fs.PathLike, _options?: any) => {
      const strPath = String(p);
      if (strPath.endsWith('symfolder')) {
        return '/etc'; // Escape route!
      }
      return strPath;
    },
    readdirSync: (p: fs.PathLike, options?: any) => {
      const strPath = String(p);
      if (strPath.includes('mockdir')) {
        // Return files and folders for listAllNotes
        const entries: any[] = [];
        for (const [key] of mockFiles.entries()) {
          if (key.startsWith(strPath)) {
            const rel = key.slice(strPath.length).replace(/^\//, '');
            if (rel && !rel.includes('/')) {
              entries.push({
                isFile: () => true,
                isDirectory: () => false,
                name: rel,
              });
            } else if (rel && rel.includes('/')) {
              const subfolder = rel.split('/')[0];
              if (!entries.some(e => e.name === subfolder)) {
                entries.push({
                  isFile: () => false,
                  isDirectory: () => true,
                  name: subfolder,
                });
              }
            }
          }
        }
        if (options && options.withFileTypes) {
          return entries;
        }
        return entries.map(e => e.name);
      }
      return actual.readdirSync(p, options);
    },
    readFileSync: (p: fs.PathLike, encoding?: any) => {
      const strPath = String(p);
      if (mockFiles.has(strPath)) {
        return mockFiles.get(strPath)!.content;
      }
      return actual.readFileSync(p, encoding);
    },
    writeFileSync: (p: fs.PathLike, content: any, _options?: any) => {
      const strPath = String(p);
      const cleanPath = strPath.replace(/\.[a-f0-9]+\.tmp$/, '');
      mockFiles.set(cleanPath, {
        content: String(content),
        mtime: new Date(),
        size: Buffer.byteLength(String(content), 'utf8'),
      });
    },
    statSync: (p: fs.PathLike) => {
      const strPath = String(p);
      if (mockFiles.has(strPath)) {
        return {
          mtime: mockFiles.get(strPath)!.mtime,
          size: mockFiles.get(strPath)!.size,
        };
      }
      return actual.statSync(p);
    },
    unlinkSync: (p: fs.PathLike) => {
      const strPath = String(p);
      if (mockFiles.has(strPath)) {
        mockFiles.delete(strPath);
        return;
      }
      return actual.unlinkSync(p);
    },
    mkdirSync: vi.fn(),
    renameSync: (from: fs.PathLike, to: fs.PathLike) => {
      const strFrom = String(from);
      const strTo = String(to);
      const item = mockFiles.get(strFrom);
      if (item) {
        mockFiles.set(strTo, item);
        mockFiles.delete(strFrom);
      }
    },
  };
});

let sseTransportInstances: any[] = [];

vi.mock('@modelcontextprotocol/sdk/server/sse.js', () => {
  return {
    SSEServerTransport: class SSEServerTransport {
      sessionId = 'mock-session-id';
      onclose?: () => void;
      handlePostMessage = vi.fn();
      constructor() {
        sseTransportInstances.push(this);
      }
    },
  };
});

const mockHttpServer = {
  listen: vi.fn((port, host, cb) => {
    if (cb) cb();
    return mockHttpServer;
  }),
};
let httpHandler: any = null;

vi.mock('node:http', () => {
  return {
    createServer: vi.fn((handler) => {
      httpHandler = handler;
      return mockHttpServer;
    }),
  };
});

process.argv.push('--notes-dir=/mockdir');

const {
  validateNoteName,
  validateFolderName,
  safeNotePath,
  markdownToHtml,
  stripUnsafeHtml,
  toHtml,
  htmlToText,
  handleListNotes,
  handleReadNote,
  handleCreateNote,
  handleUpdateNote,
  handleSearchNotes,
  handleDeleteNote,
  handleCreateAgentWorkflow,
  handleAppendAgentEvent,
  buildAgentWorkflowFiles,
  getArgValue,
  excerpt,
  main,
  resolveNotesDir,
} = await import('./index');

describe('MCP validateNoteName', () => {
  it('accepts valid markdown filenames and single subfolder notes', () => {
    expect(() => validateNoteName('nota.md')).not.toThrow();
    expect(() => validateNoteName('Nuova Nota.md')).not.toThrow();
    expect(() => validateNoteName('my-note_1.md')).not.toThrow();
    expect(() => validateNoteName('note (copy).md')).not.toThrow();
    expect(() => validateNoteName('Lavoro/sprint.md')).not.toThrow();
    expect(() => validateNoteName('Café.md')).not.toThrow();
    expect(() => validateNoteName('venerdì.md')).not.toThrow();
    expect(() => validateNoteName('folder/[test] note.md')).not.toThrow();
    expect(() => validateNoteName("note's copy.md")).not.toThrow();
    expect(() => validateNoteName("note, copy.md")).not.toThrow();
    expect(() => validateNoteName("📝 Nota.md")).not.toThrow();
    expect(() => validateNoteName("Lavoro/sprint#.md")).not.toThrow();
    expect(() => validateNoteName("Idea & Draft.md")).not.toThrow();
    expect(() => validateNoteName("Lavoro + Progetti.md")).not.toThrow();
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
    expect(() => validateNoteName('nota;rm.md')).toThrow('contains reserved characters');
    expect(() => validateNoteName('nota|cat.md')).toThrow('contains reserved characters');
    expect(() => validateNoteName('nota`whoami`.md')).toThrow('contains reserved characters');
    expect(() => validateNoteName('nota$var.md')).toThrow('contains reserved characters');
  });
});

describe('MCP markdownToHtml (escaping and inline elements)', () => {
  it('escapes &, <, > in paragraphs', () => {
    const md = 'Comparison: A < B & B > C';
    const html = markdownToHtml(md);
    expect(html.trim()).toBe('<p>Comparison: A &lt; B &amp; B &gt; C</p>');
  });

  it('escapes and formats inline code segments', () => {
    const md = 'This is inline code: `x < y & z`';
    const html = markdownToHtml(md);
    expect(html.trim()).toBe('<p>This is inline code: <code>x &lt; y &amp; z</code></p>');
  });

  it('avoids parsing markdown tags inside inline code', () => {
    const md = 'Code like `**not bold**` or `_not italic_`';
    const html = markdownToHtml(md);
    expect(html.trim()).toBe('<p>Code like <code>**not bold**</code> or <code>_not italic_</code></p>');
  });

  it('escapes and formats fenced code blocks', () => {
    const md = '```typescript\nconst x = 1 < 2 && 2 > 1;\n```';
    const html = markdownToHtml(md);
    expect(html.trim()).toBe('<pre><code class="language-typescript">const x = 1 &lt; 2 &amp;&amp; 2 &gt; 1;\n</code></pre>');
  });

  it('renders inline formatting correctly', () => {
    const md = 'This is **bold**, __also bold__, *italic*, _also italic_, and [link](http://x.com?a=1&b=2)';
    const html = markdownToHtml(md);
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<strong>also bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<em>also italic</em>');
    expect(html).toContain('<a href="http://x.com?a=1&b=2">link</a>');
  });

  it('renders GFM pipe tables correctly', () => {
    const md = '| Col A | Col B |\n|---|---|\n| Val A | Val B |';
    const html = markdownToHtml(md);
    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('<th>Col A</th>');
    expect(html).toContain('<td>Val A</td>');
  });
});

describe('MCP markdownToHtml (Lists)', () => {
  it('renders simple unordered lists', () => {
    const md = '- Item 1\n- Item 2';
    const html = markdownToHtml(md);
    expect(html.trim()).toBe('<ul>\n<li>Item 1</li>\n<li>Item 2</li>\n</ul>');
  });

  it('renders simple ordered lists', () => {
    const md = '1. Item 1\n2. Item 2';
    const html = markdownToHtml(md);
    expect(html.trim()).toBe('<ol>\n<li>Item 1</li>\n<li>Item 2</li>\n</ol>');
  });

  it('renders nested unordered lists', () => {
    const md = '- Item 1\n  - Subitem 1.1\n  - Subitem 1.2\n- Item 2';
    const html = markdownToHtml(md);
    expect(html.trim()).toBe('<ul>\n<li>Item 1<ul>\n<li>Subitem 1.1</li>\n<li>Subitem 1.2</li>\n</ul>\n</li>\n<li>Item 2</li>\n</ul>');
  });

  it('renders nested ordered lists within unordered lists', () => {
    const md = '- Item 1\n  1. Ordered A\n  2. Ordered B';
    const html = markdownToHtml(md);
    expect(html.trim()).toBe('<ul>\n<li>Item 1<ol>\n<li>Ordered A</li>\n<li>Ordered B</li>\n</ol>\n</li>\n</ul>');
  });

  it('correctly handles list transitions', () => {
    const md = '- Bullet\n1. Number';
    const html = markdownToHtml(md);
    expect(html.trim()).toBe('<ul>\n<li>Bullet</li>\n</ul>\n<ol>\n<li>Number</li>\n</ol>');
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
    expect(clean).toBe(obfuscated);
  });

  it('decodes decimal HTML entities before filtering', () => {
    const obfuscated = '&#60;script&#62;alert(1)&#x3C;/script&#x3E;';
    const clean = stripUnsafeHtml(obfuscated);
    expect(clean).toBe(obfuscated);
  });
});

describe('MCP toHtml', () => {
  it('converts markdown to safe html', () => {
    const md = 'This is **bold** and <script>alert(1)</script>';
    const html = toHtml(md);
    expect(html.trim()).toBe('<p>This is <strong>bold</strong> and </p>');
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

describe('MCP validateFolderName', () => {
  it('accepts valid folder names', () => {
    expect(() => validateFolderName('Lavoro')).not.toThrow();
    expect(() => validateFolderName('Sprint 2026')).not.toThrow();
    expect(() => validateFolderName('Progetti (2026)')).not.toThrow();
    expect(() => validateFolderName('my-notes_1')).not.toThrow();
    expect(() => validateFolderName('Café')).not.toThrow();
    expect(() => validateFolderName('[Progetti]')).not.toThrow();
    expect(() => validateFolderName("L'ufficio")).not.toThrow();
    expect(() => validateFolderName("Progetti, Idee")).not.toThrow();
    expect(() => validateFolderName("📝 Folder")).not.toThrow();
    expect(() => validateFolderName("Folder & Co.")).not.toThrow();
    expect(() => validateFolderName("Lavoro + Personale")).not.toThrow();
    expect(() => validateFolderName("tag #urgent")).not.toThrow();
  });

  it('rejects invalid types and empty strings', () => {
    expect(() => validateFolderName(null)).toThrow('Folder name must be a non-empty string');
    expect(() => validateFolderName(undefined)).toThrow('Folder name must be a non-empty string');
    expect(() => validateFolderName('')).toThrow('Folder name must be a non-empty string');
    expect(() => validateFolderName('   ')).toThrow('Folder name must be a non-empty string');
  });

  it('rejects folder names with traversal or slashes', () => {
    expect(() => validateFolderName('..')).toThrow('not contain ".."');
    expect(() => validateFolderName('a/b')).toThrow('not contain ".."');
    expect(() => validateFolderName('a\\b')).toThrow('not contain ".."');
  });

  it('rejects invalid characters', () => {
    expect(() => validateFolderName('Lavoro;')).toThrow('invalid characters');
    expect(() => validateFolderName('Lavoro$')).toThrow('invalid characters');
  });
});

describe('MCP stripUnsafeHtml (Draconian Bypasses)', () => {
  it('strips unclosed script and iframe tags', () => {
    expect(stripUnsafeHtml('<script src="bad.js"')).toBe('');
    expect(stripUnsafeHtml('<script src="bad.js">alert(1)')).toBe('');
    expect(stripUnsafeHtml('<iframe src="evil.com"')).toBe('');
  });

  it('strips inline event handlers with slash separators or no whitespace', () => {
    expect(stripUnsafeHtml('<body/onload=alert(1)>')).toBe('');
    expect(stripUnsafeHtml('<img/onerror="alert(1)">')).toBe('<img>');
    expect(stripUnsafeHtml('<p onclick=alert(1)>Click</p>')).toBe('<p>Click</p>');
  });

  it('strips obfuscated javascript and vbscript protocols', () => {
    expect(stripUnsafeHtml('<a href="java\tscript:alert(1)">Link</a>')).toBe('<a>Link</a>');
    expect(stripUnsafeHtml('<a href="j\na\r\x00v\tascript:alert(1)">Link</a>')).toBe('<a>Link</a>');
    expect(stripUnsafeHtml('<a href="java&Tab;script&colon;alert(1)">Link</a>')).toBe('<a>Link</a>');
    expect(stripUnsafeHtml('<a href="vb\tscript:alert(1)">Link</a>')).toBe('<a>Link</a>');
  });

  it('handles recursive entity obfuscation', () => {
    const nested = '&amp;#x3C;script&amp;#x3E;alert(1)&amp;#x3C;/script&amp;#x3E;';
    expect(stripUnsafeHtml(nested)).toBe(nested);
  });
});

describe('MCP safeNotePath Symlink Traversal', () => {
  it('rejects path traversal via directory symlinks', () => {
    expect(() => safeNotePath('symfolder/note.md')).toThrow('Path traversal detected');
  });
});

describe('MCP Tool Handlers', () => {
  beforeEach(() => {
    mockFiles.clear();
  });

  describe('handleListNotes', () => {
    it('returns empty notes message if directory does not have notes', async () => {
      const res = await handleListNotes({});
      expect(res.content[0].text).toContain('No notes found.');
    });

    it('returns list of notes sorted by mtime', async () => {
      mockFiles.set('/mockdir/note1.md', {
        content: 'Content 1',
        mtime: new Date('2026-01-01T10:00:00Z'),
        size: 100
      });
      mockFiles.set('/mockdir/note2.md', {
        content: 'Content 2',
        mtime: new Date('2026-01-02T10:00:00Z'),
        size: 200
      });
      
      const res = await handleListNotes({});
      expect(res.content[0].text).toContain('2 notes');
      expect(res.content[0].text).toContain('note2.md  [0.2 KB, 2026-01-02]');
      expect(res.content[0].text).toContain('note1.md  [0.1 KB, 2026-01-01]');
    });

    it('filters by folder name', async () => {
      mockFiles.set('/mockdir/note1.md', {
        content: 'Content 1',
        mtime: new Date(),
        size: 100
      });
      mockFiles.set('/mockdir/Lavoro/note2.md', {
        content: 'Content 2',
        mtime: new Date(),
        size: 200
      });

      const res = await handleListNotes({ folder: 'Lavoro' });
      expect(res.content[0].text).toContain('1 note in "Lavoro"');
      expect(res.content[0].text).toContain('Lavoro/note2.md');
      expect(res.content[0].text).not.toContain('note1.md');
    });

    it('skips malformed note names when listing', async () => {
      mockFiles.set('/mockdir/good.md', {
        content: 'Content 1',
        mtime: new Date(),
        size: 100
      });
      mockFiles.set('/mockdir/bad;name.md', {
        content: 'Content 2',
        mtime: new Date(),
        size: 100
      });

      const res = await handleListNotes({});
      expect(res.content[0].text).toContain('1 note');
      expect(res.content[0].text).toContain('good.md');
      expect(res.content[0].text).not.toContain('bad;name.md');
    });

    it('returns folder empty message if folder has no notes', async () => {
      const res = await handleListNotes({ folder: 'EmptyFolder' });
      expect(res.content[0].text).toContain('No notes found in folder "EmptyFolder"');
    });

    it('rejects invalid folder names', async () => {
      await expect(handleListNotes({ folder: '../invalid' })).rejects.toThrow();
    });
  });

  describe('handleReadNote', () => {
    it('reads existing note successfully', async () => {
      mockFiles.set('/mockdir/note1.md', {
        content: '<p>Hello World</p>',
        mtime: new Date('2026-05-22T12:00:00Z'),
        size: 18
      });

      const res = await handleReadNote({ name: 'note1.md' });
      expect(res.content[0].text).toContain('# note1');
      expect(res.content[0].text).toContain('Hello World');
      expect(res.content[0].text).toContain('<p>Hello World</p>');
    });

    it('throws error if note not found', async () => {
      await expect(handleReadNote({ name: 'nonexistent.md' })).rejects.toThrow('Note not found');
    });

    it('rejects invalid note names', async () => {
      await expect(handleReadNote({ name: 'invalid' })).rejects.toThrow();
    });
  });

  describe('handleCreateNote', () => {
    it('creates note successfully', async () => {
      const res = await handleCreateNote({ name: 'new-note.md', content: '# Welcome\nHello!' });
      expect(res.content[0].text).toContain('Note created: new-note.md');
      expect(mockFiles.has('/mockdir/new-note.md')).toBe(true);
      expect(mockFiles.get('/mockdir/new-note.md')?.content).toContain('<h1>Welcome</h1>');
    });

    it('rejects if note already exists', async () => {
      mockFiles.set('/mockdir/existing.md', { content: 'Exists', mtime: new Date(), size: 6 });
      await expect(handleCreateNote({ name: 'existing.md', content: 'New content' })).rejects.toThrow('Note already exists');
    });

    it('rejects if content is not a non-empty string', async () => {
      await expect(handleCreateNote({ name: 'new.md', content: '' })).rejects.toThrow('content must be a non-empty string');
      await expect(handleCreateNote({ name: 'new.md', content: null })).rejects.toThrow('content must be a non-empty string');
    });
  });

  describe('handleUpdateNote', () => {
    it('overwrites content by default', async () => {
      mockFiles.set('/mockdir/edit.md', { content: '<p>Old</p>', mtime: new Date(), size: 10 });
      const res = await handleUpdateNote({ name: 'edit.md', content: 'New text' });
      expect(res.content[0].text).toContain('Note updated: edit.md');
      expect(mockFiles.get('/mockdir/edit.md')?.content).toBe('<p>New text</p>\n');
    });

    it('appends content when append=true', async () => {
      mockFiles.set('/mockdir/edit.md', { content: '<p>Old</p>', mtime: new Date(), size: 10 });
      const res = await handleUpdateNote({ name: 'edit.md', content: 'Appended text', append: true });
      expect(res.content[0].text).toContain('Note appended to: edit.md');
      expect(mockFiles.get('/mockdir/edit.md')?.content).toBe('<p>Old</p>\n<hr>\n<p>Appended text</p>\n');
    });

    it('rejects if note does not exist', async () => {
      await expect(handleUpdateNote({ name: 'nonexistent.md', content: 'New text' })).rejects.toThrow('Note not found');
    });

    it('rejects if content is not a non-empty string', async () => {
      await expect(handleUpdateNote({ name: 'edit.md', content: '' })).rejects.toThrow('content must be a non-empty string');
      await expect(handleUpdateNote({ name: 'edit.md', content: null })).rejects.toThrow('content must be a non-empty string');
    });
  });

  describe('handleSearchNotes', () => {
    it('searches successfully across files', async () => {
      mockFiles.set('/mockdir/note1.md', { content: '<p>Find this secret word</p>', mtime: new Date(), size: 28 });
      mockFiles.set('/mockdir/note2.md', { content: '<p>Nothing here</p>', mtime: new Date(), size: 18 });

      const res = await handleSearchNotes({ query: 'secret' });
      expect(res.content[0].text).toContain('1 result for "secret"');
      expect(res.content[0].text).toContain('note1.md');
      expect(res.content[0].text).not.toContain('note2.md');
    });

    it('returns no results found message', async () => {
      const res = await handleSearchNotes({ query: 'missing' });
      expect(res.content[0].text).toContain('No notes found matching "missing"');
    });

    it('respects max_results limit', async () => {
      mockFiles.set('/mockdir/note1.md', { content: '<p>test search</p>', mtime: new Date(), size: 17 });
      mockFiles.set('/mockdir/note2.md', { content: '<p>test search</p>', mtime: new Date(), size: 17 });
      
      const res = await handleSearchNotes({ query: 'test', max_results: 1 });
      expect(res.content[0].text).toContain('1 result for "test"');
    });

    it('returns pluralized results count for multiple matches', async () => {
      mockFiles.set('/mockdir/note1.md', { content: '<p>test search</p>', mtime: new Date(), size: 17 });
      mockFiles.set('/mockdir/note2.md', { content: '<p>test search</p>', mtime: new Date(), size: 17 });
      const res = await handleSearchNotes({ query: 'test' });
      expect(res.content[0].text).toContain('2 results for "test"');
    });

    it('skips malformed note names instead of crashing', async () => {
      mockFiles.set('/mockdir/good.md', { content: '<p>needle</p>', mtime: new Date(), size: 13 });
      mockFiles.set('/mockdir/bad;name.md', { content: '<p>needle</p>', mtime: new Date(), size: 13 });

      const res = await handleSearchNotes({ query: 'needle' });
      expect(res.content[0].text).toContain('1 result for "needle"');
      expect(res.content[0].text).toContain('good.md');
      expect(res.content[0].text).not.toContain('bad;name.md');
    });

    it('rejects invalid query', async () => {
      await expect(handleSearchNotes({ query: '' })).rejects.toThrow('query must be a non-empty string');
      await expect(handleSearchNotes({ query: null })).rejects.toThrow('query must be a non-empty string');
    });
  });

  describe('handleDeleteNote', () => {
    it('deletes existing note', async () => {
      mockFiles.set('/mockdir/delete-me.md', { content: 'Delete me', mtime: new Date(), size: 9 });
      const res = handleDeleteNote({ name: 'delete-me.md' });
      await expect(res).resolves.toEqual({
        content: [{ type: 'text', text: 'Note deleted: delete-me.md' }]
      });
      expect(mockFiles.has('/mockdir/delete-me.md')).toBe(false);
    });

    it('throws if note not found', async () => {
      await expect(handleDeleteNote({ name: 'nonexistent.md' })).rejects.toThrow('Note not found');
    });
  });

  describe('agent workflow tools', () => {
    it('builds deterministic flat workflow files from tasks', () => {
      const files = buildAgentWorkflowFiles({
        folder: 'noted',
        workflow_id: 'WF001',
        title: 'Agent Runtime',
        goal: 'Create a file-first workflow',
        approval_mode: 'review',
        tasks: [
          { id: 'T001', title: 'Schema' },
          { id: 'T001.1', title: 'Events', parent_id: 'T001', depends_on: ['T001'] },
        ],
      });

      expect(files.map(f => f.name)).toEqual([
        'noted/wf-WF001-agent-runtime.md',
        'noted/task-T001-schema.md',
        'noted/task-T001.1-events.md',
        'noted/runs-WF001.md',
        'noted/reviews-WF001.md',
        'noted/output-WF001.md',
      ]);
      expect(files[0].content).toContain('"approvalMode": "review"');
      expect(files[0].content).toContain('"parentId": "T001"');
    });

    it('creates workflow scaffold notes', async () => {
      const res = await handleCreateAgentWorkflow({
        folder: 'noted',
        workflow_id: 'WF001',
        title: 'Agent Runtime',
        goal: 'Create a file-first workflow',
        tasks: [{ id: 'T001', title: 'Schema' }],
      });

      expect(res.content[0].text).toContain('Agent workflow created with 5 notes');
      expect(mockFiles.has('/mockdir/noted/wf-WF001-agent-runtime.md')).toBe(true);
      expect(mockFiles.has('/mockdir/noted/task-T001-schema.md')).toBe(true);
      expect(mockFiles.get('/mockdir/noted/wf-WF001-agent-runtime.md')?.content).toContain('Agent Metadata');
      expect(mockFiles.get('/mockdir/noted/wf-WF001-agent-runtime.md')?.content).toContain('"type": "workflow"');
    });

    it('does not overwrite existing workflow scaffold notes', async () => {
      mockFiles.set('/mockdir/noted/wf-WF001-agent-runtime.md', {
        content: '<p>Existing</p>',
        mtime: new Date(),
        size: 15,
      });

      await expect(handleCreateAgentWorkflow({
        folder: 'noted',
        workflow_id: 'WF001',
        title: 'Agent Runtime',
        goal: 'Create a file-first workflow',
      })).rejects.toThrow('Agent workflow scaffold already exists');
    });

    it('appends structured agent events', async () => {
      mockFiles.set('/mockdir/noted/task-T001-schema.md', {
        content: '<h1>T001 Schema</h1>',
        mtime: new Date(),
        size: 20,
      });

      const res = await handleAppendAgentEvent({
        name: 'noted/task-T001-schema.md',
        event_type: 'TaskStatusChanged',
        actor: 'codex',
        node_id: 'T001',
        status: 'review',
        summary: 'Implementation ready for review',
        details: { tests: 'passed' },
      });

      expect(res.content[0].text).toContain('TaskStatusChanged');
      const content = mockFiles.get('/mockdir/noted/task-T001-schema.md')?.content ?? '';
      expect(content).toContain('<h2>Event TaskStatusChanged</h2>');
      expect(content).toContain('"status": "review"');
      expect(content).toContain('"tests": "passed"');
    });
  });

  describe('getArgValue', () => {
    it('parses space-separated and equals-separated flags', () => {
      const originalArgv = [...process.argv];
      process.argv = ['node', 'index.js', '--test-flag=val1', '--other-flag', 'val2'];
      expect(getArgValue('--test-flag')).toBe('val1');
      expect(getArgValue('--other-flag')).toBe('val2');
      expect(getArgValue('--nonexistent')).toBeUndefined();
      process.argv = originalArgv;
    });
  });

  describe('main entry point', () => {
    it('starts stdio transport by default', async () => {
      const connectSpy = vi.spyOn(Server.prototype, 'connect').mockResolvedValue(undefined as any);
      const originalArgv = [...process.argv];
      process.argv = ['node', 'index.js', '--notes-dir=/mockdir'];
      await main();
      expect(connectSpy).toHaveBeenCalled();
      connectSpy.mockRestore();
      process.argv = originalArgv;
    });

    it('starts sse transport and handles HTTP requests', async () => {
      const http = await import('node:http');
      const connectSpy = vi.spyOn(Server.prototype, 'connect').mockResolvedValue(undefined as any);
      const originalArgv = [...process.argv];
      process.argv = ['node', 'index.js', '--notes-dir=/mockdir', '--transport=sse', '--port=8080'];
      
      await main();
      
      expect(http.createServer).toHaveBeenCalled();
      expect(mockHttpServer.listen).toHaveBeenCalledWith(8080, '127.0.0.1', expect.any(Function));
      
      expect(httpHandler).not.toBeNull();

      // Test Token Auth block when token is missing but configured
      process.argv = ['node', 'index.js', '--notes-dir=/mockdir', '--transport=sse', '--port=8080', '--auth-token=supersecret'];
      // re-trigger main to re-parse argv and re-create http server
      await main();

      const mockReqGetNoToken = { method: 'GET', url: '/sse', headers: {} } as any;
      const mockResGetNoToken = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() } as any;
      await httpHandler(mockReqGetNoToken, mockResGetNoToken);
      expect(mockResGetNoToken.writeHead).toHaveBeenCalledWith(401);

      // Test Token Auth passes when token is provided in query
      const mockReqGetWithQueryToken = { method: 'GET', url: '/sse?token=supersecret', headers: {} } as any;
      const mockResGetWithQueryToken = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() } as any;
      await httpHandler(mockReqGetWithQueryToken, mockResGetWithQueryToken);
      expect(mockResGetWithQueryToken.writeHead).not.toHaveBeenCalledWith(401);

      // Restore argv for non-token tests
      process.argv = ['node', 'index.js', '--notes-dir=/mockdir', '--transport=sse', '--port=8080'];
      await main();
      
      // 1. OPTIONS request — a local-origin CORS preflight is reflected, never '*'
      const mockReqOptions = { method: 'OPTIONS', url: '/sse', headers: { origin: 'http://localhost:8080', host: 'localhost:8080' } } as any;
      const mockResOptions = {
        setHeader: vi.fn(),
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any;
      await httpHandler(mockReqOptions, mockResOptions);
      expect(mockResOptions.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost:8080');
      expect(mockResOptions.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(mockResOptions.writeHead).toHaveBeenCalledWith(200);
      expect(mockResOptions.end).toHaveBeenCalled();

      // 1b. DNS-rebinding defense: a non-local Host is rejected with 403
      const mockReqRebind = { method: 'GET', url: '/sse', headers: { host: 'evil.example.com' } } as any;
      const mockResRebind = { setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() } as any;
      await httpHandler(mockReqRebind, mockResRebind);
      expect(mockResRebind.writeHead).toHaveBeenCalledWith(403);

      // 1c. A cross-origin browser request is rejected with 403 even from a local Host
      const mockReqXOrigin = { method: 'GET', url: '/sse', headers: { origin: 'https://evil.example.com', host: 'localhost:8080' } } as any;
      const mockResXOrigin = { setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() } as any;
      await httpHandler(mockReqXOrigin, mockResXOrigin);
      expect(mockResXOrigin.writeHead).toHaveBeenCalledWith(403);

      // 2. GET /sse request
      sseTransportInstances = [];
      const mockReqGet = { method: 'GET', url: '/sse', headers: {} } as any;
      const mockResGet = {
        setHeader: vi.fn(),
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any;
      await httpHandler(mockReqGet, mockResGet);
      expect(connectSpy).toHaveBeenCalled();

      // 3. Trigger transport close on the GET session
      if (sseTransportInstances[0]?.onclose) {
        sseTransportInstances[0].onclose();
      }

      // 4. POST /messages request (missing sessionId)
      const mockReqPostNoSession = { method: 'POST', url: '/messages', headers: {} } as any;
      const mockResPostNoSession = {
        setHeader: vi.fn(),
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any;
      await httpHandler(mockReqPostNoSession, mockResPostNoSession);
      expect(mockResPostNoSession.writeHead).toHaveBeenCalledWith(400);

      // 5. POST /messages request (session not found)
      const mockReqPostSessionNotFound = { method: 'POST', url: '/messages?sessionId=abc', headers: {} } as any;
      const mockResPostSessionNotFound = {
        setHeader: vi.fn(),
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any;
      await httpHandler(mockReqPostSessionNotFound, mockResPostSessionNotFound);
      expect(mockResPostSessionNotFound.writeHead).toHaveBeenCalledWith(404);

      // Re-create GET /sse session to test valid POST
      sseTransportInstances = [];
      await httpHandler(mockReqGet, mockResGet);

      // 6. POST /messages request (success)
      const mockReqPostSuccess = { method: 'POST', url: '/messages?sessionId=mock-session-id', headers: {} } as any;
      const mockResPostSuccess = {
        setHeader: vi.fn(),
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any;
      await httpHandler(mockReqPostSuccess, mockResPostSuccess);
      expect(sseTransportInstances[0].handlePostMessage).toHaveBeenCalled();

      // 7. POST /messages request (error handling)
      sseTransportInstances[0].handlePostMessage.mockRejectedValueOnce(new Error('Post error'));
      const mockReqPostError = { method: 'POST', url: '/messages?sessionId=mock-session-id', headers: {} } as any;
      const mockResPostError = {
        setHeader: vi.fn(),
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any;
      await httpHandler(mockReqPostError, mockResPostError);

      // 8. 404 handler
      const mockReq404 = { method: 'GET', url: '/invalid', headers: {} } as any;
      const mockRes404 = {
        setHeader: vi.fn(),
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any;
      await httpHandler(mockReq404, mockRes404);
      expect(mockRes404.writeHead).toHaveBeenCalledWith(404);

      connectSpy.mockRestore();
      process.argv = originalArgv;
    });
  });
});

describe('MCP server additional coverage', () => {
  beforeEach(() => {
    mockFiles.clear();
  });

  it('wraps unexpected errors in CallToolRequestSchema handler', async () => {
    const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
    vi.resetModules();
    const setRequestHandlerSpy = vi.spyOn(Server.prototype, 'setRequestHandler');
    // Import again using cachebust to trigger setRequestHandler calls
    await import('./index?cachebust=1');
    
    // Find the call for CallToolRequestSchema
    const callToolCall = setRequestHandlerSpy.mock.calls.find(
      (call) => call[0] === CallToolRequestSchema
    );
    expect(callToolCall).toBeDefined();
    const handler = callToolCall![1];

    const fsModule = await import('node:fs');
    const readSpy = vi.spyOn(fsModule, 'readFileSync').mockImplementationOnce(() => {
      throw new Error('Unexpected Disk Crash');
    });

    // Make safeNotePath succeed
    mockFiles.set('/mockdir/crash.md', { content: 'test', mtime: new Date(), size: 4 });

    const mockRequest = {
      method: 'tools/call',
      params: {
        name: 'read_note',
        arguments: { name: 'crash.md' }
      }
    };

    await expect(handler(mockRequest)).rejects.toThrow('Unexpected Disk Crash');

    readSpy.mockRestore();
    setRequestHandlerSpy.mockRestore();
  });

  it('prints a warning if NOTES_DIR does not exist', async () => {
    vi.resetModules();
    const originalArgv = [...process.argv];
    process.argv = ['node', 'index.js', '--notes-dir=/nonexistent-path-12345'];
    
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const connectSpy = vi.spyOn(Server.prototype, 'connect').mockResolvedValue(undefined as any);
    
    const { main: localMain } = await import('./index?cachebust=2');
    await localMain();
    
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining('WARNING: notes directory does not exist yet')
    );
    
    writeSpy.mockRestore();
    connectSpy.mockRestore();
    process.argv = originalArgv;
  });

  it('handles fatal main errors and exits gracefully', async () => {
    vi.resetModules();
    const originalArgv = [...process.argv];
    process.argv = ['node', 'index.js', '--notes-dir=/mockdir'];
    
    const connectSpy = vi.spyOn(Server.prototype, 'connect').mockRejectedValue(new Error('Fatal Bootstrap Error'));
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null | undefined) => {
      return undefined as never;
    });
    
    await import('./index?cachebust=3');
    
    // Wait a tick for the microtask queue to process the catch block
    await new Promise(resolve => setTimeout(resolve, 10));
    
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining('[noted-mcp] fatal: Fatal Bootstrap Error')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    
    connectSpy.mockRestore();
    writeSpy.mockRestore();
    exitSpy.mockRestore();
    process.argv = originalArgv;
  });

  it('falls back to path.resolve when realpathSync throws in safeNotePath', async () => {
    const fsModule = await import('node:fs');
    const realpathSpy = vi.spyOn(fsModule, 'realpathSync').mockImplementationOnce(() => {
      throw new Error('FileSystem error');
    });
    mockFiles.set('/mockdir/fallback.md', { content: 'test', mtime: new Date(), size: 4 });
    const pathResult = safeNotePath('fallback.md');
    expect(pathResult).toBe('/mockdir/fallback.md');
    realpathSpy.mockRestore();
  });

  it('ignores unreadable directories in listAllNotes', async () => {
    const fsModule = await import('node:fs');
    const readdirSpy = vi.spyOn(fsModule, 'readdirSync').mockImplementationOnce(() => {
      throw new Error('Unreadable directory');
    });
    const result = handleListNotes({});
    await expect(result).resolves.toBeDefined();
    readdirSpy.mockRestore();
  });

  it('preserves YAML frontmatter from markdown content in an HTML comment', () => {
    const md = '---\ntitle: Test Note\ntags: [test]\n---\n# Actual Content';
    const html = toHtml(md);
    expect(html).toContain('<!--noted-frontmatter:');
    expect(decodeURIComponent(html.match(/<!--noted-frontmatter:([\s\S]*?)-->/)?.[1] ?? '')).toContain('title: Test Note');
    expect(html).toContain('<h1>Actual Content</h1>');
  });

  it('returns excerpt start when query is not found', () => {
    const text = 'This is some text content for the note';
    const snip = excerpt(text, 'missing');
    expect(snip).toBe('This is some text content for the note…');
  });

  it('resolves notes directory using --notes-dir=path syntax', async () => {
    vi.resetModules();
    const originalArgv = [...process.argv];
    process.argv = ['node', 'index.js', '--notes-dir=/custom-equals-dir'];
    
    const { safeNotePath: localSafeNotePath } = await import('./index?cachebust=4');
    expect(localSafeNotePath('note.md')).toBe('/custom-equals-dir/note.md');
    
    process.argv = originalArgv;
  });

  it('auto-detects macOS Library path if --notes-dir is omitted', async () => {
    const path = await import('node:path');
    const os = await import('node:os');
    vi.resetModules();
    const originalArgv = [...process.argv];
    process.argv = ['node', 'index.js'];
    
    const home = os.homedir();
    const firstCandidate = path.join(home, 'Library', 'Application Support', 'Noted', 'notes');
    
    const fsModule = await import('node:fs');
    const existsSpy = vi.spyOn(fsModule, 'existsSync').mockImplementation((p) => {
      if (String(p) === firstCandidate) return true;
      return false;
    });
    
    const { safeNotePath: localSafeNotePath } = await import('./index?cachebust=5');
    expect(localSafeNotePath('note.md')).toBe(path.join(firstCandidate, 'note.md'));
    
    existsSpy.mockRestore();
    process.argv = originalArgv;
  });

  it('falls back to Documents path if Library path does not exist', async () => {
    const path = await import('node:path');
    const os = await import('node:os');
    vi.resetModules();
    const originalArgv = [...process.argv];
    process.argv = ['node', 'index.js'];
    
    const home = os.homedir();
    const secondCandidate = path.join(home, 'Documents', 'Noted');
    
    const fsModule = await import('node:fs');
    const existsSpy = vi.spyOn(fsModule, 'existsSync').mockImplementation((p) => {
      if (String(p) === secondCandidate) return true;
      return false;
    });
    
    const { safeNotePath: localSafeNotePath } = await import('./index?cachebust=6');
    expect(localSafeNotePath('note.md')).toBe(path.join(secondCandidate, 'note.md'));
    
    existsSpy.mockRestore();
    process.argv = originalArgv;
  });

  it('rejects empty segments in validateNoteName', () => {
    expect(() => validateNoteName('.md')).toThrow('segment cannot be empty');
    expect(() => validateNoteName('folder/.md')).toThrow('segment cannot be empty');
  });

  it('handles safeNotePath when parent directory does not exist', () => {
    const pathResult = safeNotePath('nonexistentfolder/note.md');
    expect(pathResult).toBe('/mockdir/nonexistentfolder/note.md');
  });

  it('returns undefined if space-separated flag has no value in getArgValue', () => {
    const originalArgv = [...process.argv];
    process.argv = ['node', 'index.js', '--notes-dir'];
    expect(getArgValue('--notes-dir')).toBeUndefined();
    process.argv = originalArgv;
  });

  it('returns empty array in listAllNotes if NOTES_DIR does not exist', async () => {
    const fsModule = await import('node:fs');
    const existsSpy = vi.spyOn(fsModule, 'existsSync').mockImplementation((p) => {
      if (String(p) === '/mockdir') return false;
      return true;
    });
    const result = await handleListNotes({});
    expect(result.content[0].text).toContain('No notes found.');
    existsSpy.mockRestore();
  });

  it('covers all tool switch cases in the CallToolRequestSchema handler', async () => {
    const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
    vi.resetModules();
    const setRequestHandlerSpy = vi.spyOn(Server.prototype, 'setRequestHandler');
    await import('./index?cachebust=7');
    
    const callToolCall = setRequestHandlerSpy.mock.calls.find(
      (call) => call[0] === CallToolRequestSchema
    );
    expect(callToolCall).toBeDefined();
    const handler = callToolCall![1];

    // mock list_notes
    const listRes = await handler({
      method: 'tools/call',
      params: { name: 'list_notes', arguments: {} }
    });
    expect(listRes).toBeDefined();

    // mock create_note
    mockFiles.clear();
    const createRes = await handler({
      method: 'tools/call',
      params: { name: 'create_note', arguments: { name: 'new.md', content: 'hello' } }
    });
    expect(createRes).toBeDefined();

    // mock update_note
    const updateRes = await handler({
      method: 'tools/call',
      params: { name: 'update_note', arguments: { name: 'new.md', content: 'updated' } }
    });
    expect(updateRes).toBeDefined();

    // mock search_notes
    const searchRes = await handler({
      method: 'tools/call',
      params: { name: 'search_notes', arguments: { query: 'updated' } }
    });
    expect(searchRes).toBeDefined();

    // mock delete_note
    const deleteRes = await handler({
      method: 'tools/call',
      params: { name: 'delete_note', arguments: { name: 'new.md' } }
    });
    expect(deleteRes).toBeDefined();

    // mock default unknown tool
    await expect(handler({
      method: 'tools/call',
      params: { name: 'unknown_tool', arguments: {} }
    })).rejects.toThrow('Unknown tool: unknown_tool');

    setRequestHandlerSpy.mockRestore();
  });

  it('wraps string errors in CallToolRequestSchema handler', async () => {
    const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
    vi.resetModules();
    const setRequestHandlerSpy = vi.spyOn(Server.prototype, 'setRequestHandler');
    await import('./index?cachebust=8');
    
    const callToolCall = setRequestHandlerSpy.mock.calls.find(
      (call) => call[0] === CallToolRequestSchema
    );
    expect(callToolCall).toBeDefined();
    const handler = callToolCall![1];

    const fsModule = await import('node:fs');
    const readSpy = vi.spyOn(fsModule, 'readFileSync').mockImplementationOnce(() => {
      throw 'string-based-error';
    });

    mockFiles.set('/mockdir/crash.md', { content: 'test', mtime: new Date(), size: 4 });

    const mockRequest = {
      method: 'tools/call',
      params: {
        name: 'read_note',
        arguments: { name: 'crash.md' }
      }
    };

    await expect(handler(mockRequest)).rejects.toThrow('string-based-error');

    readSpy.mockRestore();
    setRequestHandlerSpy.mockRestore();
  });

  it('starts sse transport defaulting to port 3000 if --port is omitted', async () => {
    const connectSpy = vi.spyOn(Server.prototype, 'connect').mockResolvedValue(undefined as any);
    const originalArgv = [...process.argv];
    process.argv = ['node', 'index.js', '--notes-dir=/mockdir', '--transport=sse'];
    
    const { main: localMain } = await import('./index?cachebust=9');
    await localMain();
    
    expect(mockHttpServer.listen).toHaveBeenCalledWith(3000, '127.0.0.1', expect.any(Function));
    
    connectSpy.mockRestore();
    process.argv = originalArgv;
  });

  it('handles SSE request with undefined url or host', async () => {
    const originalArgv = [...process.argv];
    process.argv = ['node', 'index.js', '--notes-dir=/mockdir', '--transport=sse'];
    const connectSpy = vi.spyOn(Server.prototype, 'connect').mockResolvedValue(undefined as any);
    
    await main();
    
    const mockReq = { method: 'GET', url: undefined, headers: { host: undefined } } as any;
    const mockRes = {
      setHeader: vi.fn(),
      writeHead: vi.fn(),
      end: vi.fn(),
    } as any;
    
    await httpHandler(mockReq, mockRes);
    expect(mockRes.writeHead).toHaveBeenCalledWith(404);
    
    connectSpy.mockRestore();
    process.argv = originalArgv;
  });

  it('handles fatal main string errors and exits gracefully', async () => {
    vi.resetModules();
    const originalArgv = [...process.argv];
    process.argv = ['node', 'index.js', '--notes-dir=/mockdir'];
    
    const connectSpy = vi.spyOn(Server.prototype, 'connect').mockRejectedValue('Fatal String Error');
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null | undefined) => {
      return undefined as never;
    });
    
    await import('./index?cachebust=10');
    
    await new Promise(resolve => setTimeout(resolve, 10));
    
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining('[noted-mcp] fatal: Fatal String Error')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    
    connectSpy.mockRestore();
    writeSpy.mockRestore();
    exitSpy.mockRestore();
    process.argv = originalArgv;
  });

  it('creates a note in a new subfolder triggering directory creation (mkdirSync)', async () => {
    const res = await handleCreateNote({ name: 'Nuovo/note.md', content: 'new content' });
    expect(res.content[0].text).toContain('Note created: Nuovo/note.md');
    expect(mockFiles.has('/mockdir/Nuovo/note.md')).toBe(true);
  });

  it('ignores hidden folders and nested subfolders more than one level deep in listAllNotes', async () => {
    mockFiles.set('/mockdir/.hidden/note.md', { content: 'hidden', mtime: new Date(), size: 6 });
    mockFiles.set('/mockdir/Lavoro/nested/note.md', { content: 'nested', mtime: new Date(), size: 6 });
    mockFiles.set('/mockdir/Lavoro/note.md', { content: 'lavoro', mtime: new Date(), size: 6 });

    const res = await handleListNotes({});
    expect(res.content[0].text).toContain('Lavoro/note.md');
    expect(res.content[0].text).not.toContain('.hidden/note.md');
    expect(res.content[0].text).not.toContain('Lavoro/nested/note.md');
  });

  describe('excerpt formatting', () => {
    it('formats excerpt with prefix and suffix ellipsis when query is in the middle of long text', () => {
      const longText = 'a'.repeat(50) + 'keyword' + 'b'.repeat(100);
      const snip = excerpt(longText, 'keyword');
      expect(snip).toBe('…' + 'a'.repeat(40) + 'keyword' + 'b'.repeat(80) + '…');
    });

    it('formats excerpt with prefix ellipsis but no suffix ellipsis when query is near the end', () => {
      const longText = 'a'.repeat(100) + 'keyword';
      const snip = excerpt(longText, 'keyword');
      expect(snip).toBe('…' + 'a'.repeat(40) + 'keyword');
    });

    it('formats excerpt with no prefix ellipsis but with suffix ellipsis when query is near the start', () => {
      const longText = 'keyword' + 'b'.repeat(100);
      const snip = excerpt(longText, 'keyword');
      expect(snip).toBe('keyword' + 'b'.repeat(80) + '…');
    });
  });

  describe('resolveNotesDir function direct tests', () => {
    it('resolves using space-separated argument', () => {
      const originalArgv = [...process.argv];
      process.argv = ['node', 'index.js', '--notes-dir', '/space-dir'];
      expect(resolveNotesDir()).toBe(path.resolve('/space-dir'));
      process.argv = originalArgv;
    });

    it('resolves using auto-detect macOS Library path', () => {
      const originalArgv = [...process.argv];
      process.argv = ['node', 'index.js'];
      const home = os.homedir();
      const firstCandidate = path.join(home, 'Library', 'Application Support', 'Noted', 'notes');
      const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        if (String(p) === firstCandidate) return true;
        return false;
      });
      expect(resolveNotesDir()).toBe(firstCandidate);
      existsSpy.mockRestore();
      process.argv = originalArgv;
    });

    it('resolves using auto-detect macOS Documents path fallback', () => {
      const originalArgv = [...process.argv];
      process.argv = ['node', 'index.js'];
      const home = os.homedir();
      const secondCandidate = path.join(home, 'Documents', 'Noted');
      const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        if (String(p) === secondCandidate) return true;
        return false;
      });
      expect(resolveNotesDir()).toBe(secondCandidate);
      existsSpy.mockRestore();
      process.argv = originalArgv;
    });

    it('falls back to macOS Library path if neither candidate exists', () => {
      const originalArgv = [...process.argv];
      process.argv = ['node', 'index.js'];
      const home = os.homedir();
      const firstCandidate = path.join(home, 'Library', 'Application Support', 'Noted', 'notes');
      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      expect(resolveNotesDir()).toBe(firstCandidate);
      existsSpy.mockRestore();
      process.argv = originalArgv;
    });
  });

  it('calls the ListToolsRequestSchema handler', async () => {
    const { ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
    vi.resetModules();
    const setRequestHandlerSpy = vi.spyOn(Server.prototype, 'setRequestHandler');
    await import('./index?cachebust=11');
    
    const listToolsCall = setRequestHandlerSpy.mock.calls.find(
      (call) => call[0] === ListToolsRequestSchema
    );
    expect(listToolsCall).toBeDefined();
    const handler = listToolsCall![1];
    const res = await handler({});
    expect(res).toEqual({ tools: expect.any(Array) });
    
    setRequestHandlerSpy.mockRestore();
  });
});
