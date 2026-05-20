import type { AppChromeProps } from './types';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { PanelLeft, PanelRight, Keyboard, LayoutTemplate, History, Focus } from 'lucide-react';
import TurndownService from 'turndown';
import { Sidebar } from '../Sidebar';
import { NoteEditor } from '../NoteEditor';
import { AiChat } from '../AiChat';
import { TextAnalytics } from '../TextAnalytics';
import { GraphView } from '../GraphView';
import { NoteAdvisorBadge } from '../NoteAdvisor';
import { EditorToolbar } from '../EditorToolbar';
import { GitBadge } from '../GitPanel';
import { ErrorBoundary } from '../ErrorBoundary';
import { Tooltip } from '../Tooltip';
import { ShareMenu } from '../ShareMenu';

export function AppChrome({
  t,
  panels,
  settings,
  notes,
  filteredNotes,
  noteFolders,
  activeNoteName,
  activeNoteContent,
  pinnedNotes,
  allTags,
  activeTagFilter,
  suggestions,
  noteChunks,
  noteLinksIndex,
  allNoteNames,
  backlinks,
  focusClass,
  typewriterClass,
  activeEditor,
  editorRef,
  onToast,
  onToastError,
  onUpdateSettings,
  onSetActiveTagFilter,
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
  onTogglePin,
  onGetEditorText,
  onEditorReady,
}: AppChromeProps) {
  return (
    <>
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
              <Tooltip label={t('history')} side="bottom">
                <button
                  onClick={panels.openHistory}
                  className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-[var(--accent)] transition-colors"
                  aria-label={t('history')}
                >
                  <History size={16} />
                </button>
              </Tooltip>
              <Tooltip label={t('focusMode')} side="bottom">
                <button
                  onClick={() => onUpdateSettings({ focusMode: !settings.focusMode })}
                  className={`p-1 rounded transition-colors ${settings.focusMode ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-[var(--accent)]'}`}
                  aria-label={t('focusMode')}
                  aria-pressed={settings.focusMode}
                >
                  <Focus size={16} />
                </button>
              </Tooltip>
            </>
          )}
          <Tooltip label={t('templates')} side="bottom">
            <button onClick={panels.toggleTemplates} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-[var(--accent)] transition-colors" aria-label={t('templates')}>
              <LayoutTemplate size={16} />
            </button>
          </Tooltip>
          <NoteAdvisorBadge count={suggestions.length} onClick={panels.toggleAdvisor} />
          {settings.gitEnabled && <GitBadge onClick={panels.toggleGit} />}
          <Tooltip label={t('shortcuts')} side="bottom">
            <button onClick={panels.openShortcuts} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-[var(--accent)] transition-colors" aria-label={t('shortcuts')}>
              <Keyboard size={16} />
            </button>
          </Tooltip>
          <Tooltip label="Sidebar" side="bottom">
            <button onClick={panels.toggleLeftOpen} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-[var(--accent)] transition-colors" aria-label="Toggle sidebar">
              <PanelLeft size={16} />
            </button>
          </Tooltip>
          <Tooltip label="AI panel" side="bottom">
            <button onClick={panels.toggleRightOpen} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-[var(--accent)] transition-colors" aria-label="Toggle AI panel">
              <PanelRight size={16} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <PanelGroup direction="horizontal">
          {panels.leftOpen && (
            <>
              <Panel id="sidebar-left" order={1} defaultSize={20} minSize={15} maxSize={30} className="vibrancy-sidebar flex flex-col border-r border-gray-200/60 dark:border-gray-700/60">
                <ErrorBoundary>
                  <Sidebar
                    notes={filteredNotes}
                    noteFolders={noteFolders}
                    activeNoteName={activeNoteName}
                    pinnedNotes={pinnedNotes}
                    onSelectNote={onOpenNote}
                    onCreateNote={(folder) => { void onHandleCreateNote(folder); }}
                    onDeleteNote={(name) => { void onHandleDeleteNote(name); }}
                    onRenameNote={onHandleRenameNote}
                    onTogglePin={onTogglePin}
                    onOpenDaily={() => { void onHandleOpenDaily(); }}
                    onOpenSettings={panels.openSettings}
                    onCreateFolder={onHandleCreateFolder}
                    onRenameFolder={onHandleRenameFolder}
                    onDeleteFolder={onHandleDeleteFolder}
                    onMoveNote={onHandleMoveNote}
                    allTags={allTags}
                    activeTagFilter={activeTagFilter}
                    onTagFilter={onSetActiveTagFilter}
                  />
                </ErrorBoundary>
              </Panel>
              <PanelResizeHandle className="w-1 hover:bg-blue-400 transition-colors cursor-col-resize" />
            </>
          )}

          <Panel id="editor-center" order={2} minSize={30} className="editor-canvas bg-white dark:bg-gray-900 flex flex-col overflow-hidden">
            {activeNoteName && (
              <EditorToolbar
                editor={activeEditor}
                showToolbar={settings.showToolbar}
                showAiBar={settings.showAiBar}
                onAiError={onToastError}
                findOpen={panels.findOpen}
                onCloseFind={() => panels.setFindOpen(false)}
                onOpenFind={() => panels.setFindOpen(true)}
                onOpenGlobalSearch={panels.toggleGlobalSearch}
                shareSlot={
                  <ShareMenu
                    getCurrentNoteContent={() => {
                      const ed = editorRef.current;
                      if (!ed) return '';
                      return new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).turndown(ed.getHTML());
                    }}
                    getCurrentNoteHtml={() => editorRef.current?.getHTML() ?? ''}
                    getCurrentNoteTitle={() => activeNoteName?.replace('.md', '') ?? ''}
                    getCurrentNoteFileName={() => activeNoteName ?? 'note.md'}
                    syncDirectory={settings.syncDirectory || undefined}
                    onToast={onToast}
                    hasNote={!!activeNoteName}
                  />
                }
              />
            )}

            <div className={`flex-1 overflow-y-auto relative ${focusClass} ${typewriterClass}`}>
              <div className={`mx-auto px-12 py-10 ${
                settings.editorWidth === 'narrow' ? 'max-w-[560px]' :
                settings.editorWidth === 'wide' ? 'max-w-5xl' :
                settings.editorWidth === 'full' ? 'max-w-none px-16' :
                'max-w-3xl'
              }`}>
                <ErrorBoundary>
                  <NoteEditor
                    activeNoteName={activeNoteName}
                    activeNoteContent={activeNoteContent}
                    saveActiveNote={onSaveActiveNote}
                    onEditorReady={onEditorReady}
                    onAiError={onToastError}
                    allNoteNames={allNoteNames}
                    allTags={allTags}
                    backlinks={backlinks}
                    onSelectNote={onOpenNote}
                    notesCount={notes.length}
                    onCreateNote={() => { void onHandleCreateNote(); }}
                    onOpenDaily={() => { void onHandleOpenDaily(); }}
                    onOpenSettings={panels.openSettings}
                    onOpenShortcuts={panels.openShortcuts}
                  />
                </ErrorBoundary>
              </div>
            </div>
          </Panel>

          {panels.rightOpen && (
            <>
              <PanelResizeHandle className="w-1 hover:bg-blue-400 transition-colors cursor-col-resize" />
              <Panel id="sidebar-right" order={3} defaultSize={25} minSize={20} maxSize={40} className="bg-gray-50 dark:bg-gray-800 flex flex-col border-l border-gray-200 dark:border-gray-700">
                <div className="flex border-b border-gray-200 dark:border-gray-700 shrink-0">
                  {(['ai', 'analytics', 'graph'] as const).map((tab) => (
                    <button key={tab}
                      onClick={() => panels.setRightTab(tab)}
                      className={`flex-1 py-2 text-xs font-medium transition-colors ${panels.rightTab === tab ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                    >
                      {tab === 'ai' ? 'AI Chat' : tab === 'analytics' ? 'Analytics' : 'Graph'}
                    </button>
                  ))}
                </div>
                <ErrorBoundary>
                  {panels.rightTab === 'ai' && <AiChat getEditorText={onGetEditorText} noteChunks={noteChunks} />}
                  {panels.rightTab === 'analytics' && <TextAnalytics getText={onGetEditorText} activeNoteName={activeNoteName} />}
                  {panels.rightTab === 'graph' && (
                    <GraphView
                      notes={notes}
                      noteLinksIndex={noteLinksIndex}
                      activeNoteName={activeNoteName}
                      onOpenNote={onOpenNote}
                      accentColor={settings.accentColor}
                    />
                  )}
                </ErrorBoundary>
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
    </>
  );
}
