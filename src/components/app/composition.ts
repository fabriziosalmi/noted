import type { Editor } from '@tiptap/react';
import type { Suggestion } from '../../lib/noteAdvisor';
import type { NoteChunk } from '../../lib/noteSearch';
import type { NoteTemplate } from '../../lib/templates';
import type { NoteFile, SettingsState } from '../../store/useStore';
import type { TranslationKey } from '../../lib/i18n';
import type { AppPanelsApi } from '../../hooks/contracts';
import type { AppChromeProps, AppModalsProps } from './types';

interface AppCompositionState {
  t: (key: TranslationKey) => string;
  panels: AppPanelsApi;
  settings: SettingsState;
  notes: NoteFile[];
  filteredNotes: NoteFile[];
  noteFolders: { name: string; notes: NoteFile[] }[];
  activeNoteName: string | null;
  activeNoteContent: string;
  pinnedNotes: string[];
  allTags: string[];
  activeTagFilter: string | null;
  suggestions: Suggestion[];
  noteChunks: NoteChunk[];
  noteLinksIndex: Record<string, string[]>;
  allNoteNames: string[];
  backlinks: string[];
  focusClass: string;
  typewriterClass: string;
  activeEditor: Editor | null;
  customTemplates: NoteTemplate[];
  toastMessages: { id: number; text: string; variant: 'success' | 'error' }[];
}

interface AppCompositionActions {
  onToast: (text: string, variant?: 'success' | 'error') => void;
  onToastError: (msg: string) => void;
  onUpdateSettings: (patch: Partial<SettingsState>) => void;
  onSetActiveTagFilter: (tag: string | null) => void;
  onOpenNote: (name: string) => Promise<void>;
  onSaveActiveNote: (content: string) => Promise<void>;
  onHandleCreateNote: (folder?: string) => Promise<void>;
  onHandleDeleteNote: (name: string) => Promise<void>;
  onHandleRenameNote: (oldName: string, newName: string) => Promise<void>;
  onHandleOpenDaily: () => Promise<void>;
  onHandleCreateFolder: (name: string) => Promise<void>;
  onHandleRenameFolder: (oldName: string, newName: string) => Promise<void>;
  onHandleDeleteFolder: (name: string) => Promise<void>;
  onHandleMoveNote: (fileName: string, destination: string) => Promise<void>;
  onTogglePin: (name: string) => void;
  onDismissToast: (id: number) => void;
  onDismissSuggestion: (id: string) => void;
  onDismissAllSuggestions: () => void;
  onCreateFromTemplate: (t: NoteTemplate) => Promise<void>;
  onSaveAsTemplate: (name: string, content: string) => void;
  onDeleteTemplate: (id: string) => void;
  onHandleSelectFolder: () => Promise<void>;
  onHandleImportVault: () => Promise<void>;
}

export interface AppCompositionContract {
  chrome: Omit<AppChromeProps, 'editorRef' | 'onGetEditorText' | 'onEditorReady'>;
  modals: Omit<AppModalsProps, 'onHandleAdvisorAction'>;
}

export function createAppComposition(
  state: AppCompositionState,
  actions: AppCompositionActions,
): AppCompositionContract {
  const chrome: Omit<AppChromeProps, 'editorRef' | 'onGetEditorText' | 'onEditorReady'> = {
    t: state.t,
    panels: state.panels,
    settings: state.settings,
    notes: state.notes,
    filteredNotes: state.filteredNotes,
    noteFolders: state.noteFolders,
    activeNoteName: state.activeNoteName,
    activeNoteContent: state.activeNoteContent,
    pinnedNotes: state.pinnedNotes,
    allTags: state.allTags,
    activeTagFilter: state.activeTagFilter,
    suggestions: state.suggestions,
    noteChunks: state.noteChunks,
    noteLinksIndex: state.noteLinksIndex,
    allNoteNames: state.allNoteNames,
    backlinks: state.backlinks,
    focusClass: state.focusClass,
    typewriterClass: state.typewriterClass,
    activeEditor: state.activeEditor,
    onToast: actions.onToast,
    onToastError: actions.onToastError,
    onUpdateSettings: actions.onUpdateSettings,
    onSetActiveTagFilter: actions.onSetActiveTagFilter,
    onOpenNote: actions.onOpenNote,
    onSaveActiveNote: actions.onSaveActiveNote,
    onHandleCreateNote: actions.onHandleCreateNote,
    onHandleDeleteNote: actions.onHandleDeleteNote,
    onHandleRenameNote: actions.onHandleRenameNote,
    onHandleOpenDaily: actions.onHandleOpenDaily,
    onHandleCreateFolder: actions.onHandleCreateFolder,
    onHandleRenameFolder: actions.onHandleRenameFolder,
    onHandleDeleteFolder: actions.onHandleDeleteFolder,
    onHandleMoveNote: actions.onHandleMoveNote,
    onTogglePin: actions.onTogglePin,
  };

  const modals: Omit<AppModalsProps, 'onHandleAdvisorAction'> = {
    t: state.t,
    panels: state.panels,
    settings: state.settings,
    notes: state.notes,
    activeNoteName: state.activeNoteName,
    activeNoteContent: state.activeNoteContent,
    customTemplates: state.customTemplates,
    suggestions: state.suggestions,
    toastMessages: state.toastMessages,
    onDismissToast: actions.onDismissToast,
    onDismissSuggestion: actions.onDismissSuggestion,
    onDismissAllSuggestions: actions.onDismissAllSuggestions,
    onOpenNote: actions.onOpenNote,
    onSaveActiveNote: actions.onSaveActiveNote,
    onCreateFromTemplate: actions.onCreateFromTemplate,
    onSaveAsTemplate: actions.onSaveAsTemplate,
    onDeleteTemplate: actions.onDeleteTemplate,
    onUpdateSettings: actions.onUpdateSettings,
    onHandleSelectFolder: actions.onHandleSelectFolder,
    onHandleImportVault: actions.onHandleImportVault,
    onHandleCreateNote: actions.onHandleCreateNote,
    onHandleOpenDaily: actions.onHandleOpenDaily,
    onToast: actions.onToast,
  };

  return { chrome, modals };
}
