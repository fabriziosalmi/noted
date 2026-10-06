// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MAX_FOLDER_DEPTH, MAX_PATH_CHARS, checkFolderPath, checkNotePath, dirnameOf, hasHiddenSegment } from './paths';

describe('checkNotePath', () => {
  it.each([
    'a.md', 'Folder/a.md', 'A/B/C/D/e.md', 'Café/venerdì.md', '📝 Nota.md', 'note (copy).md', "it's, ok & #1.md", 'a/[test] note.md',
    `${'d/'.repeat(MAX_FOLDER_DEPTH)}n.md`,
  ])('accepts %s', name => {
    expect(checkNotePath(name)).toBeNull();
  });

  it('refuses what is not a string, or is empty', () => {
    for (const v of [null, undefined, 42, {}, [], '']) expect(checkNotePath(v), String(v)).toMatch(/non-empty string/);
  });

  it('refuses traversal and absolute paths, however deep', () => {
    for (const v of ['../x.md', 'a/../b.md', 'a/b/../../c.md', '..\\x.md', 'a/..b.md']) expect(checkNotePath(v), v).toBe('Path traversal is not allowed');
    for (const v of ['/etc/passwd.md', 'C:/x.md', 'C:\\x.md', '\\\\server\\share\\x.md', '\\x.md']) expect(checkNotePath(v), v).toBe('Absolute paths are not allowed');
  });

  it('refuses a path with any hidden segment: history, trash, Git and Obsidian files are never notes', () => {
    for (const v of ['.noted/trash/2026/x.md', '.git/info/x.md', '.obsidian/plugins/x.md', 'A/.hidden/x.md', 'A/B/.x.md', '.noted_history/x.md/1.md', '.md']) {
      expect(checkNotePath(v), v).toMatch(/Hidden names|empty/);
    }
  });

  it('refuses names a filesystem would refuse', () => {
    for (const v of ['a/b:c.md', 'a/b*c.md', 'a?.md', 'a|b.md', 'a<b>.md', 'a;b.md', 'a$b.md', 'a`b.md', 'a\\b.md', 'a\u0000b.md']) expect(checkNotePath(v), v).toMatch(/^Invalid file name: contains reserved characters/);
    for (const v of ['con.md', 'A/NUL.md', 'lpt1.md', 'COM9/x.md']) expect(checkNotePath(v), v).toBe('Invalid file name: reserved device name');
    for (const v of ['a./x.md', 'a /x.md', 'x .md', 'x..md']) expect(checkNotePath(v), v).toBeTruthy();
    expect(checkNotePath('a//b.md')).toMatch(/empty/);
    expect(checkNotePath('a/ /b.md')).toMatch(/empty/);
  });

  it('wants .md, on the file only', () => {
    for (const v of ['a.txt', 'a', 'a.md.sh', 'A.md/b']) expect(checkNotePath(v), v).toBe('File must have .md extension');
    expect(checkNotePath('Folder.md/note.md')).toBeNull(); // a folder may be called anything
  });

  it('caps depth, total length and the length of one name (bytes, not characters)', () => {
    expect(checkNotePath(`${'d/'.repeat(MAX_FOLDER_DEPTH + 1)}n.md`)).toMatch(/at most 16 levels/);
    expect(checkNotePath(`${'a'.repeat(MAX_PATH_CHARS)}.md`)).toMatch(/too long/);
    expect(checkNotePath(`${'é'.repeat(130)}.md`)).toMatch(/name is too long/); // 260 bytes in 133 characters
    expect(checkNotePath(`${'a'.repeat(200)}.md`)).toMatch(/too long/);
  });
});

describe('checkFolderPath', () => {
  it('accepts a folder or a path of folders', () => {
    for (const v of ['Work', 'Work/Sub', 'a/b/c', 'Café', 'Folder.md']) expect(checkFolderPath(v), v).toBeNull();
  });

  it('applies the same rules, and does not want an extension', () => {
    expect(checkFolderPath('')).toMatch(/non-empty/);
    expect(checkFolderPath('   ')).toMatch(/non-empty/);
    expect(checkFolderPath('a/../b')).toBe('Path traversal is not allowed');
    expect(checkFolderPath('/abs')).toBe('Absolute paths are not allowed');
    expect(checkFolderPath('.obsidian')).toMatch(/Hidden/);
    expect(checkFolderPath('a/.git')).toMatch(/Hidden/);
    expect(checkFolderPath('a//b')).toMatch(/empty/);
    expect(checkFolderPath('a/')).toMatch(/empty/);
    expect(checkFolderPath('a:b')).toMatch(/^Invalid folder name: contains reserved characters/);
    expect(checkFolderPath('Com1')).toMatch(/device/);
    expect(checkFolderPath('d/'.repeat(MAX_FOLDER_DEPTH) + 'x')).toMatch(/at most/);
  });
});

describe('helpers', () => {
  it('dirnameOf', () => {
    expect(dirnameOf('a.md')).toBe('');
    expect(dirnameOf('A/B/c.md')).toBe('A/B');
  });
  it('hasHiddenSegment', () => {
    expect(hasHiddenSegment('A/B/c.md')).toBe(false);
    expect(hasHiddenSegment('A/.B/c.md')).toBe(true);
    expect(hasHiddenSegment('.noted/x.md')).toBe(true);
    expect(hasHiddenSegment('a.b/c.md')).toBe(false);
  });
});
