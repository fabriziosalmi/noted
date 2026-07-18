import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from './test/test-utils';
import App from './App';
import type { Suggestion } from './lib/noteAdvisor';

const openNoteSpy = vi.fn(async (_name: string) => undefined);
const saveActiveNoteSpy = vi.fn(async (_content: string) => undefined);
const updateSettingsSpy = vi.fn();
const togglePinSpy = vi.fn();
const fetchNotesSpy = vi.fn(async () => undefined);
const loadApiKeySpy = vi.fn(async () => undefined);

const handleCreateNoteSpy = vi.fn(async (_folder?: string) => undefined);
const handleOpenDailySpy = vi.fn(async () => undefined);
const handleSelectFolderSpy = vi.fn(async () => undefined);
const handleDeleteNoteSpy = vi.fn(async (_name: string) => undefined);
const handleRenameNoteSpy = vi.fn(async (_oldName: string, _newName: string) => undefined);
const handleImportVaultSpy = vi.fn(async () => undefined);
const handleCreateFolderSpy = vi.fn(async (_name: string) => undefined);
const handleRenameFolderSpy = vi.fn(async (_oldName: string, _newName: string) => undefined);
const handleDeleteFolderSpy = vi.fn(async (_name: string) => undefined);
const handleMoveNoteSpy = vi.fn(async (_fileName: string, _destination: string) => undefined);

const dismissSuggestionSpy = vi.fn();
const dismissAllSpy = vi.fn();
const panelsCloseAdvisorSpy = vi.fn();
const editorRunSpy = vi.fn();
const editorInsertContentAtSpy = vi.fn(() => ({ run: editorRunSpy }));
const editorFocusSpy = vi.fn(() => ({ insertContentAt: editorInsertContentAtSpy }));
const editorChainSpy = vi.fn(() => ({ focus: editorFocusSpy }));
const editorStub = { chain: editorChainSpy };

const advisorSuggestion: Suggestion = {
  id: 's-open',
  kind: 'org-split',
  severity: 'low',
  titleKey: 'advSplitTitle',
  detailKey: 'advSplitDetail',
  noteName: 'beta.md',
  action: 'open',
};
const advisorRenameSuggestion: Suggestion = {
  id: 's-rename',
  kind: 'org-generic-title',
  severity: 'low',
  titleKey: 'advGenericTitle',
  detailKey: 'advGenericDetail',
  noteName: 'beta.md',
  action: 'rename',
};
const advisorAddHeadingsSuggestion: Suggestion = {
  id: 's-headings',
  kind: 'org-no-structure',
  severity: 'low',
  titleKey: 'advNoStructureTitle',
  detailKey: 'advNoStructureDetail',
  noteName: 'gamma.md',
  action: 'addHeadings',
};

const mockState = {
  notes: [{ name: 'alpha.md', path: '/tmp/alpha.md', stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } }],
  activeNoteName: 'alpha.md',
  activeNoteContent: '<p>alpha</p>',
  srAnnouncement: '',
  announce: vi.fn(),
  settings: {
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
    gitEnabled: false,
  },
  pinnedNotes: [] as string[],
  customTemplates: [] as never[],
  noteLinksIndex: {} as Record<string, string[]>,
  tagIndex: {} as Record<string, string[]>,
  noteFolders: [] as { name: string; notes: typeof mockState.notes }[],
};

