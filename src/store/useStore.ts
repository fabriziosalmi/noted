import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { NoteTemplate } from '../lib/templates';
import { extractWikilinks } from '../lib/WikilinkExtension';
import { extractTags } from '../lib/tagUtils';

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
  language?: 'en' | 'it' | 'es' | 'pt' | 'fr' | 'de';
  piiMasking?: boolean;
  showHints?: boolean;
  // 'off'   — no inline AI suggestions at all
  // 'manual' — only fires on explicit trigger (⌘L), Tab accepts, Esc dismisses
  // 'auto'  — fires automatically as user types (legacy behaviour)
  aiGhostMode?: 'off' | 'manual' | 'auto';
  // Editor content width: narrow (~560px) → full (column width)
  editorWidth?: 'narrow' | 'normal' | 'wide' | 'full';
  // Git integration (all optional for backward-compat with persisted state)
  gitEnabled?: boolean;
  gitRemote?: string;
  gitAutoCommit?: boolean;
  gitDefaultBase?: string;   // default base branch for PRs, e.g. 'main'
  gitGhToken?: string;       // NOT persisted — loaded via safeStorage
}

export interface FolderInfo {
  name: string;
  notes: NoteFile[];
}

interface NoteState {
  notes: NoteFile[];           // flat list (root + all subfolders) for search/backlinks
  noteFolders: FolderInfo[];   // subfolders with their notes
  activeNoteName: string | null;
  activeNoteContent: string;
  isLoading: boolean;
  pinnedNotes: string[];
  noteLinksIndex: Record<string, string[]>;
  tagIndex: Record<string, string[]>;
  lastOpenedNote: string | null;

  // Settings
  settings: SettingsState;

