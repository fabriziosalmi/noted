import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { Table } from '@tiptap/extension-table';
import { Link } from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import { documentExtensions, withCodeInfo } from '../../shared/markdown/schema';
import { normalizeMarkdown } from '../../shared/markdown/codec';
import { extractHtmlFrontmatterComment, prependFrontmatterComment } from '../../shared/markdown/frontmatter';
import { GOLDEN } from '../../shared/markdown/golden';
import { WikilinkMark } from './WikilinkExtension';
import { canonicalWire, diskToWire, forgetVaultFormat, peekVaultFormat, vaultFormatOf, wireToDisk } from './noteIo';
import { getElectronApi } from './electronApi';

// The editor as the app builds it (see NoteEditor.tsx), minus the pieces that only matter on screen.
function makeEditor(content = ''): Editor {
  return new Editor({
    extensions: documentExtensions({
      codeBlock: withCodeInfo(CodeBlockLowlight.configure({ lowlight: createLowlight(common) })),
      table: Table.configure({ resizable: true }),
      link: Link.configure({ openOnClick: true, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }),
      wikilink: WikilinkMark,
    }),
    content,
    parseOptions: { preserveWhitespace: 'full' },
  });
}

describe('a Markdown note through the editor and back', () => {
  // The guarantee that matters to a user: open a Markdown note, change nothing, and what is saved is the note.
  it.each(GOLDEN.map((c) => [`${c[0]}/${c[1]}`, c[2]] as const))('%s', (_id, markdown) => {
    // As the app does: the frontmatter travels beside the editor (in the store), only the body is edited.
    const { frontmatter, body } = extractHtmlFrontmatterComment(diskToWire(markdown, 'markdown'));
    const editor = makeEditor();
    editor.commands.setContent(body, { parseOptions: { preserveWhitespace: 'full' } });
    const saved = wireToDisk(prependFrontmatterComment(editor.getHTML(), frontmatter), 'markdown');
    editor.destroy();
    expect(saved).toBe(normalizeMarkdown(markdown));
  });

  it('keeps the frontmatter byte for byte, through the HTML comment the app carries it in', () => {
    const md = '---\n# a comment the user wrote\nkey:   spaced\nlist:\n  - x\n---\n\n# Title\n\nBody.\n';
    const wire = diskToWire(md, 'markdown');
    expect(wire).toMatch(/^<!--noted-frontmatter:/);
    expect(wireToDisk(wire, 'markdown')).toBe(md);
  });
});

describe('HTML vaults are untouched', () => {
  it('passes text through both ways', () => {
    const html = '<!--noted-frontmatter:abc-->\n<h1>T</h1><p>x &amp; y</p>';
    expect(diskToWire(html, 'html')).toBe(html);
    expect(wireToDisk(html, 'html')).toBe(html);
    expect(canonicalWire(html, 'html')).toBe(html);
  });
});

describe('canonicalWire', () => {
  it('is what the editor would read back, and idempotent', () => {
    const editor = makeEditor('<h1>Plan</h1><p>See <a href="https://x.io" rel="noopener noreferrer nofollow" target="_blank">x</a> and <strong>bold</strong></p>');
    const once = canonicalWire(editor.getHTML(), 'markdown');
    editor.destroy();
    expect(canonicalWire(once, 'markdown')).toBe(once);
  });

  it('calls two prints of the same note equal', () => {
    const fromEditor = '<p>a <a href="https://x.io" rel="noopener noreferrer nofollow" target="_blank">link</a></p>';
    const fromFile = diskToWire('a [link](https://x.io)\n', 'markdown');
    expect(canonicalWire(fromEditor, 'markdown')).toBe(canonicalWire(fromFile, 'markdown'));
  });
});

describe('the wrapped electron API', () => {
  afterEach(() => { forgetVaultFormat(); vi.restoreAllMocks(); });

  const install = (format: 'html' | 'markdown', disk: string) => {
    const saved: string[] = [];
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getVaultFormat: vi.fn().mockResolvedValue({ success: true, data: format }),
      readNote: vi.fn().mockResolvedValue({ success: true, data: disk }),
      readNoteSnapshot: vi.fn().mockResolvedValue({ success: true, data: disk }),
      saveNote: vi.fn(async (_n: string, content: string) => { saved.push(content); return { success: true }; }),
      getNotesList: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };
    return saved;
  };

  it('reads a Markdown vault as HTML and writes it back as Markdown', async () => {
    const saved = install('markdown', '# Title\n\nSome *text* with [[Link]].\n');
    const api = getElectronApi()!;
    const read = await api.readNote('a.md', undefined);
    expect(read.data).toBe('<h1>Title</h1><p>Some <em>text</em> with <span target="Link" data-wikilink="Link" class="wikilink">[[Link]]</span>.</p>');
    await api.saveNote('a.md', read.data as string, undefined);
    expect(saved).toEqual(['# Title\n\nSome *text* with [[Link]].\n']);
    expect(peekVaultFormat()).toBe('markdown');
  });

  it('works over a frozen API object, as contextBridge hands it over', async () => {
    const saved: string[] = [];
    window.electronAPI = Object.freeze({
      getVaultFormat: () => Promise.resolve({ success: true, data: 'markdown' as const }),
      readNote: () => Promise.resolve({ success: true, data: '# Frozen\n' }),
      saveNote: (_n: string, c: string) => { saved.push(c); return Promise.resolve({ success: true }); },
    }) as never;
    const api = getElectronApi()!;
    expect((await api.readNote('a.md', undefined)).data).toBe('<h1>Frozen</h1>');
    await api.saveNote('a.md', '<h1>Frozen</h1>', undefined);
    expect(saved).toEqual(['# Frozen\n']);
    expect('getVaultFormat' in api).toBe(true);
  });

  it('reads snapshots the same way', async () => {
    install('markdown', '- [ ] todo\n');
    const res = await getElectronApi()!.readNoteSnapshot('a.md', 's.html', undefined);
    expect(res.data).toContain('data-type="taskList"');
  });

  it('leaves an HTML vault alone, and asks the format once per vault', async () => {
    const saved = install('html', '<h1>T</h1>');
    const api = getElectronApi()!;
    expect((await api.readNote('a.md', undefined)).data).toBe('<h1>T</h1>');
    await api.saveNote('a.md', '<p>x</p>', undefined);
    await api.saveNote('b.md', '<p>y</p>', undefined);
    expect(saved).toEqual(['<p>x</p>', '<p>y</p>']);
    expect((window.electronAPI.getVaultFormat as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('treats a missing or failing format answer as HTML (an older main process, a mock)', async () => {
    expect(await vaultFormatOf({}, '/v')).toBe('html');
    expect(await vaultFormatOf({ getVaultFormat: () => Promise.reject(new Error('x')) }, '/w')).toBe('html');
    expect(await vaultFormatOf({ getVaultFormat: () => Promise.resolve({ success: false }) }, '/z')).toBe('html');
  });

  it('does not touch failed reads', async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getVaultFormat: vi.fn().mockResolvedValue({ success: true, data: 'markdown' }),
      readNote: vi.fn().mockResolvedValue({ success: false, error: 'nope' }),
    };
    expect(await getElectronApi()!.readNote('a.md', undefined)).toEqual({ success: false, error: 'nope' });
  });
});
