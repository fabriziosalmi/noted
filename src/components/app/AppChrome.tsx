import type { AppChromeProps } from './types';
import { useMemo } from 'react';
import { parseAgentNote } from '../../lib/agentWorkflow';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { PanelLeft, PanelRight, Keyboard, LayoutTemplate, History, Focus } from 'lucide-react';
import { getMarkdownFromHtml } from '../../lib/htmlToMarkdown';
import { Sidebar } from '../Sidebar';
import { NoteEditor } from '../NoteEditor';
import { ViewPage } from '../ViewPage';
import { useStore } from '../../store/useStore';
import { AiChat } from '../AiChat';
import { TextAnalytics } from '../TextAnalytics';
import { ConnectionsPanel } from '../ConnectionsPanel';
import { OutlinePanel } from '../OutlinePanel';
import { AgentPanel } from '../AgentPanel';
import { NoteAdvisorBadge } from '../NoteAdvisor';
import { EditorToolbar } from '../EditorToolbar';
import { GitBadge } from '../GitPanel';
import { ErrorBoundary } from '../ErrorBoundary';
import { Tooltip } from '../Tooltip';
import { ShareMenu } from '../ShareMenu';
import { useTablist } from '../../lib/useTablist';
import type { TranslationKey } from '../../lib/i18n';

const RIGHT_TABS = ['ai', 'agent', 'analytics', 'graph', 'outline'] as const;

