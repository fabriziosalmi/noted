import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { marked } from 'marked';
import type { NoteTemplate } from '../lib/templates';
import { extractWikilinks } from '../lib/WikilinkExtension';
import { extractTags } from '../lib/tagUtils';
import { slugifyTitle } from '../lib/noteTitle';
import { translate } from '../lib/i18n';
import { getElectronApi } from '../lib/electronApi';
import {
  extractHtmlFrontmatterComment,
  extractMarkdownFrontmatter,
  prependFrontmatterComment,
} from '../../shared/markdown/frontmatter';
import {
  readAgentMetadata,
  writeAgentMetadata,
  applyEngineResultToHtml,
  advance,
  approveGate,
  rejectGate,
  applyTaskStatusToWorkflow,
  AgentEngineError,
  type AgentMetadata,
  type EngineContext,
  type EngineResult,
  type TaskStatus,
} from '../../shared/agent';

/** A human-initiated agent transition from the interactive panel. */
export type AgentUiAction =
  | { kind: 'advance'; to: string }
  | { kind: 'approve' }
  | { kind: 'reject'; reason?: string };

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

export type LLMProvider = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'openai-compatible' | 'lmstudio' | 'ollama';

export interface SettingsState {
  llmProvider: LLMProvider;
  llmApiKey: string;
  llmModel: string;
  lmStudioUrl: string;
  /** Base URL for the generic 'openai-compatible' provider (e.g. Regolo). */
  openaiCompatibleUrl: string;
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
  shortcutsSeen?: boolean;
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

  // Screen-reader live-region message (opened/renamed announcements). Rendered
  // in a visually-hidden aria-live region at the app root.
  srAnnouncement: string;

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
  createTitledNote: (title: string, folder?: string) => Promise<void>;
  openNote: (fileName: string) => Promise<void>;
  saveActiveNote: (content: string) => Promise<void>;
  flushNoteToDisk: (name: string, content: string, frontmatter: string | null) => Promise<void>;
  deleteNote: (fileName: string) => Promise<void>;
  renameNote: (oldName: string, newName: string, opts?: { reopen?: boolean }) => Promise<void>;
  syncActiveNoteTitle: (title: string) => Promise<void>;
  clearPendingSelfRename: () => void;
  announce: (message: string) => void;
  applyAgentAction: (
    action: AgentUiAction,
    editorHtml: string,
  ) => Promise<{ newHtml: string } | { error: string }>;
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
  deleteFolder: (name: string) => Promise<string[]>;
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
      srAnnouncement: '',
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
        openaiCompatibleUrl: '',
        syncDirectory: null,
        showToolbar: true,
        showAiBar: false,
        piiMasking: true,
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
        shortcutsSeen: false,
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
    if (!api) throw new Error(translate('errNoElectronApi', get().settings.language));
    const lang = get().settings.language ?? 'en';
    const defaultContent = lang === 'it'
      ? '<h1>Nuova Nota</h1><p>Inizia a scrivere qui…</p>'
      : '<h1>New Note</h1><p>Start writing here…</p>';
    const content = initialContent ?? defaultContent;
      const res = await api.saveNote(fileName, content, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? translate('errCreateNote', get().settings.language));

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