vi.mock('./lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('./hooks/useToast', () => ({
  useToast: () => ({
    messages: [],
    toast: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('./hooks/useTheme', () => ({ useTheme: () => undefined }));
vi.mock('./hooks/useNoteChunks', () => ({ useNoteChunks: () => [] }));
vi.mock('./hooks/useAppLifecycle', () => ({ useAppLifecycle: () => undefined }));
vi.mock('./hooks/useGlobalShortcuts', () => ({ useGlobalShortcuts: () => undefined }));
vi.mock('./hooks/useAppDerivedState', () => ({
  useAppDerivedState: () => ({
    allTags: [],
    filteredNotes: mockState.notes,
    backlinks: [],
    allNoteNames: ['alpha'],
    fontClass: 'editor-font-system',
    sizeClass: 'editor-size-md',
    focusClass: '',
    typewriterClass: '',
  }),
}));

vi.mock('./hooks/useAppActions', () => ({
  useAppActions: () => ({
    handleCreateNote: handleCreateNoteSpy,
    handleOpenDaily: handleOpenDailySpy,
    handleSelectFolder: handleSelectFolderSpy,
    handleDeleteNote: handleDeleteNoteSpy,
    handleRenameNote: handleRenameNoteSpy,
    handleImportVault: handleImportVaultSpy,
    handleCreateFolder: handleCreateFolderSpy,
    handleRenameFolder: handleRenameFolderSpy,
    handleDeleteFolder: handleDeleteFolderSpy,
    handleMoveNote: handleMoveNoteSpy,
  }),
}));

vi.mock('./hooks/useAppPanels', () => ({
  useAppPanels: () => ({
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
    closeAdvisor: panelsCloseAdvisorSpy,
    openTemplates: vi.fn(),
    closeTemplates: vi.fn(),
    openHistory: vi.fn(),
    closeHistory: vi.fn(),
    closeGit: vi.fn(),
    closeQuickOpen: vi.fn(),
    closeGlobalSearch: vi.fn(),
  }),
}));

vi.mock('./hooks/useNoteAdvisor', () => ({
  useNoteAdvisor: () => ({
    suggestions: [advisorSuggestion],
    dismiss: dismissSuggestionSpy,
    dismissAll: dismissAllSpy,
  }),
}));

vi.mock('./store/useStore', () => {
  const useStore = ((selector: (s: typeof mockState) => unknown) => selector(mockState)) as unknown as {
    <T>(selector: (s: typeof mockState) => T): T;
    getState: () => Record<string, unknown>;
  };
  useStore.getState = () => ({
    fetchNotes: fetchNotesSpy,
    createNote: vi.fn(async () => undefined),
    openNote: openNoteSpy,
    saveActiveNote: saveActiveNoteSpy,
    deleteNote: vi.fn(async () => undefined),
    renameNote: vi.fn(async () => undefined),
    updateSettings: updateSettingsSpy,
    loadApiKey: loadApiKeySpy,
    togglePin: togglePinSpy,
    openOrCreateDaily: vi.fn(async () => undefined),
    saveAsTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    createFromTemplate: vi.fn(async () => undefined),
    createFolder: vi.fn(async () => undefined),
    renameFolder: vi.fn(async () => undefined),
    deleteFolder: vi.fn(async () => undefined),
    moveNote: vi.fn(async () => undefined),
  });
  return { useStore };
});

vi.mock('./components/app/AppChrome', () => ({
  AppChrome: (props: {
    onHandleCreateNote: () => Promise<void>;
    onHandleOpenDaily: () => Promise<void>;
    onEditorReady: (editor: unknown) => void;
  }) => (
    <div>
      <button onClick={() => { void props.onHandleCreateNote(); }}>create-note</button>
      <button onClick={() => { void props.onHandleOpenDaily(); }}>open-daily</button>
      <button onClick={() => props.onEditorReady(editorStub)}>editor-ready</button>
    </div>
  ),
}));

vi.mock('./components/app/AppModals', () => ({
  AppModals: (props: { onHandleAdvisorAction: (s: Suggestion) => void }) => (
    <div>
      <button onClick={() => props.onHandleAdvisorAction(advisorSuggestion)}>advisor-action-open</button>
      <button onClick={() => props.onHandleAdvisorAction(advisorRenameSuggestion)}>advisor-action-rename</button>
      <button onClick={() => props.onHandleAdvisorAction(advisorAddHeadingsSuggestion)}>advisor-action-add-headings</button>
    </div>
  ),
}));

describe('App orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wires AppChrome action callbacks to app action handlers', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'create-note' }));
    fireEvent.click(screen.getByRole('button', { name: 'open-daily' }));

    expect(handleCreateNoteSpy).toHaveBeenCalledTimes(1);
    expect(handleOpenDailySpy).toHaveBeenCalledTimes(1);
  });

  it('wires advisor action flow: open note + dismiss + close panel', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'advisor-action-open' }));

    await Promise.resolve();

    expect(openNoteSpy).toHaveBeenCalledWith('beta.md');
    expect(dismissSuggestionSpy).toHaveBeenCalledWith('s-open');
    expect(panelsCloseAdvisorSpy).toHaveBeenCalledTimes(1);
  });

  it('wires advisor rename flow: prompt + rename handler + dismiss + close panel', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'advisor-action-rename' }));

    // Native window.prompt is replaced by an in-app prompt dialog.
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'renamed-note' } });
    // i18n is mocked in this suite, so t() returns the raw key.
    fireEvent.click(within(dialog).getByRole('button', { name: 'advActionRename' }));

    await waitFor(() => {
      expect(handleRenameNoteSpy).toHaveBeenCalledWith('beta.md', 'renamed-note');
    });
    expect(dismissSuggestionSpy).toHaveBeenCalledWith('s-rename');
    expect(panelsCloseAdvisorSpy).toHaveBeenCalledTimes(1);
  });

  it('wires advisor addHeadings flow: open note + deferred editor insert + dismiss + close', async () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'editor-ready' }));
    fireEvent.click(screen.getByRole('button', { name: 'advisor-action-add-headings' }));

    await Promise.resolve();
    vi.advanceTimersByTime(130);

    expect(openNoteSpy).toHaveBeenCalledWith('gamma.md');
    expect(editorChainSpy).toHaveBeenCalledTimes(1);
    expect(editorFocusSpy).toHaveBeenCalledTimes(1);
    expect(editorInsertContentAtSpy).toHaveBeenCalledWith(0, '<h1>addHeadingsTitle</h1><h2>addHeadingsSection</h2><p></p>');
    expect(editorRunSpy).toHaveBeenCalledTimes(1);
    expect(dismissSuggestionSpy).toHaveBeenCalledWith('s-headings');
    expect(panelsCloseAdvisorSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
