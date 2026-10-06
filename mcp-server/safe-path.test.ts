// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The MCP server's path confinement, on a real directory with real symbolic links (the mocked-fs tests of
// index.test.ts cannot make one). A write must never leave the vault, however deep the new file is.
let vault: string;
let outside: string;
let mcp: typeof import('./index'); // eslint-disable-line @typescript-eslint/consistent-type-imports
const argv = process.argv;

const linkOk = (target: string, link: string): boolean => {
  try { fs.symlinkSync(target, link, 'dir'); return true; } catch { return false; } // Windows without the privilege
};

beforeEach(async () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'noted-safe-')));
  vault = path.join(base, 'vault');
  outside = path.join(base, 'outside');
  fs.mkdirSync(vault);
  fs.mkdirSync(outside);
  process.argv = [argv[0], argv[1], '--notes-dir', vault];
  vi.resetModules();
  mcp = await import('./index');
});
afterEach(() => {
  process.argv = argv;
  fs.rmSync(path.dirname(vault), { recursive: true, force: true });
});

describe('safeNotePath on a real vault', () => {
  it('resolves notes at any depth, existing or not, inside the vault', () => {
    fs.mkdirSync(path.join(vault, 'a/b'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'a/b/n.md'), 'x');
    expect(mcp.safeNotePath('a/b/n.md')).toBe(path.join(vault, 'a/b/n.md'));
    expect(mcp.safeNotePath('a/b/new.md')).toBe(path.join(vault, 'a/b/new.md'));
    expect(mcp.safeNotePath('x/y/z/new.md')).toBe(path.join(vault, 'x/y/z/new.md')); // none of the folders exist yet
  });

  it('refuses a folder that is a link out of the vault, for an existing note, a new note, and a note in folders that do not exist yet', () => {
    fs.writeFileSync(path.join(outside, 'secret.md'), 'x');
    if (!linkOk(outside, path.join(vault, 'link'))) return;
    expect(() => mcp.safeNotePath('link/secret.md')).toThrow('Path traversal detected'); // exists
    expect(() => mcp.safeNotePath('link/new.md')).toThrow('Path traversal detected'); // parent is the link
    expect(() => mcp.safeNotePath('link/new/deeper/x.md')).toThrow('Path traversal detected'); // neither the file nor its parent exists
    expect(fs.existsSync(path.join(outside, 'new'))).toBe(false);
  });

  it('refuses a link at any level, and a link that points back into the vault is fine', () => {
    fs.mkdirSync(path.join(vault, 'a'));
    if (!linkOk(outside, path.join(vault, 'a/up'))) return;
    expect(() => mcp.safeNotePath('a/up/x/y.md')).toThrow('Path traversal detected');
    fs.mkdirSync(path.join(vault, 'real'));
    expect(linkOk(path.join(vault, 'real'), path.join(vault, 'alias'))).toBe(true);
    expect(mcp.safeNotePath('alias/n.md')).toBe(path.join(vault, 'real/n.md'));
  });

  it('refuses a link that points nowhere', () => {
    if (!linkOk(path.join(outside, 'does-not-exist'), path.join(vault, 'dangling'))) return;
    expect(() => mcp.safeNotePath('dangling/x.md')).toThrow('Path traversal detected');
  });

  it('create_note cannot be used to write through a link either', async () => {
    if (!linkOk(outside, path.join(vault, 'link'))) return;
    await expect(mcp.handleCreateNote({ name: 'link/new/deeper/x.md', content: 'x' })).rejects.toThrow('Path traversal detected');
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

describe('the MCP tools with nested folders', () => {
  const write = (rel: string, text = 'text') => {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  };

  it('create_note makes the folders it needs, at any depth, and refuses a hidden one', async () => {
    await mcp.handleCreateNote({ name: 'Work/Q4/Plans/new.md', content: '# New' });
    expect(fs.existsSync(path.join(vault, 'Work/Q4/Plans/new.md'))).toBe(true);
    await expect(mcp.handleCreateNote({ name: '.noted/trash/x.md', content: 'x' })).rejects.toThrow('Hidden names');
    await expect(mcp.handleCreateNote({ name: 'a/.git/x.md', content: 'x' })).rejects.toThrow('Hidden names');
  });

  it('list_notes lists every depth, and a folder means everything under it', async () => {
    write('Top.md');
    write('Work/Plan.md');
    write('Work/Q4/Goals.md');
    write('Work/Q4/Deep/Note.md');
    write('Life/Garden.md');
    write('.obsidian/x.md');
    const all = (await mcp.handleListNotes({})).content[0].text;
    for (const n of ['Top.md', 'Work/Plan.md', 'Work/Q4/Goals.md', 'Work/Q4/Deep/Note.md', 'Life/Garden.md']) expect(all, n).toContain(n);
    expect(all).not.toContain('.obsidian');
    const work = (await mcp.handleListNotes({ folder: 'Work' })).content[0].text;
    expect(work).toContain('Work/Q4/Deep/Note.md');
    expect(work).not.toContain('Life/Garden.md');
    const q4 = (await mcp.handleListNotes({ folder: 'Work/Q4' })).content[0].text;
    expect(q4).toContain('Work/Q4/Goals.md');
    expect(q4).not.toContain('Work/Plan.md');
    await expect(mcp.handleListNotes({ folder: '../outside' })).rejects.toThrow('Path traversal');
    await expect(mcp.handleListNotes({ folder: '.noted' })).rejects.toThrow('Hidden names');
  });

  it('a note deleted from any depth is in the trash list, and comes back to where it was', async () => {
    write('a/b/c/d/Deep.md', 'deep text');
    write('a/Shallow.md', 'shallow text');
    await mcp.handleDeleteNote({ name: 'a/b/c/d/Deep.md' });
    await mcp.handleDeleteNote({ name: 'a/Shallow.md' });
    expect(fs.existsSync(path.join(vault, 'a/b/c/d/Deep.md'))).toBe(false);
    const listed = (await mcp.handleListTrash()).content[0].text;
    expect(listed).toContain('a/b/c/d/Deep.md');
    expect(listed).toContain('a/Shallow.md');
    await mcp.handleRestoreNote({ name: 'a/b/c/d/Deep.md' });
    expect(fs.readFileSync(path.join(vault, 'a/b/c/d/Deep.md'), 'utf8')).toBe('deep text');
  });

  it('search finds a note at any depth', async () => {
    write('x/y/z/Deep.md', 'the zebra lives here');
    mcp.__resetSearchIndex();
    expect((await mcp.handleSearchNotes({ query: 'zebra' })).content[0].text).toContain('x/y/z/Deep.md');
  });
});
