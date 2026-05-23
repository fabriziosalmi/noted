import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from './useStore';

describe('useStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useStore.setState({
      notes: [],
      activeNoteName: null,
      activeNoteContent: '',
      isLoading: false,
    });
    vi.clearAllMocks();
  });

  it('should initialize with default state', () => {
    const state = useStore.getState();
    expect(state.notes).toEqual([]);
    expect(state.activeNoteName).toBeNull();
    expect(state.activeNoteContent).toBe('');
    expect(state.isLoading).toBe(false);
  });

  it('should fetch notes successfully', async () => {
    const mockNotes = [
      { name: 'test1.md', path: '/test1.md', stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } }
    ];
    window.electronAPI.getNotesTree = vi.fn().mockResolvedValue({
      success: true,
      data: { rootNotes: mockNotes, folders: [] },
    });

    await useStore.getState().fetchNotes();

    expect(window.electronAPI.getNotesTree).toHaveBeenCalled();
    expect(useStore.getState().notes).toEqual(mockNotes);
  });

  it('should handle fetch notes failure gracefully', async () => {
    window.electronAPI.getNotesTree = vi.fn().mockResolvedValue({ success: false, error: 'Failed' });
    window.electronAPI.getNotesList = vi.fn().mockResolvedValue({ success: false, error: 'Failed' });

    await useStore.getState().fetchNotes();

    expect(useStore.getState().notes).toEqual([]);
  });

  it('should handle concurrency in createNote gracefully (Draconian analysis)', async () => {
    window.electronAPI.saveNote = vi.fn()
      .mockResolvedValueOnce({ success: true }) // First call succeeds
      .mockResolvedValueOnce({ success: false, error: 'File exists' }); // Second call fails

    // Attempt to create two notes at the exact same time
    const p1 = useStore.getState().createNote('concurrent.md');
    const p2 = useStore.getState().createNote('concurrent.md');

    // Second call throws "File exists" — settle both, expect exactly one rejection
    const results = await Promise.allSettled([p1, p2]);
    const rejected = results.filter(r => r.status === 'rejected');
    const fulfilled = results.filter(r => r.status === 'fulfilled');

    expect(window.electronAPI.saveNote).toHaveBeenCalledTimes(2);
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/File exists|Impossibile/);
    expect(useStore.getState().isLoading).toBe(false);
  });

  it('should save active note', async () => {
    useStore.setState({ activeNoteName: 'test.md' });
    window.electronAPI.saveNote = vi.fn().mockResolvedValue({ success: true });

    await useStore.getState().saveActiveNote('new content');

    expect(window.electronAPI.saveNote).toHaveBeenCalledWith('test.md', 'new content', undefined);
    expect(useStore.getState().activeNoteContent).toBe('new content');
  });

  it('should delete note and clear active state if it was the active note', async () => {
    useStore.setState({ activeNoteName: 'delete_me.md', activeNoteContent: 'content' });
    window.electronAPI.deleteNote = vi.fn().mockResolvedValue({ success: true });

    await useStore.getState().deleteNote('delete_me.md');

    expect(window.electronAPI.deleteNote).toHaveBeenCalledWith('delete_me.md', undefined);
    expect(useStore.getState().activeNoteName).toBeNull();
    expect(useStore.getState().activeNoteContent).toBe('');
  });

  it('should store api key via electron and keep persisted key empty in settings', () => {
    useStore.getState().updateSettings({ llmApiKey: 'secret-key' });
    expect(window.electronAPI.storeApiKey).toHaveBeenCalledWith('secret-key');
    expect(useStore.getState().settings.llmApiKey).toBe('');
  });

  it('should load api key from electron safe storage', async () => {
    window.electronAPI.getApiKey = vi.fn().mockResolvedValue({ success: true, data: 'loaded-key' });
    await useStore.getState().loadApiKey();
    expect(useStore.getState().settings.llmApiKey).toBe('loaded-key');
  });

  it('should fallback to getNotesList when getNotesTree fails', async () => {
    const fallbackNotes = [{ name: 'fallback.md', path: '/fallback.md', stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } }];
    window.electronAPI.getNotesTree = vi.fn().mockResolvedValue({ success: false });
    window.electronAPI.getNotesList = vi.fn().mockResolvedValue({ success: true, data: fallbackNotes });

    await useStore.getState().fetchNotes();

    expect(window.electronAPI.getNotesList).toHaveBeenCalled();
    expect(useStore.getState().notes).toEqual(fallbackNotes);
  });

  it('should auto-open last opened note after fetching notes', async () => {
    const notes = [{ name: 'resume.md', path: '/resume.md', stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } }];
    useStore.setState({ lastOpenedNote: 'resume.md', activeNoteName: null });
    window.electronAPI.getNotesTree = vi.fn().mockResolvedValue({
      success: true,
      data: { rootNotes: notes, folders: [] },
    });
    window.electronAPI.readNote = vi.fn().mockResolvedValue({ success: true, data: '<p>resume</p>' });

    await useStore.getState().fetchNotes();

    expect(window.electronAPI.readNote).toHaveBeenCalledWith('resume.md', undefined);
  });

  it('should rename note and update indices, tags, pins and active note', async () => {
    useStore.setState({
      activeNoteName: 'old.md',
      pinnedNotes: ['old.md'],
      noteLinksIndex: {
        'old.md': ['x'],
        'other.md': ['old', 'z'],
      },
      tagIndex: { t1: ['old.md', 'other.md'] },
    });
    window.electronAPI.renameNote = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI.getNotesTree = vi.fn().mockResolvedValue({
      success: true,
      data: {
        rootNotes: [{ name: 'new.md', path: '/new.md', stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } }],
        folders: [],
      },
    });
    window.electronAPI.readNote = vi.fn().mockResolvedValue({ success: true, data: '[[x]]' });

    await useStore.getState().renameNote('old.md', 'new');

    const state = useStore.getState();
    expect(window.electronAPI.renameNote).toHaveBeenCalledWith('old.md', 'new.md', undefined);
    expect(state.noteLinksIndex['new.md']).toContain('x');
    expect(state.noteLinksIndex['other.md']).toContain('new');
    expect(state.tagIndex.t1).toContain('new.md');
    expect(state.pinnedNotes).toContain('new.md');
    expect(window.electronAPI.readNote).toHaveBeenCalledWith('new.md', undefined);
  });

  it('should auto-commit note on save when git auto commit is enabled', async () => {
    useStore.setState({
      activeNoteName: 'git.md',
      settings: {
        ...useStore.getState().settings,
        gitEnabled: true,
        gitAutoCommit: true,
      },
    });
    window.electronAPI.saveNote = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI.gitCommitNote = vi.fn().mockResolvedValue({ success: true });

    await useStore.getState().saveActiveNote('<p>#tag</p>');

    expect(window.electronAPI.gitCommitNote).toHaveBeenCalledWith('git.md', undefined, undefined);
  });

  it('should create and open daily note when missing', async () => {
    useStore.setState({ notes: [], settings: { ...useStore.getState().settings, language: 'en' } });
    window.electronAPI.saveNote = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI.getNotesTree = vi.fn().mockResolvedValue({ success: true, data: { rootNotes: [], folders: [] } });
    window.electronAPI.readNote = vi.fn().mockResolvedValue({ success: true, data: '<p>daily</p>' });

    await useStore.getState().openOrCreateDaily();

    expect(window.electronAPI.saveNote).toHaveBeenCalled();
    expect(window.electronAPI.readNote).toHaveBeenCalled();
  });

  it('should toggle pin on and off', () => {
    useStore.setState({ pinnedNotes: [] });
    useStore.getState().togglePin('pin.md');
    expect(useStore.getState().pinnedNotes).toEqual(['pin.md']);
    useStore.getState().togglePin('pin.md');
    expect(useStore.getState().pinnedNotes).toEqual([]);
  });

  it('should create from template then open generated note', async () => {
    window.electronAPI.saveNote = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI.getNotesTree = vi.fn().mockResolvedValue({ success: true, data: { rootNotes: [], folders: [] } });
    window.electronAPI.readNote = vi.fn().mockResolvedValue({ success: true, data: '<h1>x</h1>' });

    await useStore.getState().createFromTemplate({
      id: 'tpl',
      name: 'My Template',
      icon: 'custom',
      content: '<h1>x</h1>',
    });

    expect(window.electronAPI.saveNote).toHaveBeenCalled();
    expect(window.electronAPI.readNote).toHaveBeenCalled();
  });

  it('should create, rename, delete folder and move note', async () => {
    window.electronAPI.createFolder = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI.renameFolder = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI.deleteFolder = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI.moveNote = vi.fn().mockResolvedValue({ success: true, data: 'dst/note.md' });
    window.electronAPI.readNote = vi.fn().mockResolvedValue({ success: true, data: '<p>moved</p>' });
    window.electronAPI.getNotesTree = vi.fn().mockResolvedValue({ success: true, data: { rootNotes: [], folders: [] } });

    await useStore.getState().createFolder('docs');
    await useStore.getState().renameFolder('docs', 'docs2');
    useStore.setState({ activeNoteName: 'note.md' });
    await useStore.getState().moveNote('note.md', 'dst');
    await useStore.getState().deleteFolder('docs2');

    expect(window.electronAPI.createFolder).toHaveBeenCalledWith('docs', undefined);
    expect(window.electronAPI.renameFolder).toHaveBeenCalledWith('docs', 'docs2', undefined);
    expect(window.electronAPI.moveNote).toHaveBeenCalledWith('note.md', 'dst', undefined);
    expect(window.electronAPI.readNote).toHaveBeenCalledWith('dst/note.md', undefined);
    expect(window.electronAPI.deleteFolder).toHaveBeenCalledWith('docs2', undefined);
  });

  it('should reopen active note when renaming its folder', async () => {
    useStore.setState({ activeNoteName: 'docs/note.md' });
    window.electronAPI.renameFolder = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI.getNotesTree = vi.fn().mockResolvedValue({ success: true, data: { rootNotes: [], folders: [] } });
    window.electronAPI.readNote = vi.fn().mockResolvedValue({ success: true, data: '<p>renamed</p>' });

    await useStore.getState().renameFolder('docs', 'docs-new');

    expect(window.electronAPI.renameFolder).toHaveBeenCalledWith('docs', 'docs-new', undefined);
    expect(window.electronAPI.readNote).toHaveBeenCalledWith('docs-new/note.md', undefined);
  });

  it('should throw on folder/move failures', async () => {
    window.electronAPI.createFolder = vi.fn().mockResolvedValue({ success: false, error: 'cfail' });
    window.electronAPI.renameFolder = vi.fn().mockResolvedValue({ success: false, error: 'rfail' });
    window.electronAPI.deleteFolder = vi.fn().mockResolvedValue({ success: false, error: 'dfail' });
    window.electronAPI.moveNote = vi.fn().mockResolvedValue({ success: false, error: 'mfail' });

    await expect(useStore.getState().createFolder('x')).rejects.toThrow('cfail');
    await expect(useStore.getState().renameFolder('a', 'b')).rejects.toThrow('rfail');
    await expect(useStore.getState().deleteFolder('x')).rejects.toThrow('dfail');
    await expect(useStore.getState().moveNote('n.md', 'x')).rejects.toThrow('mfail');
  });

  it('should open existing daily note without creating a new one', async () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const daily = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`;
    useStore.setState({
      notes: [{ name: daily, path: `/${daily}`, stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } }],
    });
    window.electronAPI.readNote = vi.fn().mockResolvedValue({ success: true, data: '<p>existing</p>' });
    window.electronAPI.saveNote = vi.fn().mockResolvedValue({ success: true });

    await useStore.getState().openOrCreateDaily();

    expect(window.electronAPI.readNote).toHaveBeenCalledWith(daily, undefined);
    expect(window.electronAPI.saveNote).not.toHaveBeenCalled();
  });

  it('handles localStorage quota by dropping noteLinksIndex and retrying persist', () => {
    const originalSetItem = window.localStorage.setItem;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let calls = 0;
    window.localStorage.setItem = vi.fn((key: string, value: string) => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('quota');
        (err as Error & { name: string }).name = 'QuotaExceededError';
        throw err;
      }
      return originalSetItem.call(window.localStorage, key, value);
    }) as typeof window.localStorage.setItem;

    useStore.setState({ noteLinksIndex: { 'a.md': ['b'] } });

    expect(window.localStorage.setItem).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[useStore] localStorage quota exceeded — dropped noteLinksIndex');
    window.localStorage.setItem = originalSetItem;
    warnSpy.mockRestore();
  });

  it('swallows persist write failures and logs warning', () => {
    const originalSetItem = window.localStorage.setItem;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.localStorage.setItem = vi.fn(() => {
      throw new Error('disk-fail');
    }) as typeof window.localStorage.setItem;

    expect(() => useStore.setState({ pinnedNotes: ['x.md'] })).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith('[useStore] persist write failed:', 'disk-fail');

    window.localStorage.setItem = originalSetItem;
    warnSpy.mockRestore();
  });

  it('should wipe all notes, reset specific state fields, and fetch notes', async () => {
    useStore.setState({
      notes: [{ name: 'a.md', path: '/a.md', stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } }],
      pinnedNotes: ['a.md'],
      customTemplates: [{ id: 'tpl', name: 'Tpl', icon: 'custom', content: 'tpl' }],
      noteLinksIndex: { 'a.md': ['b'] },
      tagIndex: { tag: ['a.md'] },
      noteFolders: ['folder'],
      lastOpenedNote: 'a.md',
      customNotesOrder: ['a.md'],
      customFoldersOrder: ['folder'],
      activeNoteName: 'a.md',
      activeNoteContent: 'content',
    });

    window.electronAPI.wipeAllNotes = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI.getNotesTree = vi.fn().mockResolvedValue({
      success: true,
      data: { rootNotes: [], folders: [] },
    });

    await useStore.getState().wipeAllNotes();

    expect(window.electronAPI.wipeAllNotes).toHaveBeenCalledWith(undefined);
    const state = useStore.getState();
    expect(state.notes).toEqual([]);
    expect(state.pinnedNotes).toEqual([]);
    expect(state.customTemplates).toEqual([]);
    expect(state.noteLinksIndex).toEqual({});
    expect(state.tagIndex).toEqual({});
    expect(state.noteFolders).toEqual([]);
    expect(state.lastOpenedNote).toBeNull();
    expect(state.customNotesOrder).toEqual([]);
    expect(state.customFoldersOrder).toEqual([]);
    expect(state.activeNoteName).toBeNull();
    expect(state.activeNoteContent).toBe('');
    expect(window.electronAPI.getNotesTree).toHaveBeenCalled();
  });

  it('should throw error when wipeAllNotes API call fails', async () => {
    window.electronAPI.wipeAllNotes = vi.fn().mockResolvedValue({ success: false, error: 'wipe failed' });
    await expect(useStore.getState().wipeAllNotes()).rejects.toThrow('wipe failed');
  });

  it('should parse markdown, strip frontmatter, convert tables to HTML and extract wikilinks when opening a note', async () => {
    const mdContent = `---
title: Note Title
tags: [tag1, tag2]
---
# Welcome
Here is a table:
| Col A | Col B |
|---|---|
| Val A | [[WikilinkTarget]] |
`;
    window.electronAPI.readNote = vi.fn().mockResolvedValue({ success: true, data: mdContent });

    await useStore.getState().openNote('markdown-note.md');

    const state = useStore.getState();
    expect(window.electronAPI.readNote).toHaveBeenCalledWith('markdown-note.md', undefined);
    
    // Check that frontmatter is stripped
    expect(state.activeNoteContent).not.toContain('title: Note Title');
    
    // Check that Markdown headings are converted to HTML
    expect(state.activeNoteContent).toContain('<h1>Welcome</h1>');
    
    // Check that table is converted to HTML
    expect(state.activeNoteContent).toContain('<table>');
    expect(state.activeNoteContent).toContain('<th>Col A</th>');
    expect(state.activeNoteContent).toContain('<td>Val A</td>');
    
    // Check that wikilink is preserved and extracted
    expect(state.activeNoteContent).toContain('[[WikilinkTarget]]');
    expect(state.noteLinksIndex['markdown-note.md']).toEqual(['WikilinkTarget']);
  });

  it('should save a template and delete it', () => {
    useStore.setState({ customTemplates: [] });
    useStore.getState().saveAsTemplate('New Tpl', 'tpl content');
    const state1 = useStore.getState();
    expect(state1.customTemplates).toHaveLength(1);
    expect(state1.customTemplates[0].name).toBe('New Tpl');
    expect(state1.customTemplates[0].content).toBe('tpl content');

    const tplId = state1.customTemplates[0].id;
    useStore.getState().deleteTemplate(tplId);
    const state2 = useStore.getState();
    expect(state2.customTemplates).toHaveLength(0);
  });

  it('should remove notes from pinnedNotes and customNotesOrder when note is deleted', async () => {
    useStore.setState({
      activeNoteName: 'to_delete.md',
      pinnedNotes: ['to_delete.md', 'keep.md'],
      customNotesOrder: ['to_delete.md', 'keep.md'],
    });
    window.electronAPI.deleteNote = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI.getNotesTree = vi.fn().mockResolvedValue({
      success: true,
      data: { rootNotes: [], folders: [] },
    });

    await useStore.getState().deleteNote('to_delete.md');

    const state = useStore.getState();
    expect(state.pinnedNotes).toEqual(['keep.md']);
    expect(state.customNotesOrder).toEqual(['keep.md']);
  });

  it('should update folder prefix matching in customNotesOrder when folder is renamed', async () => {
    useStore.setState({
      customNotesOrder: ['folderA/note1.md', 'folderB/note2.md', 'note3.md'],
      customFoldersOrder: ['folderA', 'folderB'],
    });
    window.electronAPI.renameFolder = vi.fn().mockResolvedValue({ success: true });
    window.electronAPI.getNotesTree = vi.fn().mockResolvedValue({
      success: true,
      data: { rootNotes: [], folders: [] },
    });

    await useStore.getState().renameFolder('folderA', 'folderNew');

    const state = useStore.getState();
    expect(state.customNotesOrder).toEqual(['folderNew/note1.md', 'folderB/note2.md', 'note3.md']);
    expect(state.customFoldersOrder).toEqual(['folderNew', 'folderB']);
  });

  it('handles custom storage getItem errors gracefully', () => {
    const persistOptions = (useStore as any).persist?.getOptions();
    const storage = persistOptions?.storage;
    expect(storage).toBeDefined();

    const originalGetItem = window.localStorage.getItem;
    window.localStorage.getItem = vi.fn(() => {
      throw new Error('get-fail');
    });

    expect(storage.getItem('dummy')).toBeNull();

    window.localStorage.getItem = originalGetItem;
  });

  it('handles custom storage removeItem errors gracefully', () => {
    const persistOptions = (useStore as any).persist?.getOptions();
    const storage = persistOptions?.storage;
    expect(storage).toBeDefined();

    const originalRemoveItem = window.localStorage.removeItem;
    window.localStorage.removeItem = vi.fn(() => {
      throw new Error('remove-fail');
    });

    expect(() => storage.removeItem('dummy')).not.toThrow();

    window.localStorage.removeItem = originalRemoveItem;
  });

  it('should support setCustomNotesOrder, setCustomFoldersOrder, and setSortBy', () => {
    useStore.getState().setCustomNotesOrder(['a.md']);
    useStore.getState().setCustomFoldersOrder(['f']);
    useStore.getState().setSortBy('title');

    const state = useStore.getState();
    expect(state.customNotesOrder).toEqual(['a.md']);
    expect(state.customFoldersOrder).toEqual(['f']);
    expect(state.sortBy).toBe('title');
  });

  it('should handle gitGhToken update in settings and strip it to empty', () => {
    useStore.getState().updateSettings({ gitGhToken: 'secret-github-token' });
    const state = useStore.getState();
    expect(state.settings.gitGhToken).toBe('');
  });

  it('should auto-open last opened note during getNotesList fallback', async () => {
    const fallbackNotes = [{ name: 'fallback.md', path: '/fallback.md', stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } }];
    useStore.setState({ lastOpenedNote: 'fallback.md', activeNoteName: null });
    window.electronAPI.getNotesTree = vi.fn().mockResolvedValue({ success: false });
    window.electronAPI.getNotesList = vi.fn().mockResolvedValue({ success: true, data: fallbackNotes });
    window.electronAPI.readNote = vi.fn().mockResolvedValue({ success: true, data: '<p>fallback content</p>' });

    await useStore.getState().fetchNotes();

    expect(window.electronAPI.readNote).toHaveBeenCalledWith('fallback.md', undefined);
  });

  it('should handle fetchNotes when electronAPI is not defined', async () => {
    const originalAPI = window.electronAPI;
    delete (window as any).electronAPI;

    useStore.setState({ isLoading: true });
    await useStore.getState().fetchNotes();

    expect(useStore.getState().isLoading).toBe(false);

    window.electronAPI = originalAPI;
  });

  it('should return early from folder/note operations if electronAPI is not defined', async () => {
    const originalAPI = window.electronAPI;
    delete (window as any).electronAPI;

    // Call early-return methods and make sure they don't throw and just noop
    await expect(useStore.getState().deleteNote('x.md')).resolves.toBeUndefined();
    await expect(useStore.getState().createFolder('x')).resolves.toBeUndefined();
    await expect(useStore.getState().renameFolder('a', 'b')).resolves.toBeUndefined();
    await expect(useStore.getState().deleteFolder('x')).resolves.toBeUndefined();
    await expect(useStore.getState().moveNote('a.md', 'x')).resolves.toBeUndefined();
    await expect(useStore.getState().wipeAllNotes()).resolves.toBeUndefined();
    await expect(useStore.getState().createFromTemplate({ id: 'tpl', name: 'Tpl', icon: 'custom', content: 'tpl' })).resolves.toBeUndefined();

    window.electronAPI = originalAPI;
  });

  it('handles localStorage quota when noteLinksIndex is not in state', () => {
    const originalSetItem = window.localStorage.setItem;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let calls = 0;
    window.localStorage.setItem = vi.fn((key: string, value: string) => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('quota');
        (err as Error & { name: string }).name = 'QuotaExceededError';
        throw err;
      }
      return originalSetItem.call(window.localStorage, key, value);
    }) as typeof window.localStorage.setItem;

    const persistOptions = (useStore as any).persist?.getOptions();
    const storage = persistOptions?.storage;
    
    // Set item directly with JSON that doesn't have noteLinksIndex in state
    storage.setItem('dummy-key', JSON.stringify({ state: { pinnedNotes: [] } }));

    expect(warnSpy).toHaveBeenCalledWith('[useStore] persist write failed:', 'quota');

    window.localStorage.setItem = originalSetItem;
    warnSpy.mockRestore();
  });
});