const TAB_LABEL: Record<(typeof RIGHT_TABS)[number], TranslationKey> = {
  ai: 'aiAssistant',
  agent: 'agentTab',
  analytics: 'analyticsPanel',
  graph: 'connectionsTab',
  outline: 'outlineTab',
};

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
  retrieveNotes,
  ragNoteCount,
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
  onAgentAction,
}: AppChromeProps) {
  // Focus mode is supposed to remove distractions, not merely dim the prose:
  // while it's on the side panels step aside, and turning it off brings back
  // exactly what was open before (derived, so there's no state to resync).
  const showLeftPanel = panels.leftOpen && !settings.focusMode;
  const showRightPanel = panels.rightOpen && !settings.focusMode;

  // A saved view takes the main area; the open note stays loaded behind it, so nothing in it is lost or reloaded.
  const activeView = useStore(s => s.views.find(v => v.id === s.activeViewId) ?? null);
  const shown = activeView?.name ?? activeNoteName?.replace('.md', '');
  const windowTitle = shown ? `Noted — ${shown}` : 'Noted';

  // The Agent tab is dev-facing scaffolding; show it only when the open note is
  // actually an agent-workflow note, so a first-run stranger never sees it.
  const isAgentNote = useMemo(() => !!parseAgentNote(activeNoteContent).metadata, [activeNoteContent]);
  const visibleRightTabs = useMemo(
    () => (isAgentNote ? RIGHT_TABS : RIGHT_TABS.filter(t => t !== 'agent')),
    [isAgentNote],
  );
  const rightTab = panels.rightTab === 'agent' && !isAgentNote ? 'ai' : panels.rightTab;
  const rightTabs = useTablist(visibleRightTabs, rightTab, panels.setRightTab, 'rightpanel');
  return (
    <>
      <div
        role="banner"
        className="h-10 w-full flex items-center px-4 drag-region vibrancy-titlebar border-b border-gray-200/60 dark:border-gray-700/60"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex space-x-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="w-16" />
        </div>
        <div className="flex-1 flex justify-center text-sm font-medium text-gray-500 dark:text-gray-400">
          {windowTitle}
        </div>
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
          <Tooltip label={t('sidebarTooltip')} side="bottom">
            <button
              onClick={() => {
                // Asking for the sidebar while focus mode hides it means
                // leaving focus mode, not toggling a panel nobody can see.
                if (settings.focusMode) { onUpdateSettings({ focusMode: false }); return; }
                panels.toggleLeftOpen();
              }}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-[var(--accent)] transition-colors" aria-label={t('toggleSidebar')}>
              <PanelLeft size={16} />
            </button>
          </Tooltip>
          <Tooltip label={t('rightPanelTooltip')} side="bottom">
            <button
              onClick={() => {
                if (settings.focusMode) { onUpdateSettings({ focusMode: false }); return; }
                panels.toggleRightOpen();
              }}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-[var(--accent)] transition-colors" aria-label={t('toggleRightPanel')}>
              <PanelRight size={16} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <PanelGroup direction="horizontal">
          {showLeftPanel && (
            <>
              <Panel id="sidebar-left" order={1} defaultSize={20} minSize={15} maxSize={30} role="navigation" aria-label={t('notes')} className="vibrancy-sidebar flex flex-col border-r border-gray-200/60 dark:border-gray-700/60">
                <ErrorBoundary>
                  <Sidebar
                    notes={filteredNotes}
                    noteFolders={noteFolders}
                    activeNoteName={activeNoteName}
                    pinnedNotes={pinnedNotes}
                    onSelectNote={onOpenNote}
                    onCreateNote={(folder) => { void onHandleCreateNote({ folder }); }}
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
              <PanelResizeHandle className="w-1 cursor-col-resize" />
            </>
          )}

          <Panel id="editor-center" order={2} minSize={30} role="main" className="editor-canvas bg-white dark:bg-gray-900 flex flex-col overflow-hidden">
            {activeView && <ViewPage view={activeView} onOpenNote={onOpenNote} onNotice={onToast} />}
            {activeNoteName && !activeView && (
              <EditorToolbar
                editor={activeEditor}
                showToolbar={settings.showToolbar}
                showAiBar={settings.showAiBar}
                onAiError={onToastError}
                findOpen={panels.findOpen}
                onCloseFind={() => panels.setFindOpen(false)}
                onOpenFind={() => panels.setFindOpen(true)}
                onOpenGlobalSearch={panels.toggleGlobalSearch}
                onToggleAiBar={() => onUpdateSettings({ showAiBar: !settings.showAiBar })}
                shareSlot={
                  <ShareMenu
                    getCurrentNoteContent={() => {
                      const ed = editorRef.current;
                      if (!ed) return '';
                      return getMarkdownFromHtml(ed.getHTML());
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

            <div className={`flex-1 overflow-y-auto relative scroll-fade-bottom ${focusClass} ${typewriterClass} ${activeView ? 'hidden' : ''}`}>
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
                    onNotice={onToast}
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

          {showRightPanel && (
            <>
              <PanelResizeHandle className="w-1 cursor-col-resize" />
              <Panel id="sidebar-right" order={3} defaultSize={25} minSize={20} maxSize={40} role="complementary" aria-label={t('toolsPanel')} className="vibrancy-sidebar flex flex-col border-l border-gray-200/60 dark:border-gray-700/60">
                <div className="p-2 border-b border-gray-200/40 dark:border-gray-700/40 shrink-0">
                  <div {...rightTabs.tablistProps} aria-label={t('rightPanelTools')} className="flex bg-gray-200/40 dark:bg-gray-900/40 p-0.5 rounded-lg">
                    {visibleRightTabs.map((tab) => (
                      <button key={tab} type="button"
                        {...rightTabs.getTabProps(tab)}
                        onClick={() => panels.setRightTab(tab)}
                        className={`flex-1 py-2 text-xs font-medium rounded-md transition-all duration-150 ${
                          rightTab === tab
                            ? 'bg-white/80 dark:bg-gray-700/60 text-gray-800 dark:text-gray-100 shadow-sm font-semibold'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                        }`}
                      >
                        {t(TAB_LABEL[tab])}
                      </button>
                    ))}
                  </div>
                </div>
                <div {...rightTabs.panelProps} className="flex-1 min-h-0 flex flex-col">
                  <ErrorBoundary>
                    {rightTab === 'ai' && <AiChat getEditorText={onGetEditorText} retrieveNotes={retrieveNotes} noteCount={ragNoteCount} />}
                    {rightTab === 'agent' && (
                      <AgentPanel
                        activeNoteName={activeNoteName}
                        activeNoteContent={activeNoteContent}
                        notes={notes}
                        onOpenNote={onOpenNote}
                        onAgentAction={onAgentAction}
                      />
                    )}
                    {rightTab === 'analytics' && <TextAnalytics getText={onGetEditorText} activeNoteName={activeNoteName} />}
                    {/* 'graph' tab key retained for state/persistence compatibility;
                        the old global graph is retired in favour of a readable
                        per-note Connections view (project siblings + backlinks). */}
                    {rightTab === 'outline' && <OutlinePanel editor={activeEditor} />}
                    {rightTab === 'graph' && (
                      <ConnectionsPanel onOpenNote={onOpenNote} />
                    )}
                  </ErrorBoundary>
                </div>
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
    </>
  );
}
