import { useState, useEffect, useRef, useCallback } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { PanelLeft, PanelRight, Download, FileDown, Keyboard } from 'lucide-react';
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
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastStack } from './components/Toast';
import { useToast } from './hooks/useToast';
import { useTheme } from './hooks/useTheme';
import { useNoteAdvisor } from './hooks/useNoteAdvisor';

function App() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isAdvisorOpen, setIsAdvisorOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const { messages: toastMessages, toast, dismiss } = useToast();
  useTheme();

  const {
    notes, activeNoteName, activeNoteContent,
    fetchNotes, createNote, openNote, saveActiveNote, deleteNote, renameNote,
    settings, updateSettings, loadApiKey,
    pinnedNotes, togglePin, openOrCreateDaily,
  } = useStore();

  useEffect(() => {
    fetchNotes();
    loadApiKey();
  }, [fetchNotes, loadApiKey]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        setIsShortcutsOpen(v => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setFindOpen(v => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleEditorReady = useCallback((editor: Editor | null) => {
    editorRef.current = editor;
    setActiveEditor(editor);
  }, []);

  const handleCreateNote = useCallback(async () => {
    try {
      await createNote(`Nuova_Nota_${Math.floor(Date.now() / 1000)}.md`);
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
      toast('Markdown esportato', 'success');
    } else {
      toast(res.error ?? 'Errore esportazione Markdown', 'error');
    }
  }, [toast]);

  const handleExportPdf = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !window.electronAPI) return;
    const res = await window.electronAPI.exportPdf(editor.getHTML());
    if (res.success) {
      toast('PDF esportato con successo', 'success');
    } else {
      toast(res.error ?? 'Errore durante l\'esportazione PDF', 'error');
    }
  }, [toast]);

  const getEditorText = useCallback(() => editorRef.current?.getText() ?? '', []);

  const { suggestions, dismiss: dismissSuggestion, dismissAll } = useNoteAdvisor({
    activeNoteName,
    activeNoteContent,
    notes,
  });

  return (
    <div className="h-screen w-screen flex flex-col bg-white dark:bg-gray-900">
      {/* Titlebar */}
      <div
        className="h-10 w-full flex items-center px-4 drag-region bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
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
                onClick={handleExportMarkdown}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-indigo-600 transition-colors"
                title="Esporta come Markdown"
              >
                <FileDown size={16} />
              </button>
              <button
                onClick={handleExportPdf}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-indigo-600 transition-colors"
                title="Esporta come PDF"
              >
                <Download size={16} />
              </button>
            </>
          )}
          <NoteAdvisorBadge count={suggestions.length} onClick={() => setIsAdvisorOpen(v => !v)} />
          <button onClick={() => setIsShortcutsOpen(true)} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400" title="Scorciatoie (?)">
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
              <Panel defaultSize={20} minSize={15} maxSize={30} className="bg-gray-50 dark:bg-gray-800 flex flex-col border-r border-gray-200 dark:border-gray-700">
                <ErrorBoundary>
                  <Sidebar
                    notes={notes}
                    activeNoteName={activeNoteName}
                    pinnedNotes={pinnedNotes}
                    onSelectNote={openNote}
                    onCreateNote={handleCreateNote}
                    onDeleteNote={handleDeleteNote}
                    onRenameNote={handleRenameNote}
                    onTogglePin={togglePin}
                    onOpenDaily={handleOpenDaily}
                    onOpenSettings={() => setIsSettingsOpen(true)}
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
            {/* Scrollable writing area — pure content, no chrome */}
            <div className="flex-1 overflow-y-auto relative">
              <div className="max-w-3xl mx-auto px-12 py-10">
                <ErrorBoundary>
                  <NoteEditor
                    activeNoteName={activeNoteName}
                    activeNoteContent={activeNoteContent}
                    saveActiveNote={saveActiveNote}
                    onEditorReady={handleEditorReady}
                    onAiError={msg => toast(msg, 'error')}
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
                  <AiChat getEditorText={getEditorText} />
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

      {isShortcutsOpen && (
        <KeyboardShortcutsModal onClose={() => setIsShortcutsOpen(false)} />
      )}

      {isSettingsOpen && (
        <SettingsModal
          settings={settings}
          onUpdate={updateSettings}
          onSelectFolder={handleSelectFolder}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      <ToastStack messages={toastMessages} onDismiss={dismiss} />
    </div>
  );
}

export default App;
