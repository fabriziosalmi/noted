import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { NoteTemplate } from '../lib/templates';
import { extractWikilinks } from '../lib/WikilinkExtension';

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
  theme: 'auto' | 'light' | 'dark' | 'sepia';
  accentColor: string;
  focusMode: boolean;
  editorFont: 'system' | 'serif' | 'mono';
  editorFontSize: 'sm' | 'md' | 'lg' | 'xl';
  typewriterMode: boolean;
}

interface NoteState {
  notes: NoteFile[];
  activeNoteName: string | null;
  activeNoteContent: string;
  isLoading: boolean;
  pinnedNotes: string[];
  noteLinksIndex: Record<string, string[]>; // noteName → outgoing wikilink targets

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
  togglePin: (fileName: string) => void;
  openOrCreateDaily: () => Promise<void>;
  customTemplates: NoteTemplate[];
  saveAsTemplate: (name: string, content: string) => void;
  deleteTemplate: (id: string) => void;
  createFromTemplate: (template: NoteTemplate) => Promise<void>;
}

export const useStore = create<NoteState>()(
  persist(
    (set, get) => ({
      notes: [],
      activeNoteName: null,
      activeNoteContent: '',
      isLoading: false,
      pinnedNotes: [],
      customTemplates: [],
      noteLinksIndex: {},
      
      settings: {
        llmProvider: 'lmstudio',
        llmApiKey: '',
        llmModel: '',
        lmStudioUrl: 'http://localhost:1234/v1',
        syncDirectory: null,
        showToolbar: true,
        showAiBar: true,
        theme: 'auto' as const,
        accentColor: '#6366f1',
        focusMode: false,
        editorFont: 'system' as const,
        editorFontSize: 'md' as const,
        typewriterMode: false,
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
    await get().fetchNotes();
  },

  openNote: async (fileName: string) => {
    if (window.electronAPI) {
      const res = await window.electronAPI.readNote(fileName, get().settings.syncDirectory || undefined);
      if (res.success && res.data !== undefined) {
        const links = extractWikilinks(res.data);
        set(state => ({
          activeNoteName: fileName,
          activeNoteContent: res.data as string,
          noteLinksIndex: { ...state.noteLinksIndex, [fileName]: links },
        }));
      }
    }
  },

  saveActiveNote: async (content: string) => {
    const { activeNoteName } = get();
    if (activeNoteName && window.electronAPI) {
      const res = await window.electronAPI.saveNote(activeNoteName, content, get().settings.syncDirectory || undefined);
      if (res.success) {
        const links = extractWikilinks(content);
        set(state => ({
          activeNoteContent: content,
          noteLinksIndex: { ...state.noteLinksIndex, [activeNoteName]: links },
        }));
        await get().fetchNotes();
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

  saveAsTemplate: (name: string, content: string) => {
    const id = `custom_${Date.now()}`;
    set(state => ({
      customTemplates: [...state.customTemplates, { id, name, icon: '📄', content }],
    }));
  },

  deleteTemplate: (id: string) => {
    set(state => ({ customTemplates: state.customTemplates.filter(t => t.id !== id) }));
  },

  createFromTemplate: async (template: NoteTemplate) => {
    const fileName = `${template.name.replace(/\s+/g, '_')}_${Math.floor(Date.now() / 1000)}.md`;
    if (!window.electronAPI) return;
    const res = await window.electronAPI.saveNote(fileName, template.content, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? 'Impossibile creare la nota');
    await get().fetchNotes();
    await get().openNote(fileName);
  },

  openOrCreateDaily: async () => {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fileName = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.md`;
    const { notes } = get();
    if (notes.some(n => n.name === fileName)) {
      await get().openNote(fileName);
      return;
    }
    const dayNames = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
    const monthNames = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
    const title = `${dayNames[today.getDay()]} ${today.getDate()} ${monthNames[today.getMonth()]} ${today.getFullYear()}`;
    const initialContent = `<h1>${title}</h1><h2>📝 Note</h2><p></p><h2>✅ Da fare</h2><ul><li><p></p></li></ul><h2>💡 Idee</h2><p></p>`;
    if (!window.electronAPI) return;
    const res = await window.electronAPI.saveNote(fileName, initialContent, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? 'Impossibile creare la nota giornaliera');
    await get().fetchNotes();
    await get().openNote(fileName);
  },

  togglePin: (fileName: string) => {
    set(state => {
      const pinned = state.pinnedNotes.includes(fileName)
        ? state.pinnedNotes.filter(n => n !== fileName)
        : [...state.pinnedNotes, fileName];
      return { pinnedNotes: pinned };
    });
  },

  deleteNote: async (fileName: string) => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.deleteNote(fileName, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? 'Impossibile eliminare la nota');
    const { activeNoteName } = get();
    if (activeNoteName === fileName) {
      set({ activeNoteName: null, activeNoteContent: '' });
    }
    await get().fetchNotes();
  }
}),
{
  name: 'noted-storage',
  // Exclude llmApiKey from localStorage — stored encrypted via safeStorage instead
  partialize: (state) => ({
    settings: { ...state.settings, llmApiKey: '' },
    pinnedNotes: state.pinnedNotes,
    customTemplates: state.customTemplates,
    noteLinksIndex: state.noteLinksIndex,
  }),
}
)
);
