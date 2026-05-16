import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface NoteFile {
  name: string;
  path: string;
  stats: {
    mtimeMs: number;
    ctimeMs: number;
    size: number;
  };
}

export type LLMProvider = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'lmstudio' | 'ollama';

interface SettingsState {
  llmProvider: LLMProvider;
  llmApiKey: string;
  llmModel: string;
  lmStudioUrl: string;
  syncDirectory: string | null;
}

interface NoteState {
  notes: NoteFile[];
  activeNoteName: string | null;
  activeNoteContent: string;
  isLoading: boolean;
  
  // Settings
  settings: SettingsState;
  
  // Actions
  fetchNotes: () => Promise<void>;
  createNote: (fileName: string) => Promise<void>;
  openNote: (fileName: string) => Promise<void>;
  saveActiveNote: (content: string) => Promise<void>;
  deleteNote: (fileName: string) => Promise<void>;
  updateSettings: (newSettings: Partial<SettingsState>) => void;
}

export const useStore = create<NoteState>()(
  persist(
    (set, get) => ({
      notes: [],
      activeNoteName: null,
      activeNoteContent: '',
      isLoading: false,
      
      settings: {
        llmProvider: 'openai',
        llmApiKey: '',
        llmModel: 'gpt-4o',
        lmStudioUrl: 'http://localhost:1234/v1',
        syncDirectory: null,
      },

      updateSettings: (newSettings) => {
        set({ settings: { ...get().settings, ...newSettings } });
      },

      fetchNotes: async () => {
    set({ isLoading: true });
    if (window.electronAPI) {
      const res = await window.electronAPI.getNotesList(get().settings.syncDirectory || undefined);
      if (res.success && res.data) {
        set({ notes: res.data, isLoading: false });
      } else {
        set({ isLoading: false });
        console.error('Failed to fetch notes:', res.error);
      }
    } else {
      set({ isLoading: false });
    }
  },

  createNote: async (fileName: string) => {
    if (!fileName.endsWith('.md')) fileName += '.md';
    if (window.electronAPI) {
      const res = await window.electronAPI.saveNote(fileName, '<h1>Nuova Nota</h1><p>Inizia a scrivere qui...</p>', get().settings.syncDirectory || undefined);
      if (res.success) {
        await get().fetchNotes();
        await get().openNote(fileName);
      } else {
        console.error('Failed to create note:', res.error);
      }
    } else {
      console.error('electronAPI is not available in window');
    }
  },

  openNote: async (fileName: string) => {
    if (window.electronAPI) {
      const res = await window.electronAPI.readNote(fileName, get().settings.syncDirectory || undefined);
      if (res.success && res.data !== undefined) {
        set({ activeNoteName: fileName, activeNoteContent: res.data });
      }
    }
  },

  saveActiveNote: async (content: string) => {
    const { activeNoteName } = get();
    if (activeNoteName && window.electronAPI) {
      const res = await window.electronAPI.saveNote(activeNoteName, content, get().settings.syncDirectory || undefined);
      if (res.success) {
        set({ activeNoteContent: content });
        await get().fetchNotes(); // Update modified time in list
      }
    }
  },

  deleteNote: async (fileName: string) => {
    if (window.electronAPI) {
      const res = await window.electronAPI.deleteNote(fileName, get().settings.syncDirectory || undefined);
      if (res.success) {
        const { activeNoteName } = get();
        if (activeNoteName === fileName) {
          set({ activeNoteName: null, activeNoteContent: '' });
        }
        await get().fetchNotes();
      }
    }
  }
}),
{
  name: 'noted-storage',
  partialize: (state) => ({ settings: state.settings }), // Only persist settings, not notes/buffer
}
)
);
