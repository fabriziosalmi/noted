import { describe, expect, it, vi } from 'vitest';
import { createAppComposition } from './composition';
import type { Suggestion } from '../../lib/noteAdvisor';
import type { NoteChunk } from '../../lib/noteSearch';
import type { NoteTemplate } from '../../lib/templates';
import type { AppPanelsApi } from '../../hooks/contracts';
import type { NoteFile, SettingsState } from '../../store/useStore';

function createPanelsStub(): AppPanelsApi {
  return {
    leftOpen: true,
    rightOpen: false,
    rightTab: 'ai',
    isSettingsOpen: false,
    isShortcutsOpen: false,
    isAdvisorOpen: false,
    isTemplatesOpen: false,
    isHistoryOpen: false,
    isGitOpen: false,
    findOpen: false,
    quickOpenOpen: false,
    globalSearchOpen: false,
    setRightTab: vi.fn(),
    setFindOpen: vi.fn(),
    toggleLeftOpen: vi.fn(),
    toggleRightOpen: vi.fn(),
    toggleShortcuts: vi.fn(),
    toggleQuickOpen: vi.fn(),
    toggleFind: vi.fn(),
    toggleGlobalSearch: vi.fn(),
    toggleTemplates: vi.fn(),
    toggleAdvisor: vi.fn(),
    toggleGit: vi.fn(),
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    openShortcuts: vi.fn(),
    closeShortcuts: vi.fn(),
    openAdvisor: vi.fn(),
    closeAdvisor: vi.fn(),
    openTemplates: vi.fn(),
    closeTemplates: vi.fn(),
    openHistory: vi.fn(),
    closeHistory: vi.fn(),
    closeGit: vi.fn(),
    closeQuickOpen: vi.fn(),
    closeGlobalSearch: vi.fn(),
  };
}

describe('createAppComposition', () => {
  it('maps shared state/actions to chrome and modals contracts', () => {
    const note: NoteFile = {
      name: 'test.md',
      path: '/tmp/test.md',
      stats: { mtimeMs: 1, ctimeMs: 1, size: 1 },
    };
    const suggestion: Suggestion = {
      id: 's1',
      kind: 'org-split',
      severity: 'low',
      titleKey: 'advSplitTitle',
      detailKey: 'advSplitDetail',
      noteName: 'test.md',
      action: 'open',
    };
    const template: NoteTemplate = {
      id: 'tpl1',
      name: 'Template',
      icon: 'custom',
      content: '<p>hello</p>',
    };
    const chunk: NoteChunk = { name: 'test.md', text: 'hello world' };
    const settings = {
      llmProvider: 'lmstudio',
      llmApiKey: '',
      llmModel: '',
      lmStudioUrl: 'http://localhost:1234/v1',
      syncDirectory: null,
      showToolbar: true,
      showAiBar: true,
      theme: 'auto',
      accentColor: '#6366f1',
      focusMode: false,
      editorFont: 'system',
      editorFontSize: 'md',
      typewriterMode: false,
      language: 'en',
    } as SettingsState;
    const panels = createPanelsStub();

    const onOpenNote = vi.fn(async (_name: string) => undefined);
    const onSaveActiveNote = vi.fn(async (_content: string) => undefined);
    const onHandleCreateNote = vi.fn(async (_folder?: string) => undefined);
    const onHandleDeleteNote = vi.fn(async (_name: string) => undefined);
    const onHandleRenameNote = vi.fn(async (_oldName: string, _newName: string) => undefined);
    const onHandleOpenDaily = vi.fn(async () => undefined);
    const onHandleCreateFolder = vi.fn(async (_name: string) => undefined);
    const onHandleRenameFolder = vi.fn(async (_oldName: string, _newName: string) => undefined);
    const onHandleDeleteFolder = vi.fn(async (_name: string) => undefined);
    const onHandleMoveNote = vi.fn(async (_fileName: string, _destination: string) => undefined);
    const onCreateFromTemplate = vi.fn(async (_t: NoteTemplate) => undefined);
    const onHandleSelectFolder = vi.fn(async () => undefined);
    const onHandleImportVault = vi.fn(async () => undefined);

    const composition = createAppComposition(
      {
        t: (key) => key,
        panels,
        settings,
        notes: [note],
        filteredNotes: [note],
        noteFolders: [{ name: 'root', notes: [note] }],
        activeNoteName: note.name,
        activeNoteContent: '<p>x</p>',
        pinnedNotes: [note.name],
        allTags: ['tag1'],
        activeTagFilter: 'tag1',
        suggestions: [suggestion],
        noteChunks: [chunk],
        noteLinksIndex: { 'test.md': ['other'] },
        allNoteNames: ['test'],
        backlinks: ['other.md'],
        focusClass: 'focus-mode',
        typewriterClass: 'typewriter-mode',
        activeEditor: null,
        customTemplates: [template],
        toastMessages: [{ id: 't1', text: 'ok', variant: 'success' }],
      },
      {
        onToast: vi.fn(),
        onToastError: vi.fn(),
        onUpdateSettings: vi.fn(),
        onSetActiveTagFilter: vi.fn(),
        onOpenNote,
        onSaveActiveNote,
        onHandleCreateNote,
        onHandleDeleteNote,
        onHandleRenameNote,
        onHandleOpenDaily,
        onHandleCreateFolder,
        onHandleRenameFolder,
        onHandleDeleteFolder,
        onHandleMoveNote,
        onTogglePin: vi.fn(),
        onDismissToast: vi.fn(),
        onDismissSuggestion: vi.fn(),
        onDismissAllSuggestions: vi.fn(),
        onCreateFromTemplate,
        onSaveAsTemplate: vi.fn(),
        onDeleteTemplate: vi.fn(),
        onHandleSelectFolder,
        onHandleImportVault,
      },
    );

    expect(composition.chrome.notes[0]).toBe(note);
    expect(composition.chrome.suggestions[0]).toBe(suggestion);
    expect(composition.chrome.noteChunks[0]).toBe(chunk);
    expect(composition.chrome.settings).toBe(settings);
    expect(composition.chrome.panels).toBe(panels);
    expect(composition.chrome.onOpenNote).toBe(onOpenNote);
    expect(composition.chrome.onSaveActiveNote).toBe(onSaveActiveNote);
    expect(composition.chrome.onHandleCreateNote).toBe(onHandleCreateNote);

    expect(composition.modals.notes[0]).toBe(note);
    expect(composition.modals.customTemplates[0]).toBe(template);
    expect(composition.modals.toastMessages[0]).toEqual({ id: 't1', text: 'ok', variant: 'success' });
    expect(composition.modals.onOpenNote).toBe(onOpenNote);
    expect(composition.modals.onCreateFromTemplate).toBe(onCreateFromTemplate);
    expect(composition.modals.onHandleSelectFolder).toBe(onHandleSelectFolder);
    expect(composition.modals.onHandleImportVault).toBe(onHandleImportVault);
  });
});
