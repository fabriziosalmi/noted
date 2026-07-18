import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { marked } from 'marked';
import type { NoteTemplate } from '../lib/templates';
import { extractWikilinks } from '../lib/WikilinkExtension';
import { extractTags } from '../lib/tagUtils';
import { slugifyTitle } from '../lib/noteTitle';
import { getElectronApi } from '../lib/electronApi';
import {
  extractHtmlFrontmatterComment,
  extractMarkdownFrontmatter,
  prependFrontmatterComment,
} from '../../shared/markdown/frontmatter';

export interface NoteFile {
  name: string;
  path: string;
  stats: {
    mtimeMs: number;
    ctimeMs: number;
    size: number;
  };
  // Short body preview (Apple Notes-style) filled in by the notes-tree scan.
  preview?: string;
}

export type LLMProvider = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'lmstudio' | 'ollama';

export interface SettingsState {
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
  // Custom editor-canvas background. `null`/undefined = theme default.
  // Any valid CSS color value (#rrggbb, rgb(), hsl()) overrides both light
  // and dark theme backgrounds for the writing pane only — chrome stays themed.
  editorBg?: string | null;
  // Git integration (all optional for backward-compat with persisted state)
  gitEnabled?: boolean;
  gitRemote?: string;
  gitAutoCommit?: boolean;
  gitDefaultBase?: string;   // default base branch for PRs, e.g. 'main'
  gitGhToken?: string;       // NOT persisted — loaded via safeStorage
  ragTopK?: number;
  ragMaxNotes?: number;
  ragContextChars?: number;
  ragDebug?: boolean;
  embeddingsEnabled?: boolean;
  embeddingProvider?: 'openai' | 'lmstudio' | 'ollama' | 'none';
  embeddingModel?: string;
  onboardingDismissed?: boolean;
  detectedLocalModels?: string[];
  autoCommitInterval?: number;
  enableAutoCommit?: boolean;
  mcpSseEnabled?: boolean;
  mcpSsePort?: number;
  smartTagsEnabled?: boolean;
  // Apple Notes-style: the first line (title) drives the .md filename.
  titleFollowsFilename?: boolean;
}

export interface FolderInfo {
  name: string;
  notes: NoteFile[];
}

function createOptimisticNote(fileName: string, content = ''): NoteFile {
  const now = Date.now();
  return {
    name: fileName,
    path: fileName,
    stats: {
      mtimeMs: now,
      ctimeMs: now,
      size: content.length,
    },
  };
}

function upsertOptimisticNote(
  notes: NoteFile[],
  noteFolders: FolderInfo[],
  note: NoteFile,
): Pick<NoteState, 'notes' | 'noteFolders'> {
  const nextNotes = [note, ...notes.filter(n => n.name !== note.name)];

  if (!note.name.includes('/')) {
    return { notes: nextNotes, noteFolders };
  }

  const [folderName] = note.name.split('/');
  let foundFolder = false;
  const nextFolders = noteFolders.map(folder => {
    if (folder.name !== folderName) return folder;
    foundFolder = true;
    return {
      ...folder,
      notes: [note, ...folder.notes.filter(n => n.name !== note.name)],
    };
  });

  if (!foundFolder) {
    nextFolders.push({ name: folderName, notes: [note] });
  }

  return { notes: nextNotes, noteFolders: nextFolders };
}

function ensureOptimisticNoteVisible(
  state: NoteState,
  fileName: string,
  content = '',
): Pick<NoteState, 'notes' | 'noteFolders'> | null {
  if (state.notes.some(note => note.name === fileName)) return null;
  return upsertOptimisticNote(state.notes, state.noteFolders, createOptimisticNote(fileName, content));
}

interface NoteState {
  notes: NoteFile[];           // flat list (root + all subfolders) for search/backlinks
  noteFolders: FolderInfo[];   // subfolders with their notes
  activeNoteName: string | null;
  activeNoteContent: string;
  activeNoteFrontmatter: string | null;
  isLoading: boolean;
  pinnedNotes: string[];
  noteLinksIndex: Record<string, string[]>;
  tagIndex: Record<string, string[]>;
  lastOpenedNote: string | null;
  // Set during a title->filename self-rename so the editor can skip its
  // reload/refocus (the content is already live in the editor).
  pendingSelfRename: string | null;

  // Custom Sort / Drag and Drop Reordering
  customNotesOrder: string[];
  customFoldersOrder: string[];
  sortBy: 'date' | 'name' | 'size' | 'custom';
  setCustomNotesOrder: (order: string[]) => void;
  setCustomFoldersOrder: (order: string[]) => void;
  setSortBy: (sortBy: 'date' | 'name' | 'size' | 'custom') => void;