  // Create a note whose filename follows a given title (Apple Notes-style
  // capture: ⌘P → type a name → Enter). Collision-safe within the folder; the
  // title is seeded as the <h1> so the caret lands right after it.
  createTitledNote: async (title: string, folder?: string) => {
    const trimmed = title.trim();
    const lang = get().settings.language ?? 'en';
    const stem = slugifyTitle(trimmed) || `${translate('newNoteFilePrefix', lang)}_${Date.now()}`;
    const prefix = folder ? `${folder}/` : '';
    const taken = new Set(get().notes.map(n => n.name));
    let candidate = `${prefix}${stem}.md`;
    let n = 2;
    while (taken.has(candidate)) {
      candidate = `${prefix}${stem} ${n}.md`;
      n++;
    }
    const safeTitle = trimmed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    await get().createNote(candidate, `<h1>${safeTitle}</h1><p></p>`);
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
      if (!res.success) {
        // Never let a failed write pass silently — the caller (editor autosave)
        // must surface it and keep the buffer dirty, or the app would claim
        // "Saved" over lost data.
        throw new Error(res.error || 'Failed to save note');
      }
      {
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

  // Durability flush: write a specific note's content to disk directly, with its
  // captured frontmatter. Used to drain the editor's pending autosave before a
  // note-switch / window-close so the last <debounce edits are never dropped.
  flushNoteToDisk: async (name: string, content: string, frontmatter: string | null) => {
    const api = getElectronApi();
    if (!api || !name) return;
    try {
      await api.saveNote(name, prependFrontmatterComment(content, frontmatter), get().settings.syncDirectory || undefined);
    } catch { /* best-effort; the editor's save status surfaces persistent failures */ }
  },

  applyAgentAction: async (action, editorHtml) => {
    const { activeNoteName, notes, settings } = get();
    const api = getElectronApi();
    const meta = readAgentMetadata(editorHtml);
    if (!meta) return { error: translate('errNoAgentMetadata', get().settings.language) };

    const ctx: EngineContext = { actor: 'user', now: new Date().toISOString() };

    // For a task, source the approval mode + sibling statuses from the governing
    // workflow note. Locate it by metadata id (robust to a renamed/auto-renamed
    // workflow file), not by filename prefix; the conventional wf-<id>- name is
    // tried first so the common case reads a single note.
    let workflow: { name: string; html: string; meta: AgentMetadata } | null = null;
    if (meta.type === 'task' && meta.workflowId && api && activeNoteName) {
      const slash = activeNoteName.lastIndexOf('/');
      const folderPrefix = slash === -1 ? '' : activeNoteName.slice(0, slash + 1);
      const wfName = `${folderPrefix}wf-${meta.workflowId}-`;
      const candidates = notes
        .filter(n =>
          n.name !== activeNoteName &&
          n.name.startsWith(folderPrefix) &&
          !n.name.slice(folderPrefix.length).includes('/'),
        )
        .sort((a, b) => (a.name.startsWith(wfName) ? 0 : 1) - (b.name.startsWith(wfName) ? 0 : 1));
      for (const cand of candidates) {
        try {
          const res = await api.readNote(cand.name, settings.syncDirectory || undefined);
          if (!res.success || typeof res.data !== 'string') continue;
          const m = readAgentMetadata(res.data);
          if (m && m.type === 'workflow' && m.id === meta.workflowId) {
            workflow = { name: cand.name, html: res.data, meta: m };
            ctx.mode = m.approvalMode;
            ctx.tasks = m.tasks;
            break;
          }
        } catch { /* skip unreadable */ }
      }
      // Fail safe: a task whose workflow can't be found is treated as the most
      // restrictive mode — never silently autonomous (which would skip gates).
      if (!workflow) ctx.mode = 'manual';
    }

    let result: EngineResult;
    try {
      result =
        action.kind === 'advance' ? advance(meta, action.to, ctx)
        : action.kind === 'approve' ? approveGate(meta, ctx)
        : rejectGate(meta, { ...ctx, reason: action.reason });
    } catch (e) {
      if (e instanceof AgentEngineError) return { error: e.message };
      throw e;
    }

    const newHtml = applyEngineResultToHtml(editorHtml, result);
    if (!newHtml) return { error: translate('errAgentUpdateFailed', get().settings.language) };

    // Persist the active note itself first (the primary write), so a fast
    // note-switch can't drop the transition via the editor's debounced autosave.
    if (api && activeNoteName) {
      const withFrontmatter = prependFrontmatterComment(newHtml, get().activeNoteFrontmatter);
      try {
        await api.saveNote(activeNoteName, withFrontmatter, settings.syncDirectory || undefined);
      } catch { /* the editor's autosave remains a fallback */ }
    }

    // Then mirror the task status into the workflow note (secondary, best-effort).
    if (meta.type === 'task' && workflow && meta.id && api) {
      const mirrored = applyTaskStatusToWorkflow(workflow.meta, meta.id, result.metadata.status as TaskStatus, ctx.now);
      if (mirrored !== workflow.meta) {
        const wfNew = writeAgentMetadata(workflow.html, mirrored);
        if (wfNew) {
          try { await api.saveNote(workflow.name, wfNew, settings.syncDirectory || undefined); } catch { /* best-effort */ }
        }
      }
    }

    return { newHtml };
  },

  renameNote: async (oldName: string, newName: string, opts?: { reopen?: boolean }) => {
    if (!newName.endsWith('.md')) newName += '.md';
    const api = getElectronApi();
    if (!api) return;
    const res = await api.renameNote(oldName, newName, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? translate('errRenameFailed', get().settings.language));

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

    // Retarget the active name synchronously (before the async fetchNotes) for a
    // self-rename, so a debounced autosave firing during fetchNotes can't save
    // to — and resurrect — the old filename.
    const wasActive = get().activeNoteName === oldName;
    if (wasActive && opts?.reopen === false) {
      // Self-rename (title->filename): content is already live in the editor,
      // so swap the name in place and let the editor skip its reload.
      set({ activeNoteName: newName, lastOpenedNote: newName, pendingSelfRename: newName });
    }

    await get().fetchNotes();

    if (wasActive && opts?.reopen !== false) {
      // Re-open by name so activeNoteContent is in sync with the renamed file.
      await get().openNote(newName);
    }
  },

  clearPendingSelfRename: () => set({ pendingSelfRename: null }),
  announce: (message: string) => set({ srAnnouncement: message }),

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
    if (!res.success) throw new Error(res.error ?? translate('errCreateNote', get().settings.language));
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
    const lang = get().settings.language ?? 'en';
    const dateLocale: Record<string, string> = { en: 'en-US', it: 'it-IT', es: 'es-ES', pt: 'pt-PT', fr: 'fr-FR', de: 'de-DE' };
    const title = new Intl.DateTimeFormat(dateLocale[lang] ?? 'en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }).format(today);
    const sec = {
      notes: translate('dailySectionNotes', lang),
      todo: translate('dailySectionTodo', lang),
      ideas: translate('dailySectionIdeas', lang),
    };
    const initialContent = `<h1>${title}</h1><h2>${sec.notes}</h2><p></p><h2>${sec.todo}</h2><ul><li><p></p></li></ul><h2>${sec.ideas}</h2><p></p>`;
    const api = getElectronApi();
    if (!api) return;
    const res = await api.saveNote(fileName, initialContent, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? translate('errCreateDaily', get().settings.language));
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
    if (!res.success) throw new Error(res.error ?? translate('errDeleteNote', get().settings.language));
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
    if (!res.success) throw new Error(res.error ?? translate('errCreateFolder', get().settings.language));
    
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
    if (!res.success) throw new Error(res.error ?? translate('errRenameFolder', get().settings.language));
    
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
    if (!api) return [];
    const res = await api.deleteFolder(name, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? translate('errDeleteFolder', get().settings.language));

    const currentFoldersOrder = get().customFoldersOrder || [];
    const currentNotesOrder = get().customNotesOrder || [];
    set({
      customFoldersOrder: currentFoldersOrder.filter(f => f !== name),
      customNotesOrder: currentNotesOrder.filter(n => !n.startsWith(`${name}/`)),
    });

    await get().fetchNotes();
    // Notes moved out of the folder are renamed rather than overwritten when a
    // root note already holds the name; the caller tells the user which.
    return res.data?.renamed ?? [];
  },

  moveNote: async (fileName: string, toFolder: string) => {
    const api = getElectronApi();
    if (!api) return;
    const res = await api.moveNote(fileName, toFolder, get().settings.syncDirectory || undefined);
    if (!res.success) throw new Error(res.error ?? translate('errMoveNote', get().settings.language));
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
      throw new Error(res.error ?? translate('errWipeNotes', get().settings.language));
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
      srAnnouncement: '',
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
