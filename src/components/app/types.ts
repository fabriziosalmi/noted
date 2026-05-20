import type { Editor } from '@tiptap/react';
import type { AppPanelsApi } from '../../hooks/contracts';
import type { TranslationKey } from '../../lib/i18n';
import type { Suggestion } from '../../lib/noteAdvisor';
import type { NoteChunk } from '../../lib/noteSearch';
import type { NoteTemplate } from '../../lib/templates';
import type { NoteFile, SettingsState } from '../../store/useStore';
import type { RefObject } from 'react';

export type ToastVariant = 'success' | 'error';
export type UpdateSettingsFn = (patch: Partial<SettingsState>) => void;
export type OpenNoteFn = (name: string) => Promise<void>;
export type SaveActiveNoteFn = (content: string) => Promise<void>;
export type CreateNoteFn = (folder?: string) => Promise<void>;
export type DeleteNoteFn = (name: string) => Promise<void>;
export type RenameNoteFn = (oldName: string, newName: string) => Promise<void>;
export type OpenDailyFn = () => Promise<void>;
export type CreateFolderFn = (name: string) => Promise<void>;
export type RenameFolderFn = (oldName: string, newName: string) => Promise<void>;
export type DeleteFolderFn = (name: string) => Promise<void>;
export type MoveNoteFn = (fileName: string, destination: string) => Promise<void>;
export type TogglePinFn = (name: string) => void;
export type DismissToastFn = (id: number) => void;
export type DismissSuggestionFn = (id: string) => void;

export interface AppSharedProps {
  t: (key: TranslationKey) => string;
  panels: AppPanelsApi;
  settings: SettingsState;
}

export interface AppChromeProps extends AppSharedProps {
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
  editorRef: RefObject<Editor | null>;
  onToast: (text: string, variant?: ToastVariant) => void;
  onToastError: (msg: string) => void;
  onUpdateSettings: UpdateSettingsFn;
  onSetActiveTagFilter: (tag: string | null) => void;
  onOpenNote: OpenNoteFn;
  onSaveActiveNote: SaveActiveNoteFn;
  onHandleCreateNote: CreateNoteFn;
  onHandleDeleteNote: DeleteNoteFn;
  onHandleRenameNote: RenameNoteFn;
  onHandleOpenDaily: OpenDailyFn;
  onHandleCreateFolder: CreateFolderFn;
  onHandleRenameFolder: RenameFolderFn;
  onHandleDeleteFolder: DeleteFolderFn;
  onHandleMoveNote: MoveNoteFn;
  onTogglePin: TogglePinFn;
  onGetEditorText: () => string;
  onEditorReady: (editor: Editor | null) => void;
}

export interface AppModalsProps extends AppSharedProps {
  notes: NoteFile[];
  activeNoteName: string | null;
  activeNoteContent: string;
  customTemplates: NoteTemplate[];
  suggestions: Suggestion[];
  toastMessages: { id: number; text: string; variant: ToastVariant }[];
  onDismissToast: DismissToastFn;
  onDismissSuggestion: DismissSuggestionFn;
  onDismissAllSuggestions: () => void;
  onHandleAdvisorAction: (s: Suggestion) => void;
  onOpenNote: OpenNoteFn;
  onSaveActiveNote: SaveActiveNoteFn;
  onCreateFromTemplate: (t: NoteTemplate) => Promise<void>;
  onSaveAsTemplate: (name: string, content: string) => void;
  onDeleteTemplate: (id: string) => void;
  onUpdateSettings: UpdateSettingsFn;
  onHandleSelectFolder: () => Promise<void>;
  onHandleImportVault: () => Promise<void>;
  onHandleCreateNote: CreateNoteFn;
  onHandleOpenDaily: OpenDailyFn;
}
