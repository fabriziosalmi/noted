import { describe, it, expect } from 'vitest';
import { planExternalChange, otherVersionName, type LoadedNote } from './externalChange';

const note = (content: string, frontmatter: string | null = null): LoadedNote => ({ content, frontmatter });

describe('planExternalChange', () => {
  const loaded = note('<p>mine</p>');
  const typing = { content: '<p>mine, plus new typing</p>' };

  it('ignores a disk state identical to what the editor loaded (a touch, our own save echo)', () => {
    expect(planExternalChange({ disk: note('<p>mine</p>'), loaded, unsaved: null })).toEqual({ kind: 'ignore' });
    // Even mid-typing: nothing changed on disk, so nothing to preserve.
    expect(planExternalChange({ disk: note('<p>mine</p>'), loaded, unsaved: typing })).toEqual({ kind: 'ignore' });
  });

  it('reloads when disk changed and the user has nothing unsaved', () => {
    const disk = note('<p>from the other device</p>');
    expect(planExternalChange({ disk, loaded, unsaved: null })).toEqual({ kind: 'reload', disk });
  });

  it('keeps both versions when disk changed while the user has unsaved typing', () => {
    const disk = note('<p>from the other device</p>');
    expect(planExternalChange({ disk, loaded, unsaved: typing })).toEqual({ kind: 'keep-both' });
  });

  it('does not invent a conflict when the disk already holds the buffer being saved', () => {
    // Our own autosave landed between the watcher event and the read.
    expect(planExternalChange({ disk: note(typing.content), loaded, unsaved: typing })).toEqual({ kind: 'ignore' });
  });

  it('treats a frontmatter-only change as a change', () => {
    expect(planExternalChange({ disk: note('<p>mine</p>', 'tags: [a]'), loaded, unsaved: null }).kind).toBe('reload');
  });

  it('reports a missing file without touching the buffer', () => {
    expect(planExternalChange({ disk: null, loaded, unsaved: typing })).toEqual({ kind: 'missing' });
    expect(planExternalChange({ disk: null, loaded, unsaved: null })).toEqual({ kind: 'missing' });
  });
});

describe('otherVersionName', () => {
  it('appends "(other version)" before the extension', () => {
    expect(otherVersionName('Plan.md', [])).toBe('Plan (other version).md');
  });

  it('keeps the folder and handles dots in the name', () => {
    expect(otherVersionName('Work/v1.2 notes.md', [])).toBe('Work/v1.2 notes (other version).md');
  });

  it('numbers the copy when one already exists, case-insensitively', () => {
    expect(otherVersionName('Plan.md', ['plan (OTHER version).md'])).toBe('Plan (other version 2).md');
    expect(otherVersionName('Plan.md', ['Plan (other version).md', 'Plan (other version 2).md'])).toBe('Plan (other version 3).md');
  });

  it('never returns a name that is already taken', () => {
    const taken = new Set(['A (other version).md']);
    expect(taken.has(otherVersionName('A.md', taken))).toBe(false);
  });
});
