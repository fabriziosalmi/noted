import type { AppModalsProps } from './types';
import { NoteAdvisorPanel } from '../NoteAdvisor';
import { GitPanel } from '../GitPanel';
import { NoteHistoryModal } from '../NoteHistoryModal';
import { TemplatesModal } from '../TemplatesModal';
import { KeyboardShortcutsModal } from '../KeyboardShortcutsModal';
import { SettingsModal } from '../SettingsModal';
import { QuickOpen } from '../QuickOpen';
import { GlobalSearch } from '../GlobalSearch';
import { ToastStack } from '../Toast';

export function AppModals({
  t,
  panels,
  settings,
  notes,
  activeNoteName,
  activeNoteContent,
  customTemplates,
  suggestions,
  toastMessages,
  onDismissToast,
  onDismissSuggestion,
  onDismissAllSuggestions,
  onHandleAdvisorAction,
  onOpenNote,
  onSaveActiveNote,
  onCreateFromTemplate,
  onSaveAsTemplate,
  onDeleteTemplate,
  onUpdateSettings,
  onHandleSelectFolder,
  onHandleImportVault,
}: AppModalsProps) {
  return (
    <>
      {suggestions.length > 0 && !panels.isAdvisorOpen && activeNoteName && (
        <button
          onClick={panels.openAdvisor}
          className="fixed left-4 bottom-3 z-30 inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 shadow-sm transition-colors"
          aria-label={`${t('noteAdvisor')} — ${suggestions.length}`}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
          {suggestions.length} {suggestions.length === 1 ? t('suggestion') : t('suggestions')}
        </button>
      )}

      {panels.isAdvisorOpen && (
        <NoteAdvisorPanel
          suggestions={suggestions}
          onDismiss={onDismissSuggestion}
          onAction={onHandleAdvisorAction}
          onDismissAll={() => { onDismissAllSuggestions(); panels.closeAdvisor(); }}
          onClose={panels.closeAdvisor}
        />
      )}

      {panels.isGitOpen && settings.gitEnabled && (
        <GitPanel
          syncDir={settings.syncDirectory}
          activeNoteName={activeNoteName}
          onClose={panels.closeGit}
        />
      )}

      {panels.isHistoryOpen && activeNoteName && (
        <NoteHistoryModal
          fileName={activeNoteName}
          syncDir={settings.syncDirectory}
          onRestore={(content) => {
            void onSaveActiveNote(content);
            panels.closeHistory();
          }}
          onClose={panels.closeHistory}
        />
      )}

      {panels.isTemplatesOpen && (
        <TemplatesModal
          customTemplates={customTemplates}
          activeNoteContent={activeNoteContent}
          activeNoteName={activeNoteName}
          onApply={(template) => { void onCreateFromTemplate(template); }}
          onSaveCurrent={(name, content) => onSaveAsTemplate(name, content)}
          onDelete={onDeleteTemplate}
          onClose={panels.closeTemplates}
        />
      )}

      {panels.isShortcutsOpen && (
        <KeyboardShortcutsModal onClose={panels.closeShortcuts} />
      )}

      {panels.isSettingsOpen && (
        <SettingsModal
          settings={settings}
          onUpdate={onUpdateSettings}
          onSelectFolder={() => { void onHandleSelectFolder(); }}
          onImportVault={() => { void onHandleImportVault(); }}
          onClose={panels.closeSettings}
        />
      )}

      {panels.quickOpenOpen && (
        <QuickOpen
          notes={notes}
          onSelect={onOpenNote}
          onClose={panels.closeQuickOpen}
        />
      )}

      {panels.globalSearchOpen && (
        <GlobalSearch
          onSelect={onOpenNote}
          onClose={panels.closeGlobalSearch}
        />
      )}

      <ToastStack messages={toastMessages} onDismiss={onDismissToast} />
    </>
  );
}
