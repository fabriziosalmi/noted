// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent' }, BrowserWindow: class {}, Menu: {}, clipboard: {}, shell: {} }));

import { contextMenuTemplate, type ContextMenuActions } from './contextMenu';

const flags = { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: true };
const params = (over: Partial<Parameters<typeof contextMenuTemplate>[0]> = {}) => ({
  misspelledWord: '', dictionarySuggestions: [] as string[], isEditable: true, selectionText: '', editFlags: flags, linkURL: '', ...over,
});
const actions = (): ContextMenuActions & Record<string, ReturnType<typeof vi.fn>> => ({
  replaceMisspelling: vi.fn(), addToDictionary: vi.fn(), openLink: vi.fn(), copyLink: vi.fn(),
});
const labels = (t: ReturnType<typeof contextMenuTemplate>) => t.map(i => (i.type === 'separator' ? '---' : i.label));

describe('contextMenuTemplate', () => {
  it('offers the edit actions in an editable place', () => {
    expect(labels(contextMenuTemplate(params(), actions()))).toEqual(['Cut', 'Copy', 'Paste', 'Paste as Plain Text', '---', 'Select All']);
  });

  it('puts spelling suggestions first; picking one replaces the word, and the word can be added to the dictionary', () => {
    const a = actions();
    const t = contextMenuTemplate(params({ misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten', 'tech', 'tea', 'tee', 'toe'] }), a);
    expect(labels(t).slice(0, 7)).toEqual(['the', 'ten', 'tech', 'tea', 'tee', 'Add to Dictionary', '---']); // at most five
    (t[0].click as () => void)();
    expect(a.replaceMisspelling).toHaveBeenCalledWith('the');
    (t[5].click as () => void)();
    expect(a.addToDictionary).toHaveBeenCalledWith('teh');
  });

  it('says so when a misspelled word has no suggestion', () => {
    const t = contextMenuTemplate(params({ misspelledWord: 'qzxv' }), actions());
    expect(t[0]).toMatchObject({ label: 'No suggestions', enabled: false });
  });

  it('offers a web link’s actions, and nothing for an in-app link', () => {
    const a = actions();
    const t = contextMenuTemplate(params({ isEditable: false, linkURL: 'https://example.com/a' }), a);
    expect(labels(t)).toEqual(['Open Link', 'Copy Link']);
    (t[1].click as () => void)();
    expect(a.copyLink).toHaveBeenCalledWith('https://example.com/a');
    expect(contextMenuTemplate(params({ isEditable: false, linkURL: 'app://./index.html#x' }), a)).toEqual([]);
  });

  it('outside an editable place: Copy for a selection, otherwise no menu at all', () => {
    expect(labels(contextMenuTemplate(params({ isEditable: false, selectionText: 'some text' }), actions()))).toEqual(['Copy']);
    expect(contextMenuTemplate(params({ isEditable: false }), actions())).toEqual([]);
  });

  it('disables what the target does not allow', () => {
    const t = contextMenuTemplate(params({ editFlags: { ...flags, canCut: false, canPaste: false } }), actions());
    expect(t.find(i => i.label === 'Cut')?.enabled).toBe(false);
    expect(t.find(i => i.label === 'Paste')?.enabled).toBe(false);
    expect(t.find(i => i.label === 'Copy')?.enabled).toBe(true);
  });
});
