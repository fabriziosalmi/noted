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
  showToolbar: boolean;
  showAiBar: boolean;
  theme: 'auto' | 'light' | 'dark';
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
  renameNote: (oldName: string, newName: string) => Promise<void>;
  updateSettings: (newSettings: Partial<SettingsState>) => void;
  loadApiKey: () => Promise<void>;
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
        showToolbar: true,
        showAiBar: true,
        theme: 'auto' as const,
      },

      updateSettings: (newSettings) => {
        if (newSettings.llmApiKey !== undefined && window.electronAPI) {
          window.electronAPI.storeApiKey(newSettings.llmApiKey);
          newSettings = { ...newSettings, llmApiKey: '' };
        }
        set({ settings: { ...get().settings, ...newSettings } });
      },

      loadApiKey: async () => {
        if (window.electronAPI) {
          const res = await window.electronAPI.getApiKey();
          if (res.success && res.data) {
            set((state) => ({ settings: { ...state.settings, llmApiKey: res.data as string } }));
          }
        }
      },

      fetchNotes: async () => {
    set({ isLoading: true });
    if (window.electronAPI) {
      const res = await window.electronAPI.getNotesList(get().settings.syncDirectory || undefined);
      if (res.success && res.data) {
        set({ notes: res.data as NoteFile[], isLoading: false });
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
    if (!window.electronAPI) throw new Error('electronAPI non disponibile');
    const initialContent = '<h1>Nuova Nota</h1><p>Inizia a scrivere qui...</p>';
    const res = await window.electronAPI.saveNote(fileName, initialContent, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? 'Impossibile creare la nota');
    await get().openNote(fileName);
    get().fetchNotes();
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

  renameNote: async (oldName: string, newName: string) => {
    if (!newName.endsWith('.md')) newName += '.md';
    if (!window.electronAPI) return;
    const res = await window.electronAPI.renameNote(oldName, newName, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? 'Rinomina fallita');
    if (get().activeNoteName === oldName) {
      set({ activeNoteName: newName });
    }
    await get().fetchNotes();
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
  // Exclude llmApiKey from localStorage — stored encrypted via safeStorage instead
  partialize: (state) => ({
    settings: { ...state.settings, llmApiKey: '' }
  }),
}
)
);
