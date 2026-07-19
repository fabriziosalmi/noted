import type { AppChromeProps } from './types';
import { useMemo } from 'react';
import { parseAgentNote } from '../../lib/agentWorkflow';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { PanelLeft, PanelRight, Keyboard, LayoutTemplate, History, Focus } from 'lucide-react';
import TurndownService from 'turndown';
import { Sidebar } from '../Sidebar';
import { NoteEditor } from '../NoteEditor';
import { AiChat } from '../AiChat';
import { TextAnalytics } from '../TextAnalytics';
import { ConnectionsPanel } from '../ConnectionsPanel';
import { AgentPanel } from '../AgentPanel';
import { NoteAdvisorBadge } from '../NoteAdvisor';
import { EditorToolbar } from '../EditorToolbar';
import { GitBadge } from '../GitPanel';
import { ErrorBoundary } from '../ErrorBoundary';
import { Tooltip } from '../Tooltip';
import { ShareMenu } from '../ShareMenu';
import { useTablist } from '../../lib/useTablist';

const RIGHT_TABS = ['ai', 'agent', 'analytics', 'graph'] as const;

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/prefer-for-of */
function getMarkdownFromHtml(html: string): string {
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

  // Add span rule to format rich text styles (bold, italic, strikethrough, underline)
  turndown.addRule('span', {
    filter: 'span',
    replacement: function (content, node: any) {
      let result = content;
      const style = node.getAttribute('style') || '';
      
      // Bold
      if (style.includes('font-weight: bold') || style.includes('font-weight:bold') || style.includes('font-weight: 700') || style.includes('font-weight:700')) {
        result = '**' + result + '**';
      }
      // Italic
      if (style.includes('font-style: italic') || style.includes('font-style:italic')) {
        result = '*' + result + '*';
      }
      // Strikethrough
      if (style.includes('text-decoration: line-through') || style.includes('text-decoration:line-through')) {
        result = '~~' + result + '~~';
      }
      // Underline
      if (style.includes('text-decoration: underline') || style.includes('text-decoration:underline')) {
        result = '<u>' + result + '</u>';
      }
      
      return result;
    }
  });

  // Add div rule to handle single line breaks instead of double newlines
  turndown.addRule('div', {
    filter: 'div',
    replacement: function (content, node: any) {
      // Avoid adding extra linebreaks inside list items, pre, code, blockquotes
      let parent = node.parentNode;
      while (parent) {
        const tag = parent.nodeName?.toLowerCase();
        if (tag === 'li' || tag === 'pre' || tag === 'code' || tag === 'blockquote') {
          return content;
        }
        parent = parent.parentNode;
      }
      return '\n' + content + '\n';
    }
  });

  // Add table rules to support Markdown table imports
  turndown.addRule('table', {
    filter: 'table',
    replacement: function (content) {
      const cleanContent = content.split('\n').filter((line: string) => line.trim() !== '').join('\n');
      return '\n\n' + cleanContent + '\n\n';
    }
  });

  turndown.addRule('thead-tbody-tfoot', {
    filter: ['thead', 'tbody', 'tfoot'],
    replacement: function (content) {
      return content;
    }
  });

  turndown.addRule('tr', {
    filter: 'tr',
    replacement: function (content, node: any) {
      let tableNode = node;
      while (tableNode && tableNode.nodeName?.toUpperCase() !== 'TABLE') {
        tableNode = tableNode.parentNode;
      }
      
      function getTrElements(element: any) {
        const trs: any[] = [];
        function traverse(n: any) {
          if (n.nodeName?.toUpperCase() === 'TR') {
            trs.push(n);
          } else if (n.childNodes) {
            for (let i = 0; i < n.childNodes.length; i++) {
              traverse(n.childNodes[i]);
            }
          }
        }
        traverse(element);
        return trs;
      }
      
      function hasThDirectChild(trNode: any) {
        if (!trNode.childNodes) return false;
        for (let i = 0; i < trNode.childNodes.length; i++) {
          if (trNode.childNodes[i].nodeName?.toUpperCase() === 'TH') {
            return true;
          }
        }
        return false;
      }
      
      function getCellCount(trNode: any) {
        let count = 0;
        if (!trNode.childNodes) return 0;
        for (let i = 0; i < trNode.childNodes.length; i++) {
          const name = trNode.childNodes[i].nodeName?.toUpperCase();
          if (name === 'TH' || name === 'TD') {
            count++;
          }
        }
        return count;
      }

      const allRows = tableNode ? getTrElements(tableNode) : [];
      const isFirstRow = allRows[0] === node;
      const hasTh = hasThDirectChild(node);
      const isHeader = hasTh || (isFirstRow && !hasTh);

      let separator = '';
      if (isHeader) {
        const cellCount = getCellCount(node);
        separator = '\n|' + Array(cellCount).fill(' --- ').join('|') + '|';
      }
      return '\n|' + content + separator;
    }
  });

  turndown.addRule('td-or-th', {
    filter: ['td', 'th'],
    replacement: function (content) {
      const cleanContent = content.trim().replace(/\n/g, ' ').replace(/\|/g, '\\|');
      return ' ' + cleanContent + ' |';
    }
  });

  return turndown.turndown(html);
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/prefer-for-of */

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
          {activeNoteName ? `Noted — ${activeNoteName.replace('.md', '')}` : 'Noted'}
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
            <button onClick={panels.toggleLeftOpen} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-[var(--accent)] transition-colors" aria-label={t('toggleSidebar')}>
              <PanelLeft size={16} />
            </button>
          </Tooltip>
          <Tooltip label={t('rightPanelTooltip')} side="bottom">
            <button onClick={panels.toggleRightOpen} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-[var(--accent)] transition-colors" aria-label={t('toggleRightPanel')}>
              <PanelRight size={16} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <PanelGroup direction="horizontal">
          {panels.leftOpen && (
            <>
              <Panel id="sidebar-left" order={1} defaultSize={20} minSize={15} maxSize={30} role="navigation" aria-label={t('notes')} className="vibrancy-sidebar flex flex-col border-r border-gray-200/60 dark:border-gray-700/60">
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
              <PanelResizeHandle className="w-1 cursor-col-resize" />
            </>
          )}

          <Panel id="editor-center" order={2} minSize={30} role="main" className="editor-canvas bg-white dark:bg-gray-900 flex flex-col overflow-hidden">
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

            <div className={`flex-1 overflow-y-auto relative scroll-fade-bottom ${focusClass} ${typewriterClass}`}>
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
                        {tab === 'ai' ? t('aiAssistant') : tab === 'agent' ? t('agentTab') : tab === 'analytics' ? t('analyticsPanel') : t('connectionsTab')}
                      </button>
                    ))}
                  </div>
                </div>
                <div {...rightTabs.panelProps} className="flex-1 min-h-0 flex flex-col">
                  <ErrorBoundary>
                    {rightTab === 'ai' && <AiChat getEditorText={onGetEditorText} noteChunks={noteChunks} />}
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
