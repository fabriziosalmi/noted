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
    window.electronAPI.getNotesList = vi.fn().mockResolvedValue({ success: true, data: mockNotes });

    await useStore.getState().fetchNotes();

    expect(window.electronAPI.getNotesList).toHaveBeenCalled();
    expect(useStore.getState().notes).toEqual(mockNotes);
  });

  it('should handle fetch notes failure gracefully', async () => {
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
    
    await Promise.all([p1, p2]);
    
    // Only one should succeed, the store should not crash
    expect(window.electronAPI.saveNote).toHaveBeenCalledTimes(2);
    // After creating, it fetches notes. Ensure the store isn't left in a bad state
    expect(useStore.getState().isLoading).toBe(false);
  });

  it('should save active note', async () => {
    useStore.setState({ activeNoteName: 'test.md' });
    window.electronAPI.saveNote = vi.fn().mockResolvedValue({ success: true });

    await useStore.getState().saveActiveNote('new content');

    expect(window.electronAPI.saveNote).toHaveBeenCalledWith('test.md', 'new content');
    expect(useStore.getState().activeNoteContent).toBe('new content');
  });

  it('should delete note and clear active state if it was the active note', async () => {
    useStore.setState({ activeNoteName: 'delete_me.md', activeNoteContent: 'content' });
    window.electronAPI.deleteNote = vi.fn().mockResolvedValue({ success: true });

    await useStore.getState().deleteNote('delete_me.md');

    expect(window.electronAPI.deleteNote).toHaveBeenCalledWith('delete_me.md');
    expect(useStore.getState().activeNoteName).toBeNull();
    expect(useStore.getState().activeNoteContent).toBe('');
  });
});