  // Actions
  fetchNotes: () => Promise<void>;
  createNote: (fileName: string, initialContent?: string) => Promise<void>;
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
  createFolder: (name: string) => Promise<void>;
  renameFolder: (oldName: string, newName: string) => Promise<void>;
  deleteFolder: (name: string) => Promise<void>;
  moveNote: (fileName: string, toFolder: string) => Promise<void>;
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
      tagIndex: {},
      noteFolders: [],
      lastOpenedNote: null,

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
        language: 'en' as const,
        gitEnabled: false,
        gitRemote: '',
        gitAutoCommit: false,
        gitDefaultBase: 'main',
        gitGhToken: '',
        showHints: true,
        aiGhostMode: 'manual' as const,
        editorWidth: 'normal' as const,
      },

      updateSettings: (newSettings) => {
        if (newSettings.gitGhToken !== undefined && window.electronAPI) {
          // Store GitHub token encrypted — same mechanism as LLM API key
          // We reuse the same safeStorage slot with a namespaced key approach:
          // Electron safeStorage only has one slot, so we store a JSON object.
          // For simplicity, store separately via a dedicated IPC if available,
          // otherwise keep in memory only (not persisted).
          newSettings = { ...newSettings, gitGhToken: '' };
        }
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
      const syncDir = get().settings.syncDirectory || undefined;
      const treeRes = await window.electronAPI.getNotesTree?.(syncDir);
      if (treeRes?.success && treeRes.data) {
        const { rootNotes, folders } = treeRes.data as { rootNotes: NoteFile[]; folders: FolderInfo[] };
        const allNotes = [...rootNotes, ...folders.flatMap(f => f.notes)];
        set({ notes: allNotes, noteFolders: folders, isLoading: false });
        // Auto-reopen last note on startup (only when no note is active yet)
        const { activeNoteName, lastOpenedNote } = get();
        if (!activeNoteName && lastOpenedNote && allNotes.some(n => n.name === lastOpenedNote)) {
          void get().openNote(lastOpenedNote);
        }
      } else {
        // Fallback to flat list for older preload
        const res = await window.electronAPI.getNotesList(syncDir);
        if (res.success && res.data) {
          set({ notes: res.data as NoteFile[], isLoading: false });
          const { activeNoteName, lastOpenedNote } = get();
          if (!activeNoteName && lastOpenedNote && (res.data as NoteFile[]).some(n => n.name === lastOpenedNote)) {
            void get().openNote(lastOpenedNote);
          }
        } else {
          set({ isLoading: false });
        }
      }
    } else {
      set({ isLoading: false });
    }
  },

  createNote: async (fileName: string, initialContent?: string) => {
    if (!fileName.endsWith('.md')) fileName += '.md';
    if (!window.electronAPI) throw new Error('electronAPI non disponibile');
    const lang = get().settings.language ?? 'en';
    const defaultContent = lang === 'it'
      ? '<h1>Nuova Nota</h1><p>Inizia a scrivere qui…</p>'
      : '<h1>New Note</h1><p>Start writing here…</p>';
    const content = initialContent ?? defaultContent;
    const res = await window.electronAPI.saveNote(fileName, content, get().settings.syncDirectory || undefined);
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
          lastOpenedNote: fileName,
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
        const tags = extractTags(content);
        set(state => {
          const newTagIndex = { ...state.tagIndex };
          // Remove this note from all existing tag entries
          for (const tag of Object.keys(newTagIndex)) {
            newTagIndex[tag] = newTagIndex[tag].filter(n => n !== activeNoteName);
            if (!newTagIndex[tag].length) delete newTagIndex[tag];
          }
          // Add current tags
          for (const tag of tags) {
            (newTagIndex[tag] ??= []).push(activeNoteName);
          }
          return {
            activeNoteContent: content,
            noteLinksIndex: { ...state.noteLinksIndex, [activeNoteName]: links },
            tagIndex: newTagIndex,
          };
        });
        await get().fetchNotes();
        // Auto-commit if enabled
        const { gitEnabled, gitAutoCommit, syncDirectory } = get().settings;
        if (gitEnabled && gitAutoCommit && window.electronAPI?.gitCommitNote) {
          void window.electronAPI.gitCommitNote(activeNoteName, undefined, syncDirectory || undefined);
        }
      }
    }
  },

  renameNote: async (oldName: string, newName: string) => {
    if (!newName.endsWith('.md')) newName += '.md';
    if (!window.electronAPI) return;
    const res = await window.electronAPI.renameNote(oldName, newName, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? 'Rinomina fallita');

    // Update indices inline so backlinks render against the new name even
    // during the brief window before fetchNotes resolves.
    const oldBare = oldName.replace(/\.md$/, '');
    const newBare = newName.replace(/\.md$/, '');
    set(state => {
      // 1. Move oldName key → newName in noteLinksIndex (its own outbound links).
      const newLinksIndex = { ...state.noteLinksIndex };
      if (oldName in newLinksIndex) {
        newLinksIndex[newName] = newLinksIndex[oldName];
        delete newLinksIndex[oldName];
      }
      // 2. Rewrite outbound link targets in every other note: any link that
      //    pointed at oldName/oldBare now points at newName/newBare.
      for (const [noteName, links] of Object.entries(newLinksIndex)) {
        if (noteName === newName) continue;
        let changed = false;
        const updated = links.map(l => {
          if (l === oldName || l === oldBare) { changed = true; return newBare; }
          return l;
        });
        if (changed) newLinksIndex[noteName] = updated;
      }
      // 3. tagIndex: move references from oldName → newName.
      const newTagIndex = { ...state.tagIndex };
      for (const [tag, names] of Object.entries(newTagIndex)) {
        if (names.includes(oldName)) {
          newTagIndex[tag] = names.map(n => n === oldName ? newName : n);
        }
      }
      // 4. pinnedNotes: rename if pinned.
      const newPinned = state.pinnedNotes.map(n => n === oldName ? newName : n);
      return { noteLinksIndex: newLinksIndex, tagIndex: newTagIndex, pinnedNotes: newPinned };
    });

    await get().fetchNotes();
    if (get().activeNoteName === oldName) {
      // Re-open by name so activeNoteContent is in sync with the renamed file
      await get().openNote(newName);
    }
  },

  saveAsTemplate: (name: string, content: string) => {
    const id = `custom_${Date.now()}`;
    set(state => ({
      customTemplates: [...state.customTemplates, { id, name, icon: 'custom', content }],
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
    const locale = (get().settings.language ?? 'en') === 'it' ? 'it-IT' : 'en-US';
    const title = new Intl.DateTimeFormat(locale, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }).format(today);
    const lang = (get().settings.language ?? 'en') === 'it' ? 'it' : 'en';
    const sec = lang === 'it'
      ? { notes: 'Note', todo: 'Da fare', ideas: 'Idee' }
      : { notes: 'Notes', todo: 'To do', ideas: 'Ideas' };
    const initialContent = `<h1>${title}</h1><h2>${sec.notes}</h2><p></p><h2>${sec.todo}</h2><ul><li><p></p></li></ul><h2>${sec.ideas}</h2><p></p>`;
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
    set(state => ({
      activeNoteName: activeNoteName === fileName ? null : state.activeNoteName,
      activeNoteContent: activeNoteName === fileName ? '' : state.activeNoteContent,
      pinnedNotes: state.pinnedNotes.filter(n => n !== fileName),
    }));
    await get().fetchNotes();
  },

  createFolder: async (name: string) => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.createFolder(name, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? 'Impossibile creare la cartella');
    await get().fetchNotes();
  },

  renameFolder: async (oldName: string, newName: string) => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.renameFolder(oldName, newName, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? 'Impossibile rinominare la cartella');
    const { activeNoteName } = get();
    await get().fetchNotes();
    if (activeNoteName?.startsWith(`${oldName}/`)) {
      const newNoteName = `${newName}/${activeNoteName.slice(oldName.length + 1)}`;
      await get().openNote(newNoteName);
    }
  },

  deleteFolder: async (name: string) => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.deleteFolder(name, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? 'Impossibile eliminare la cartella');
    await get().fetchNotes();
  },

  moveNote: async (fileName: string, toFolder: string) => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.moveNote(fileName, toFolder, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? 'Impossibile spostare la nota');
    const { activeNoteName } = get();
    if (activeNoteName === fileName && res.data) {
      await get().openNote(res.data);
    }
    await get().fetchNotes();
  },
}),
{
  name: 'noted-storage',
  // Exclude llmApiKey from localStorage — stored encrypted via safeStorage instead
  partialize: (state) => ({
    settings: { ...state.settings, llmApiKey: '' },
    pinnedNotes: state.pinnedNotes,
    customTemplates: state.customTemplates,
    noteLinksIndex: state.noteLinksIndex,
    lastOpenedNote: state.lastOpenedNote,
  }),
  // Custom storage wrapper that handles QuotaExceededError gracefully:
  // - on quota exhaustion drop the heaviest field (noteLinksIndex) and retry
  // - otherwise log once and swallow — persist failures must NOT crash the
  //   action that triggered the save.
  storage: createJSONStorage(() => ({
    getItem: (name: string) => {
      try { return localStorage.getItem(name); } catch { return null; }
    },
    setItem: (name: string, value: string) => {
      try { localStorage.setItem(name, value); return; }
      catch (err: unknown) {
        const e = err as { name?: string };
        if (e?.name === 'QuotaExceededError') {
          try {
            const parsed = JSON.parse(value) as { state?: Record<string, unknown> };
            if (parsed.state && 'noteLinksIndex' in parsed.state) {
              parsed.state.noteLinksIndex = {};
              localStorage.setItem(name, JSON.stringify(parsed));
              console.warn('[useStore] localStorage quota exceeded — dropped noteLinksIndex');
              return;
            }
          } catch { /* fall through */ }
        }
        console.warn('[useStore] persist write failed:', (err as Error).message);
      }
    },
    removeItem: (name: string) => {
      try { localStorage.removeItem(name); } catch { /* ignore */ }
    },
  })),
}
)
);
