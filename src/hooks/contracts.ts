import type { NoteFile, SettingsState } from '../store/useStore';
import type { TranslationKey } from '../lib/i18n';

export type ToastVariant = 'success' | 'error';
export type ToastFn = (text: string, variant?: ToastVariant) => void;
export type TranslatorFn = (key: TranslationKey) => string;

export interface AppActionsArgs {
  t: TranslatorFn;
  syncDirectory: string | null;
  toast: ToastFn;
  fetchNotes: () => Promise<void>;
  createNote: (fileName: string, initialContent?: string) => Promise<void>;
  openOrCreateDaily: () => Promise<void>;
  deleteNote: (fileName: string) => Promise<void>;
  renameNote: (oldName: string, newName: string) => Promise<void>;
  updateSettings: (newSettings: { syncDirectory?: string }) => void;
  createFolder: (name: string) => Promise<void>;
  renameFolder: (oldName: string, newName: string) => Promise<void>;
  deleteFolder: (name: string) => Promise<void>;
  moveNote: (fileName: string, toFolder: string) => Promise<void>;
}

export interface GlobalShortcutsArgs {
  onToggleShortcuts: () => void;
  onToggleQuickOpen: () => void;
  onToggleFind: () => void;
  onToggleGlobalSearch: () => void;
  onToggleFocusMode: () => void;
  onCreateNote: () => void;
}

export interface AppLifecycleArgs {
  accentColor?: string;
  editorBg?: string | null;
  activeNoteName: string | null;
  fetchNotes: () => Promise<void>;
  loadApiKey: () => Promise<void>;
}

export interface NoteChunksArgs {
  rightOpen: boolean;
  notes: NoteFile[];
  syncDirectory: string | null;
  ragMaxNotes?: number;
}

export interface AppDerivedStateSettings {
  editorFont?: string;
  editorFontSize?: string;
  focusMode?: boolean;
  typewriterMode?: boolean;
}

export interface AppDerivedStateArgs {
  notes: NoteFile[];
  noteLinksIndex: Record<string, string[]>;
  tagIndex: Record<string, string[]>;
  activeNoteName: string | null;
  activeTagFilter: string | null;
  settings: AppDerivedStateSettings;
}

export interface AppDerivedStateResult {
  allTags: string[];
  filteredNotes: NoteFile[];
  backlinks: string[];
  allNoteNames: string[];
  fontClass: string;
  sizeClass: string;
  focusClass: string;
  typewriterClass: string;
}

export interface AppPanelsState {
  leftOpen: boolean;
  rightOpen: boolean;
  rightTab: 'ai' | 'analytics' | 'graph';
  isSettingsOpen: boolean;
  isShortcutsOpen: boolean;
  isAdvisorOpen: boolean;
  isTemplatesOpen: boolean;
  isHistoryOpen: boolean;
  isGitOpen: boolean;
  findOpen: boolean;
  quickOpenOpen: boolean;
  globalSearchOpen: boolean;
}

export interface AppPanelsApi extends AppPanelsState {
  setRightTab: (tab: 'ai' | 'analytics' | 'graph') => void;
  setFindOpen: (open: boolean) => void;
  toggleLeftOpen: () => void;
  toggleRightOpen: () => void;
  toggleShortcuts: () => void;
  toggleQuickOpen: () => void;
  toggleFind: () => void;
  toggleGlobalSearch: () => void;
  toggleTemplates: () => void;
  toggleAdvisor: () => void;
  toggleGit: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openShortcuts: () => void;
  closeShortcuts: () => void;
  openAdvisor: () => void;
  closeAdvisor: () => void;
  openTemplates: () => void;
  closeTemplates: () => void;
  openHistory: () => void;
  closeHistory: () => void;
  closeGit: () => void;
  closeQuickOpen: () => void;
  closeGlobalSearch: () => void;
}

export type AppSettings = SettingsState;