  // Settings
  settings: SettingsState;

  // Actions
  fetchNotes: () => Promise<void>;
  createNote: (fileName: string, initialContent?: string) => Promise<void>;
  openNote: (fileName: string) => Promise<void>;
  saveActiveNote: (content: string) => Promise<void>;
  deleteNote: (fileName: string) => Promise<void>;
  renameNote: (oldName: string, newName: string, opts?: { reopen?: boolean }) => Promise<void>;
  syncActiveNoteTitle: (title: string) => Promise<void>;
  clearPendingSelfRename: () => void;
  addNotesToProject: (slug: string, noteNames: string[]) => Promise<void>;
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
  wipeAllNotes: () => Promise<void>;
}

export const useStore = create<NoteState>()(
  persist(
    (set, get) => ({
      notes: [],
      activeNoteName: null,
      activeNoteContent: '',
      activeNoteFrontmatter: null,
      isLoading: false,
      pinnedNotes: [],
      customTemplates: [],
      noteLinksIndex: {},
      tagIndex: {},
      noteFolders: [],
      lastOpenedNote: null,
      pendingSelfRename: null,
      customNotesOrder: [],
      customFoldersOrder: [],
      sortBy: 'date',

      setCustomNotesOrder: (order) => set({ customNotesOrder: order }),
      setCustomFoldersOrder: (order) => set({ customFoldersOrder: order }),
      setSortBy: (sortBy) => set({ sortBy }),

      settings: {
        llmProvider: 'lmstudio',
        llmApiKey: '',
        llmModel: '',
        lmStudioUrl: 'http://localhost:1234/v1',
        syncDirectory: null,
        showToolbar: true,
        showAiBar: false,
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
        ragTopK: 3,
        ragMaxNotes: 100,
        ragContextChars: 8000,
        ragDebug: false,
        embeddingsEnabled: false,
        embeddingProvider: 'none',
        embeddingModel: '',
        onboardingDismissed: false,
        showHints: true,
        aiGhostMode: 'manual' as const,
        editorWidth: 'normal' as const,
        editorBg: null,
        detectedLocalModels: [],
        autoCommitInterval: 5,
        enableAutoCommit: false,
        mcpSseEnabled: false,
        mcpSsePort: 3000,
        smartTagsEnabled: false,
        titleFollowsFilename: true,
      },

      updateSettings: (newSettings) => {
        const api = getElectronApi();
        if (newSettings.gitGhToken !== undefined && api) {
          // Store GitHub token encrypted — same mechanism as LLM API key
          // We reuse the same safeStorage slot with a namespaced key approach:
          // Electron safeStorage only has one slot, so we store a JSON object.
          // For simplicity, store separately via a dedicated IPC if available,
          // otherwise keep in memory only (not persisted).
          newSettings = { ...newSettings, gitGhToken: '' };
        }
        if (newSettings.llmApiKey !== undefined && api) {
          api.storeApiKey(newSettings.llmApiKey);
          newSettings = { ...newSettings, llmApiKey: '' };
        }
        set({ settings: { ...get().settings, ...newSettings } });
      },

      loadApiKey: async () => {
        const api = getElectronApi();
        if (api) {
          const res = await api.getApiKey();
          if (res.success && res.data) {
            set((state) => ({ settings: { ...state.settings, llmApiKey: res.data as string } }));
          }
        }
      },

      fetchNotes: async () => {
    set({ isLoading: true });
    const api = getElectronApi();
    if (api) {
      const syncDir = get().settings.syncDirectory || undefined;
      const treeRes = await api.getNotesTree?.(syncDir);
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
        const res = await api.getNotesList(syncDir);
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
    const api = getElectronApi();
    if (!api) throw new Error('electronAPI non disponibile');
    const lang = get().settings.language ?? 'en';
    const defaultContent = lang === 'it'
      ? '<h1>Nuova Nota</h1><p>Inizia a scrivere qui…</p>'
      : '<h1>New Note</h1><p>Start writing here…</p>';
    const content = initialContent ?? defaultContent;
      const res = await api.saveNote(fileName, content, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? 'Impossibile creare la nota');

    const currentNotesOrder = get().customNotesOrder || [];
    const newOrder = [fileName, ...currentNotesOrder.filter(n => n !== fileName)];
    const optimisticNote = createOptimisticNote(fileName, content);
    set(state => ({
      ...upsertOptimisticNote(state.notes, state.noteFolders, optimisticNote),
      customNotesOrder: newOrder,
      sortBy: 'custom',
    }));

    await get().openNote(fileName);
    await get().fetchNotes();
    set(state => ensureOptimisticNoteVisible(state, fileName, content) ?? state);
  },

  openNote: async (fileName: string) => {
    const api = getElectronApi();
    if (api) {
      const res = await api.readNote(fileName, get().settings.syncDirectory || undefined);
      if (res.success && res.data !== undefined) {
        let content = res.data as string;
        let frontmatter: string | null = null;
        const trimmed = content.trimStart();
        if (trimmed.startsWith('<')) {
          const extracted = extractHtmlFrontmatterComment(content);
          frontmatter = extracted.frontmatter;
          content = extracted.body;
        } else {
          const extracted = extractMarkdownFrontmatter(content);
          frontmatter = extracted.frontmatter;
          content = marked.parse(extracted.body, { breaks: true, gfm: true, async: false }) as string;
        }
        const links = extractWikilinks(content);
        set(state => ({
          activeNoteName: fileName,
          activeNoteContent: content,
          activeNoteFrontmatter: frontmatter,
          noteLinksIndex: { ...state.noteLinksIndex, [fileName]: links },
          lastOpenedNote: fileName,
          pendingSelfRename: null,
        }));
      }
    }
  },

  saveActiveNote: async (content: string) => {
    const { activeNoteName } = get();
    const api = getElectronApi();
    if (activeNoteName && api) {
      const frontmatter = get().activeNoteFrontmatter;
      const contentToSave = prependFrontmatterComment(content, frontmatter);
      const res = await api.saveNote(activeNoteName, contentToSave, get().settings.syncDirectory || undefined);
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
        if (gitEnabled && gitAutoCommit && api?.gitCommitNote) {
          void api.gitCommitNote(activeNoteName, undefined, syncDirectory || undefined);
        }
      }
    }
  },

  renameNote: async (oldName: string, newName: string, opts?: { reopen?: boolean }) => {
    if (!newName.endsWith('.md')) newName += '.md';
    const api = getElectronApi();
    if (!api) return;
    const res = await api.renameNote(oldName, newName, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? 'Rename failed');

    const currentNotesOrder = get().customNotesOrder || [];
    const newNotesOrder = currentNotesOrder.map(n => n === oldName ? newName : n);
    set({
      customNotesOrder: newNotesOrder,
    });

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
      if (opts?.reopen === false) {
        // Self-rename (title->filename): the content is already live in the
        // editor, so swap the name in place and let the editor skip its reload.
        set({ activeNoteName: newName, lastOpenedNote: newName, pendingSelfRename: newName });
      } else {
        // Re-open by name so activeNoteContent is in sync with the renamed file
        await get().openNote(newName);
      }
    }
  },

  clearPendingSelfRename: () => set({ pendingSelfRename: null }),

  syncActiveNoteTitle: async (title: string) => {
    const { activeNoteName, settings } = get();
    if (!activeNoteName || settings.titleFollowsFilename === false) return;
    const slash = activeNoteName.lastIndexOf('/');
    const folder = slash >= 0 ? activeNoteName.slice(0, slash + 1) : '';
    const currentStem = activeNoteName.slice(slash + 1).replace(/\.md$/, '');
    const stem = slugifyTitle(title);
    if (!stem || stem === currentStem) return;
    // Collision-safe candidate name within the same folder.
    const taken = new Set(get().notes.map(n => n.name));
    let candidate = `${folder}${stem}.md`;
    let n = 2;
    while (taken.has(candidate) && candidate !== activeNoteName) {
      candidate = `${folder}${stem} ${n}.md`;
      n++;
    }
    if (candidate === activeNoteName) return;
    try {
      await get().renameNote(activeNoteName, candidate, { reopen: false });
    } catch {
      // Best-effort: a failed rename just leaves the filename as-is; we retry
      // on the next title edit.
    }
  },

  addNotesToProject: async (slug: string, noteNames: string[]) => {
    const api = getElectronApi();
    if (!api || !noteNames.length) return;
    const tag = `#project/${slug}`;
    const syncDir = get().settings.syncDirectory || undefined;
    // Append the project tag to each note file (these are notes other than the
    // one open in the editor, so writing their files directly is safe).
    for (const name of noteNames) {
      try {
        const res = await api.readNote(name, syncDir);
        if (!res.success || res.data === undefined) continue;
        const content = res.data as string;
        if (content.includes(tag)) continue;
        await api.saveNote(name, `${content.trimEnd()}\n<p>${tag}</p>`, syncDir);
      } catch {
        // skip unreadable/unwritable notes
      }
    }
    set(state => {
      const idx = { ...state.tagIndex };
      const members = new Set(idx[tag] ?? []);
      noteNames.forEach(n => members.add(n));
      idx[tag] = [...members];
      return { tagIndex: idx };
    });
    await get().fetchNotes();
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
    const api = getElectronApi();
    if (!api) return;
    const res = await api.saveNote(fileName, template.content, get().settings.syncDirectory || undefined);
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
    const api = getElectronApi();
    if (!api) return;
    const res = await api.saveNote(fileName, initialContent, get().settings.syncDirectory || undefined);
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
    const api = getElectronApi();
    if (!api) return;
    const res = await api.deleteNote(fileName, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? 'Impossibile eliminare la nota');
    const { activeNoteName } = get();
    
    const currentNotesOrder = get().customNotesOrder || [];
    set(state => ({
      activeNoteName: activeNoteName === fileName ? null : state.activeNoteName,
      activeNoteContent: activeNoteName === fileName ? '' : state.activeNoteContent,
      activeNoteFrontmatter: activeNoteName === fileName ? null : state.activeNoteFrontmatter,
      pinnedNotes: state.pinnedNotes.filter(n => n !== fileName),
      customNotesOrder: currentNotesOrder.filter(n => n !== fileName),
    }));
    await get().fetchNotes();
  },

  createFolder: async (name: string) => {
    const api = getElectronApi();
    if (!api) return;
    const res = await api.createFolder(name, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? 'Impossibile creare la cartella');
    
    const currentFoldersOrder = get().customFoldersOrder || [];
    const newOrder = [name, ...currentFoldersOrder.filter(f => f !== name)];
    set({
      customFoldersOrder: newOrder,
      sortBy: 'custom',
    });
    
    await get().fetchNotes();
  },

  renameFolder: async (oldName: string, newName: string) => {
    const api = getElectronApi();
    if (!api) return;
    const res = await api.renameFolder(oldName, newName, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? 'Impossibile rinominare la cartella');
    
    const currentFoldersOrder = get().customFoldersOrder || [];
    const newFoldersOrder = currentFoldersOrder.map(f => f === oldName ? newName : f);
    
    const currentNotesOrder = get().customNotesOrder || [];
    const newNotesOrder = currentNotesOrder.map(n => {
      if (n.startsWith(`${oldName}/`)) {
        return `${newName}/${n.slice(oldName.length + 1)}`;
      }
      return n;
    });

    set({
      customFoldersOrder: newFoldersOrder,
      customNotesOrder: newNotesOrder,
    });

    const { activeNoteName } = get();
    await get().fetchNotes();
    if (activeNoteName?.startsWith(`${oldName}/`)) {
      const newNoteName = `${newName}/${activeNoteName.slice(oldName.length + 1)}`;
      await get().openNote(newNoteName);
    }
  },

  deleteFolder: async (name: string) => {
    const api = getElectronApi();
    if (!api) return;
    const res = await api.deleteFolder(name, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? 'Impossibile eliminare la cartella');
    
    const currentFoldersOrder = get().customFoldersOrder || [];
    const currentNotesOrder = get().customNotesOrder || [];
    set({
      customFoldersOrder: currentFoldersOrder.filter(f => f !== name),
      customNotesOrder: currentNotesOrder.filter(n => !n.startsWith(`${name}/`)),
    });

    await get().fetchNotes();
  },

  moveNote: async (fileName: string, toFolder: string) => {
    const api = getElectronApi();
    if (!api) return;
    const res = await api.moveNote(fileName, toFolder, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? 'Impossibile spostare la nota');
    const { activeNoteName } = get();
    
    const newPath = res.data as string;
    if (newPath) {
      const currentNotesOrder = get().customNotesOrder || [];
      const newNotesOrder = currentNotesOrder.map(n => n === fileName ? newPath : n);
      set({
        customNotesOrder: newNotesOrder,
      });
    }

    if (activeNoteName === fileName && res.data) {
      await get().openNote(res.data);
    }
    await get().fetchNotes();
  },

  wipeAllNotes: async () => {
    const api = getElectronApi();
    if (!api) return;
    const res = await api.wipeAllNotes(get().settings.syncDirectory || undefined);
    if (!res.success) {
      throw new Error(res.error ?? 'Impossibile cancellare tutte le note');
    }
    set({
      notes: [],
      pinnedNotes: [],
      customTemplates: [],
      noteLinksIndex: {},
      tagIndex: {},
      noteFolders: [],
      lastOpenedNote: null,
      pendingSelfRename: null,
      customNotesOrder: [],
      customFoldersOrder: [],
      activeNoteName: null,
      activeNoteContent: '',
      activeNoteFrontmatter: null,
    });
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
    customNotesOrder: state.customNotesOrder,
    customFoldersOrder: state.customFoldersOrder,
    sortBy: state.sortBy,
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
