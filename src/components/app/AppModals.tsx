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
  onHandleCreateNote,
  onHandleOpenDaily,
  onToast,
}: AppModalsProps) {
  return (
    <>

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
          onToast={onToast}
        />
      )}

      {panels.quickOpenOpen && (
        <QuickOpen
          notes={notes}
          onSelect={onOpenNote}
          onCreateNote={(name) => { void onHandleCreateNote(name); }}
          onOpenDaily={() => { void onHandleOpenDaily(); }}
          onOpenSettings={panels.openSettings}
          onOpenShortcuts={panels.openShortcuts}
          onOpenTemplates={panels.openTemplates}
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
