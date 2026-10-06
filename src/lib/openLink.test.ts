import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openLinkValue } from './openLink';
import { useStore } from '../store/useStore';

const note = (name: string) => ({ name, path: name, stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } });
const original = { openNote: useStore.getState().openNote, createTitledNote: useStore.getState().createTitledNote };
let openNote: ReturnType<typeof vi.fn>;
let createTitledNote: ReturnType<typeof vi.fn>;

beforeEach(() => {
  openNote = vi.fn(async () => undefined);
  createTitledNote = vi.fn(async () => undefined);
  useStore.setState({
    openNote, createTitledNote, pendingAnchor: null, activeNoteName: 'Work/Plan.md',
    notes: [note('Home.md'), note('Work/Plan.md'), note('Work/Notes/Risks.md')], noteAliasesIndex: { 'Home.md': ['Start'] },
  });
});
afterEach(() => { useStore.setState(original); });

describe('openLinkValue', () => {
  it('opens the note a link names, by name, alias or a folder-less name, in any case', async () => {
    await openLinkValue('[[home]]');
    expect(openNote).toHaveBeenLastCalledWith('Home.md');
    await openLinkValue('[[Start]]');
    expect(openNote).toHaveBeenLastCalledWith('Home.md');
    await openLinkValue('[[risks]]');
    expect(openNote).toHaveBeenLastCalledWith('Work/Notes/Risks.md');
    expect(createTitledNote).not.toHaveBeenCalled();
  });

  it('goes to the heading or block the link names', async () => {
    await openLinkValue('[[Home#Setup]]');
    expect(useStore.getState().pendingAnchor).toEqual({ note: 'Home.md', heading: 'Setup', block: undefined });
    await openLinkValue('[[Home#^abc]]');
    expect(useStore.getState().pendingAnchor).toEqual({ note: 'Home.md', heading: undefined, block: 'abc' });
  });

  it('makes the note when there is none, like a link in the text', async () => {
    await openLinkValue('[[Brand new]]');
    expect(createTitledNote).toHaveBeenCalledWith('Brand new');
    expect(openNote).not.toHaveBeenCalled();
  });

  it('ignores a value that is not a link', async () => {
    await openLinkValue('plain');
    expect(openNote).not.toHaveBeenCalled();
    expect(createTitledNote).not.toHaveBeenCalled();
  });
});
