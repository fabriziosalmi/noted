import { useState, useRef, useCallback } from 'react';
import { useI18n } from './lib/i18n';
import type { Editor } from '@tiptap/react';
import { useStore } from './store/useStore';
import { useToast } from './hooks/useToast';
import { useTheme } from './hooks/useTheme';
import { useNoteAdvisor } from './hooks/useNoteAdvisor';
import { useNoteChunks } from './hooks/useNoteChunks';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useAppActions } from './hooks/useAppActions';
import { useAppPanels } from './hooks/useAppPanels';
import { useAppDerivedState } from './hooks/useAppDerivedState';
import { AppChrome } from './components/app/AppChrome';
import { AppModals } from './components/app/AppModals';
import { createAppComposition } from './components/app/composition';
import type { Suggestion } from './lib/noteAdvisor';

function App() {
  const { t } = useI18n();
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const { messages: toastMessages, toast, dismiss } = useToast();
  useTheme();
  const panels = useAppPanels();

  // Granular selectors: subscribing to whole-store causes re-render on every
  // keystroke (activeNoteContent changes). Slicing state into shallow pieces
  // means only relevant pieces re-render — action functions are stable refs
  // pulled out of getState() so they don't drive renders at all.
  const notes              = useStore(s => s.notes);
  const activeNoteName     = useStore(s => s.activeNoteName);
  const activeNoteContent  = useStore(s => s.activeNoteContent);
  const settings           = useStore(s => s.settings);
  const pinnedNotes        = useStore(s => s.pinnedNotes);
  const customTemplates    = useStore(s => s.customTemplates);
  const noteLinksIndex     = useStore(s => s.noteLinksIndex);
  const tagIndex           = useStore(s => s.tagIndex);
  const noteFolders        = useStore(s => s.noteFolders);
  // Action functions are stable across renders — pull them once from the
  // bare store object, no subscription.
  const {
    fetchNotes, createNote, openNote, saveActiveNote, deleteNote, renameNote,
    updateSettings, loadApiKey,
    togglePin, openOrCreateDaily,
    saveAsTemplate, deleteTemplate, createFromTemplate,
    createFolder, renameFolder, deleteFolder, moveNote,
  } = useStore.getState();

  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const {
    allTags,
    filteredNotes,
    backlinks,
    allNoteNames,
    fontClass,
    sizeClass,
    focusClass,
    typewriterClass,
  } = useAppDerivedState({
    notes,
    noteLinksIndex,
    tagIndex,
    activeNoteName,
    activeTagFilter,
    settings,
  });

  const noteChunks = useNoteChunks({
    rightOpen: panels.rightOpen,
    notes,
    syncDirectory: settings.syncDirectory,
    ragMaxNotes: settings.ragMaxNotes,
  });

  useAppLifecycle({
    accentColor: settings.accentColor,
    editorBg: settings.editorBg,
    activeNoteName,
    fetchNotes,
    loadApiKey,
  });

  const {
    handleCreateNote,
    handleOpenDaily,
    handleSelectFolder,
    handleDeleteNote,
    handleRenameNote,
    handleImportVault,
    handleCreateFolder,
    handleRenameFolder,
    handleDeleteFolder,
    handleMoveNote,
  } = useAppActions({
    t,
    syncDirectory: settings.syncDirectory,
    toast,
    fetchNotes,
    createNote,
    openOrCreateDaily,
    deleteNote,
    renameNote,
    updateSettings,
    createFolder,
    renameFolder,
    deleteFolder,
    moveNote,
  });

  useGlobalShortcuts({
    onToggleShortcuts: panels.toggleShortcuts,
    onToggleQuickOpen: panels.toggleQuickOpen,
    onToggleFind: panels.toggleFind,
    onToggleGlobalSearch: panels.toggleGlobalSearch,
    onToggleFocusMode: () => updateSettings({ focusMode: !settings.focusMode }),
    onCreateNote: () => { void handleCreateNote(); },
  });

  const handleEditorReady = useCallback((editor: Editor | null) => {
    editorRef.current = editor;
    setActiveEditor(editor);
  }, []);

  // Note: per-format export handlers now live inside ShareMenu (mounted as the
  // EditorToolbar's shareSlot). Removed handleExportMarkdown / handleExportPdf
  // / handlePrint / handleExportDocx / handleExportHtml from this file.

  const getEditorText = useCallback(() => editorRef.current?.getText() ?? '', []);

  const { suggestions, dismiss: dismissSuggestion, dismissAll } = useNoteAdvisor({
    activeNoteName,
    activeNoteContent,
    notes,
  });

  async function handleAdvisorAction(s: Suggestion) {
    const target = s.noteName;
    switch (s.action) {
      case 'open':
      case 'openFirst':
        await openNote(target);
        break;
      case 'rename': {
        const current = target.replace(/\.md$/, '');
        const next = window.prompt(t('advRenamePrompt').replace('{note}', current), current);
        if (next && next.trim() && next.trim() !== current) {
          await handleRenameNote(target, next.trim());
        }
        break;
      }
      case 'addHeadings': {
        if (activeNoteName !== target) await openNote(target);
        // Defer to next tick so editor has the new content loaded.
        setTimeout(() => {
          const ed = editorRef.current;
          if (!ed) return;
          ed.chain().focus().insertContentAt(0, '<h1>Titolo</h1><h2>Sezione</h2><p></p>').run();
        }, 120);
        break;
      }
      case 'merge': {
        const listStr = (s.relatedNotes || []).map(n => n.replace(/\.md$/, '')).join(', ');
        const targetTitle = s.noteName.replace(/\.md$/, '');
        const confirmationMsg = t('confirmMergeNotes')
          .replace('{list}', listStr)
          .replace('{target}', targetTitle);
        
        if (window.confirm(confirmationMsg)) {
          try {
            const syncDir = settings.syncDirectory || undefined;
            let mergedContent = '';
            
            if (window.electronAPI) {
              const targetRes = await window.electronAPI.readNote(s.noteName, syncDir);
              if (targetRes.success && targetRes.data !== undefined) {
                mergedContent = targetRes.data as string;
              } else {
                mergedContent = activeNoteName === s.noteName ? activeNoteContent : '';
              }
              
              for (const relatedNote of s.relatedNotes || []) {
                const res = await window.electronAPI.readNote(relatedNote, syncDir);
                if (res.success && res.data !== undefined) {
                  const noteContent = res.data as string;
                  const noteTitle = relatedNote.replace(/\.md$/, '');
                  mergedContent += `\n\n<hr />\n\n<h2>Merged: ${noteTitle}</h2>\n\n${noteContent}`;
                }
              }
              
              const saveRes = await window.electronAPI.saveNote(s.noteName, mergedContent, syncDir);
              if (!saveRes.success) {
                throw new Error(saveRes.error || 'Failed to save merged note');
              }
            } else {
              throw new Error('electronAPI is not available');
            }
            
            for (const relatedNote of s.relatedNotes || []) {
              await deleteNote(relatedNote);
            }
            
            await openNote(s.noteName);
            toast(t('notesMergedSuccess'), 'success');
          } catch (err) {
            console.error('Merge failed:', err);
            toast(t('mergeNotesError'), 'error');
          }
        }
        break;
      }
    }
    dismissSuggestion(s.id);
    panels.closeAdvisor();
  }

  const composition = createAppComposition(
    {
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
      customTemplates,
      toastMessages,
    },
    {
      onToast: toast,
      onToastError: (msg) => toast(msg, 'error'),
      onUpdateSettings: updateSettings,
      onSetActiveTagFilter: setActiveTagFilter,
      onOpenNote: openNote,
      onSaveActiveNote: saveActiveNote,
      onHandleCreateNote: handleCreateNote,
      onHandleDeleteNote: handleDeleteNote,
      onHandleRenameNote: handleRenameNote,
      onHandleOpenDaily: handleOpenDaily,
      onHandleCreateFolder: handleCreateFolder,
      onHandleRenameFolder: handleRenameFolder,
      onHandleDeleteFolder: handleDeleteFolder,
      onHandleMoveNote: handleMoveNote,
      onTogglePin: togglePin,
      onDismissToast: dismiss,
      onDismissSuggestion: dismissSuggestion,
      onDismissAllSuggestions: dismissAll,
      onCreateFromTemplate: createFromTemplate,
      onSaveAsTemplate: saveAsTemplate,
      onDeleteTemplate: deleteTemplate,
      onHandleSelectFolder: handleSelectFolder,
      onHandleImportVault: handleImportVault,
    },
  );

  return (
    <div className={`h-screen w-screen flex flex-col bg-white/85 dark:bg-gray-900/85 ${fontClass} ${sizeClass}`}>
      <AppChrome
        {...composition.chrome}
        editorRef={editorRef}
        onGetEditorText={getEditorText}
        onEditorReady={handleEditorReady}
      />
      <AppModals
        {...composition.modals}
        onHandleAdvisorAction={(s) => { void handleAdvisorAction(s); }}
      />
    </div>
  );
}

export default App;
