import { useState, useEffect, useRef, useCallback } from 'react';
import { useI18n } from './lib/i18n';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { PanelLeft, PanelRight, Download, FileDown, FileCode, FileText as FileDocx, Keyboard, LayoutTemplate, History, Focus } from 'lucide-react';
import TurndownService from 'turndown';
import type { Editor } from '@tiptap/react';
import { useStore } from './store/useStore';
import { Sidebar } from './components/Sidebar';
import { NoteEditor } from './components/NoteEditor';
import { AiChat } from './components/AiChat';
import { SettingsModal } from './components/SettingsModal';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { NoteAdvisorBadge, NoteAdvisorPanel } from './components/NoteAdvisor';
import { EditorToolbar } from './components/EditorToolbar';
import { TemplatesModal } from './components/TemplatesModal';
import { NoteHistoryModal } from './components/NoteHistoryModal';
import { GitBadge, GitPanel } from './components/GitPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastStack } from './components/Toast';
import { QuickOpen } from './components/QuickOpen';
import { useToast } from './hooks/useToast';
import { useTheme } from './hooks/useTheme';
import { useNoteAdvisor } from './hooks/useNoteAdvisor';
import type { NoteChunk } from './lib/noteSearch';

function App() {
  const { t } = useI18n();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isAdvisorOpen, setIsAdvisorOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isGitOpen, setIsGitOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const { messages: toastMessages, toast, dismiss } = useToast();
  useTheme();

  const {
    notes, activeNoteName, activeNoteContent,
    fetchNotes, createNote, openNote, saveActiveNote, deleteNote, renameNote,
    settings, updateSettings, loadApiKey,
    pinnedNotes, togglePin, openOrCreateDaily,
    customTemplates, saveAsTemplate, deleteTemplate, createFromTemplate,
    noteLinksIndex,
    tagIndex,
    noteFolders,
    createFolder, renameFolder, deleteFolder, moveNote,
  } = useStore();

  const allTags = Object.keys(tagIndex);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);

  const filteredNotes = activeTagFilter
    ? notes.filter(n => (tagIndex[activeTagFilter] ?? []).includes(n.name))
    : notes;

  const fontClass = `editor-font-${settings.editorFont ?? 'system'}`;
  const sizeClass = `editor-size-${settings.editorFontSize ?? 'md'}`;
  const focusClass = settings.focusMode ? 'focus-mode' : '';
  const typewriterClass = settings.typewriterMode ? 'typewriter-mode' : '';

  // Apply accent color CSS variable on change
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', settings.accentColor ?? '#6366f1');
  }, [settings.accentColor]);

  // Compute backlinks: notes that contain [[activeNoteName]] in their links index
  const backlinks = activeNoteName
    ? Object.entries(noteLinksIndex)
        .filter(([noteName, links]) => noteName !== activeNoteName && links.some(l => {
          const normalized = l.endsWith('.md') ? l : `${l}.md`;
          return normalized === activeNoteName || l === activeNoteName.replace('.md', '');
        }))
        .map(([noteName]) => noteName)
    : [];

  const allNoteNames = notes.map(n => n.name.replace('.md', ''));

  // RAG index: load all note contents in background when right panel opens
  const [noteChunks, setNoteChunks] = useState<NoteChunk[]>([]);
  useEffect(() => {
    if (!rightOpen || !window.electronAPI || notes.length === 0) return;
    let cancelled = false;
    (async () => {
      const chunks: NoteChunk[] = [];
      for (const note of notes.slice(0, 50)) { // cap at 50 notes for perf
        const res = await window.electronAPI.readNote(note.name, settings.syncDirectory || undefined);
        if (cancelled) return;
        if (res.success && res.data) {
          const text = res.data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          chunks.push({ name: note.name, text });
        }
      }
      if (!cancelled) setNoteChunks(chunks);
    })();
    return () => { cancelled = true; };
  }, [rightOpen, notes, settings.syncDirectory]);

  useEffect(() => {
    fetchNotes();
    loadApiKey();
    window.electronAPI?.onRefreshNotes(() => { void fetchNotes(); });
  }, [fetchNotes, loadApiKey]);

  useEffect(() => {
    window.electronAPI?.setNoteTitle(activeNoteName ?? '');
  }, [activeNoteName]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        setIsShortcutsOpen(v => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        setQuickOpenOpen(v => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && !e.shiftKey) {
        e.preventDefault();
        setFindOpen(v => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        updateSettings({ focusMode: !settings.focusMode });
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [settings.focusMode, updateSettings]);

  const handleEditorReady = useCallback((editor: Editor | null) => {
    editorRef.current = editor;
    setActiveEditor(editor);
  }, []);

  const handleCreateNote = useCallback(async (folder?: string) => {
    try {
      const baseName = `Nuova_Nota_${Math.floor(Date.now() / 1000)}.md`;
      await createNote(folder ? `${folder}/${baseName}` : baseName);
    } catch (err: unknown) {
      toast((err as Error).message, 'error');
    }
  }, [createNote, toast]);

  const handleOpenDaily = useCallback(async () => {
    try {
      await openOrCreateDaily();
    } catch (err: unknown) {
      toast((err as Error).message, 'error');
    }
  }, [openOrCreateDaily, toast]);

  const handleSelectFolder = useCallback(async () => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.selectSyncFolder();
    if (res.success && res.data) {
      updateSettings({ syncDirectory: res.data });
      fetchNotes();
    }
  }, [updateSettings, fetchNotes]);

  const handleDeleteNote = useCallback(async (fileName: string) => {
    try {
      await deleteNote(fileName);
    } catch (err: unknown) {
      toast((err as Error).message, 'error');
    }
  }, [deleteNote, toast]);

  const handleRenameNote = useCallback(async (oldName: string, newName: string) => {
    try {
      await renameNote(oldName, newName);
    } catch (err: unknown) {
      toast((err as Error).message, 'error');
    }
  }, [renameNote, toast]);

  const handleExportMarkdown = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !window.electronAPI) return;
    const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    const markdown = td.turndown(editor.getHTML());
    const res = await window.electronAPI.exportMarkdown(markdown);
    if (res.success) {
      toast(t('markdownExported'), 'success');
    } else {
      toast(res.error ?? t('markdownExportError'), 'error');
    }
  }, [toast]);

  const handleExportPdf = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !window.electronAPI) return;
    const res = await window.electronAPI.exportPdf(editor.getHTML());
    if (res.success) {
      toast(t('pdfExported'), 'success');
    } else {
      toast(res.error ?? t('pdfExportError'), 'error');
    }
  }, [toast]);

  const handleExportDocx = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !window.electronAPI) return;
    const title = activeNoteName?.replace('.md', '') ?? 'Nota';
    const res = await window.electronAPI.exportDocx(editor.getHTML(), title);
    if (res.success) toast(t('docxExported'), 'success');
    else toast(res.error ?? t('docxExportError'), 'error');
  }, [activeNoteName, toast]);

  const handleExportHtml = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !window.electronAPI) return;
    const title = activeNoteName?.replace('.md', '') ?? 'Nota';
    const res = await window.electronAPI.exportHtml(editor.getHTML(), title);
    if (res.success) toast(t('htmlExported'), 'success');
    else toast(res.error ?? t('htmlExportError'), 'error');
  }, [activeNoteName, toast]);

  const handleImportVault = useCallback(async () => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.importVault(settings.syncDirectory || undefined);
    if (res.success) {
      toast(`${res.data ?? 0} ${t('notesImported')}`, 'success');
      void fetchNotes();
    } else {
      toast(res.error ?? t('importError'), 'error');
    }
  }, [settings.syncDirectory, fetchNotes, toast]);

  const handleUseICloud = useCallback(async () => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.getICloudPath();
    if (res.success && res.data) {
      updateSettings({ syncDirectory: res.data });
      void fetchNotes();
      toast(t('iCloudConfigured'), 'success');
    } else {
      toast(res.error ?? t('iCloudError'), 'error');
    }
  }, [updateSettings, fetchNotes, toast]);

  const getEditorText = useCallback(() => editorRef.current?.getText() ?? '', []);

  const { suggestions, dismiss: dismissSuggestion, dismissAll } = useNoteAdvisor({
    activeNoteName,
    activeNoteContent,
    notes,
  });

  return (
    <div className={`h-screen w-screen flex flex-col bg-white/85 dark:bg-gray-900/85 ${fontClass} ${sizeClass}`}>
      {/* Titlebar */}
      <div
        className="h-10 w-full flex items-center px-4 drag-region vibrancy-titlebar border-b border-gray-200/60 dark:border-gray-700/60"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex space-x-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="w-16" />
        </div>
        <div className="flex-1 flex justify-center text-sm font-medium text-gray-500 dark:text-gray-400">Noted</div>
        <div className="flex space-x-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {activeNoteName && (
            <>
              <button
                onClick={() => setIsHistoryOpen(true)}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-indigo-600 transition-colors"
                title={t('history')}
              >
                <History size={16} />
              </button>
              <button
                onClick={() => updateSettings({ focusMode: !settings.focusMode })}
                className={`p-1 rounded transition-colors ${settings.focusMode ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400' : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-indigo-600'}`}
                title={t('focusMode')}
              >
                <Focus size={16} />
              </button>
              <button
                onClick={handleExportMarkdown}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-indigo-600 transition-colors"
                title={t('exportMarkdown')}
              >
                <FileDown size={16} />
              </button>
              <button
                onClick={handleExportPdf}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-indigo-600 transition-colors"
                title={t('exportPdf')}
              >
                <Download size={16} />
              </button>
              <button
                onClick={handleExportHtml}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-indigo-600 transition-colors"
                title={t('exportHtml')}
              >
                <FileCode size={16} />
              </button>
              <button
                onClick={handleExportDocx}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-indigo-600 transition-colors"
                title={t('exportDocx')}
              >
                <FileDocx size={16} />
              </button>
            </>
          )}
          <button onClick={() => setIsTemplatesOpen(v => !v)} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-indigo-600 transition-colors" title={t('templates')}>
            <LayoutTemplate size={16} />
          </button>
          <NoteAdvisorBadge count={suggestions.length} onClick={() => setIsAdvisorOpen(v => !v)} />
          {settings.gitEnabled && <GitBadge onClick={() => setIsGitOpen(v => !v)} syncDir={settings.syncDirectory} />}
          <button onClick={() => setIsShortcutsOpen(true)} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400" title={t('shortcuts')}>
            <Keyboard size={16} />
          </button>
          <button onClick={() => setLeftOpen(!leftOpen)} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400">
            <PanelLeft size={16} />
          </button>
          <button onClick={() => setRightOpen(!rightOpen)} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400">
            <PanelRight size={16} />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <PanelGroup direction="horizontal">

          {leftOpen && (
            <>
              <Panel defaultSize={20} minSize={15} maxSize={30} className="vibrancy-sidebar flex flex-col border-r border-gray-200/60 dark:border-gray-700/60">
                <ErrorBoundary>
                  <Sidebar
                    notes={filteredNotes}
                    noteFolders={noteFolders}
                    activeNoteName={activeNoteName}
                    pinnedNotes={pinnedNotes}
                    onSelectNote={openNote}
                    onCreateNote={handleCreateNote}
                    onDeleteNote={handleDeleteNote}
                    onRenameNote={handleRenameNote}
                    onTogglePin={togglePin}
                    onOpenDaily={handleOpenDaily}
                    onOpenSettings={() => setIsSettingsOpen(true)}
                    onCreateFolder={async (name) => { try { await createFolder(name); } catch (e) { toast((e as Error).message, 'error'); } }}
                    onRenameFolder={async (o, n) => { try { await renameFolder(o, n); } catch (e) { toast((e as Error).message, 'error'); } }}
                    onDeleteFolder={async (name) => { try { await deleteFolder(name); } catch (e) { toast((e as Error).message, 'error'); } }}
                    onMoveNote={async (f, t) => { try { await moveNote(f, t); } catch (e) { toast((e as Error).message, 'error'); } }}
                    allTags={allTags}
                    activeTagFilter={activeTagFilter}
                    onTagFilter={setActiveTagFilter}
                  />
                </ErrorBoundary>
              </Panel>
              <PanelResizeHandle className="w-1 hover:bg-blue-400 transition-colors cursor-col-resize" />
            </>
          )}

          <Panel className="bg-white dark:bg-gray-900 flex flex-col overflow-hidden">
            {/* Sticky toolbar — outside scrollable area */}
            {activeNoteName && (
              <EditorToolbar
                editor={activeEditor}
                showToolbar={settings.showToolbar}
                showAiBar={settings.showAiBar}
                onAiError={msg => toast(msg, 'error')}
                findOpen={findOpen}
                onCloseFind={() => setFindOpen(false)}
              />
            )}
            {/* LLM not configured banner */}
            {!activeNoteName && !settings.llmApiKey && settings.llmProvider !== 'lmstudio' && settings.llmProvider !== 'ollama' && (
              <div className="mx-auto max-w-3xl px-12 pt-6">
                <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-xl px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                  <span className="text-base">✨</span>
                  <span>{t('llmBanner')} <button onClick={() => setIsSettingsOpen(true)} className="underline underline-offset-2 font-medium hover:text-amber-900 dark:hover:text-amber-200">{t('llmBannerLink')}</button> {t('llmBannerSuffix')}</span>
                </div>
              </div>
            )}
            {/* Scrollable writing area — pure content, no chrome */}
            <div className={`flex-1 overflow-y-auto relative ${focusClass} ${typewriterClass}`}>
              <div className="max-w-3xl mx-auto px-12 py-10">
                <ErrorBoundary>
                  <NoteEditor
                    activeNoteName={activeNoteName}
                    activeNoteContent={activeNoteContent}
                    saveActiveNote={saveActiveNote}
                    onEditorReady={handleEditorReady}
                    onAiError={msg => toast(msg, 'error')}
                    allNoteNames={allNoteNames}
                    allTags={allTags}
                    backlinks={backlinks}
                    onSelectNote={openNote}
                  />
                </ErrorBoundary>
              </div>
            </div>
          </Panel>

          {rightOpen && (
            <>
              <PanelResizeHandle className="w-1 hover:bg-blue-400 transition-colors cursor-col-resize" />
              <Panel defaultSize={25} minSize={20} maxSize={40} className="bg-gray-50 dark:bg-gray-800 flex flex-col border-l border-gray-200 dark:border-gray-700">
                <ErrorBoundary>
                  <AiChat getEditorText={getEditorText} noteChunks={noteChunks} />
                </ErrorBoundary>
              </Panel>
            </>
          )}

        </PanelGroup>
      </div>

      {isAdvisorOpen && (
        <NoteAdvisorPanel
          suggestions={suggestions}
          onDismiss={dismissSuggestion}
          onDismissAll={() => { dismissAll(); setIsAdvisorOpen(false); }}
          onClose={() => setIsAdvisorOpen(false)}
        />
      )}

      {isGitOpen && settings.gitEnabled && (
        <GitPanel
          syncDir={settings.syncDirectory}
          activeNoteName={activeNoteName}
          onClose={() => setIsGitOpen(false)}
        />
      )}

      {isHistoryOpen && activeNoteName && (
        <NoteHistoryModal
          fileName={activeNoteName}
          syncDir={settings.syncDirectory}
          onRestore={content => {
            void saveActiveNote(content);
            setIsHistoryOpen(false);
          }}
          onClose={() => setIsHistoryOpen(false)}
        />
      )}

      {isTemplatesOpen && (
        <TemplatesModal
          customTemplates={customTemplates}
          activeNoteContent={activeNoteContent}
          activeNoteName={activeNoteName}
          onApply={t => { void createFromTemplate(t); }}
          onSaveCurrent={(name, content) => saveAsTemplate(name, content)}
          onDelete={deleteTemplate}
          onClose={() => setIsTemplatesOpen(false)}
        />
      )}

      {isShortcutsOpen && (
        <KeyboardShortcutsModal onClose={() => setIsShortcutsOpen(false)} />
      )}

      {isSettingsOpen && (
        <SettingsModal
          settings={settings}
          onUpdate={updateSettings}
          onSelectFolder={handleSelectFolder}
          onImportVault={handleImportVault}
          onUseICloud={handleUseICloud}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {quickOpenOpen && (
        <QuickOpen
          notes={notes}
          onSelect={openNote}
          onClose={() => setQuickOpenOpen(false)}
        />
      )}

      <ToastStack messages={toastMessages} onDismiss={dismiss} />
    </div>
  );
}

export default App;
