import { useState, useRef, useCallback, useReducer, useEffect } from 'react';
import { useI18n } from './lib/i18n';
import type { Editor } from '@tiptap/react';
import { useStore } from './store/useStore';
import type { AgentUiAction } from './store/useStore';
import { useToast } from './hooks/useToast';
import { useTheme } from './hooks/useTheme';
import { useNoteAdvisor } from './hooks/useNoteAdvisor';
import { retrieveChunks } from './lib/ragSearch';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { useGitSync } from './hooks/useGitSync';
import { useEmbeddingSync } from './hooks/useEmbeddingSync';
import { useVaultIndex } from './hooks/useVaultIndex';
import { useViews } from './hooks/useViews';
import { useVaultFormatSync } from './hooks/useVaultFormatSync';
import { useLanguageSync } from './hooks/useLanguageSync';
import { registerLinkUpdateUi } from './lib/linkUpdateUi';
import { useGitSyncStore } from './store/gitSyncStore';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useAppActions } from './hooks/useAppActions';
import { useAppPanels } from './hooks/useAppPanels';
import { useAppDerivedState } from './hooks/useAppDerivedState';
import { AppChrome } from './components/app/AppChrome';
import { AppModals } from './components/app/AppModals';
import { createAppComposition } from './components/app/composition';
import type { Suggestion } from './lib/noteAdvisor';
import { getElectronApi } from './lib/electronApi';
import { printNoteFromHtml } from './lib/printNote';
import { initialMergeWorkflowState, mergeWorkflowReducer } from './lib/mergeWorkflow';
import { useConfirm, usePrompt } from './components/ConfirmProvider';

function App() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const prompt = usePrompt();
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
  const srAnnouncement     = useStore(s => s.srAnnouncement);
  const announce           = useStore(s => s.announce);
  const applyAgentAction   = useStore(s => s.applyAgentAction);
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
    fetchNotes, createNote, createTitledNote, openNote, saveActiveNote, deleteNote, renameNote,
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

  // The AI chat asks the main process for the sections of the whole vault that best answer a question (words, and meaning
  // when embeddings are on); nothing is read when the panel opens.
  const retrieve = useCallback(
    (query: string, topK: number) => retrieveChunks(query, topK, settings),
    [settings],
  );

  // Vectors for the vault's sections, kept current while embeddings are on.
  useEmbeddingSync();

  // Background git sync: engine state mirror + the interval / idle / focus triggers.
  useGitSync(settings.syncDirectory || undefined);

  // Links and tags come from the main-process VaultIndex (snapshot + deltas).
  useVaultIndex(settings.syncDirectory || undefined);
  useViews(settings.syncDirectory || undefined);
  useVaultFormatSync();
  useLanguageSync();

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
    createTitledNote,
    openOrCreateDaily,
    deleteNote,
    renameNote,
    updateSettings,
    createFolder,
    renameFolder,
    deleteFolder,
    moveNote,
    confirm,
    attachmentsFolder: settings.attachmentsFolder,
  });

  const handlePrintNote = useCallback(() => {
    const html = editorRef.current?.getHTML() ?? '';
    const title = activeNoteName?.replace(/\.md$/i, '') ?? '';
    void printNoteFromHtml(html, title, { t, onToast: toast });
  }, [activeNoteName, t, toast]);

  useGlobalShortcuts({
    onToggleShortcuts: panels.toggleShortcuts,
    onToggleQuickOpen: panels.toggleQuickOpen,
    onPrintNote: handlePrintNote,
    onToggleFind: panels.toggleFind,
    onToggleGlobalSearch: panels.toggleGlobalSearch,
    onToggleFocusMode: () => updateSettings({ focusMode: !settings.focusMode }),
    onCreateNote: () => { void handleCreateNote(); },
  });

  // Native menu commands from the main process → the same renderer actions.
  useEffect(() => {
    const api = getElectronApi();
    if (!api?.onMenuCommand) return;
    return api.onMenuCommand((cmd) => {
      switch (cmd) {
        case 'settings': panels.openSettings(); break;
        case 'new-note': void handleCreateNote(); break;
        case 'daily': void handleOpenDaily(); break;
        case 'quick-open': panels.toggleQuickOpen(); break;
        case 'print-note': handlePrintNote(); break;
        case 'search': panels.toggleGlobalSearch(); break;
        case 'focus-mode': updateSettings({ focusMode: !settings.focusMode }); break;
        case 'shortcuts': panels.toggleShortcuts(); break;
      }
    });
  }, [panels, handleCreateNote, handleOpenDaily, handlePrintNote, updateSettings, settings.focusMode]);

  const handleEditorReady = useCallback((editor: Editor | null) => {
    editorRef.current = editor;
    setActiveEditor(editor);
  }, []);

  // Note: per-format export handlers now live inside ShareMenu (mounted as the
  // EditorToolbar's shareSlot). Removed handleExportMarkdown / handleExportPdf
  // / handlePrint / handleExportDocx / handleExportHtml from this file.

  const getEditorText = useCallback(() => editorRef.current?.getText() ?? '', []);

  // Drive an agent-workflow transition from the interactive panel: run the
  // engine over the live editor HTML, then write the result straight back into
  // the editor (autosave persists it; the workflow-mirror file is written by
  // the store action).
  const handleAgentAction = useCallback(async (action: AgentUiAction) => {
    const editor = editorRef.current;
    if (!editor) return;
    const res = await applyAgentAction(action, editor.getHTML());
    if ('error' in res) {
      toast(res.error, 'error');
      return;
    }
    editor.commands.setContent(res.newHtml);
    toast(t('agentStateUpdated'), 'success');
  }, [applyAgentAction, toast, t]);

  const { suggestions, dismiss: dismissSuggestion, dismissAll } = useNoteAdvisor({
    activeNoteName,
    activeNoteContent,
    notes,
  });
  const [mergeWorkflow, dispatchMergeWorkflow] = useReducer(
    mergeWorkflowReducer,
    initialMergeWorkflowState,
  );

  async function handleAdvisorAction(s: Suggestion) {
    const target = s.noteName;
    switch (s.action) {
      case 'open':
      case 'openFirst':
        await openNote(target);
        break;
      case 'rename': {
        const current = target.replace(/\.md$/, '');
        const next = await prompt({
          title: t('advActionRename'),
          message: t('advRenamePrompt').replace('{note}', current),
          defaultValue: current,
          confirmLabel: t('advActionRename'),
        });
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
          ed.chain().focus().insertContentAt(0, `<h1>${t('addHeadingsTitle')}</h1><h2>${t('addHeadingsSection')}</h2><p></p>`).run();
        }, 120);
        break;
      }
      case 'merge': {
        if (mergeWorkflow.stage !== 'idle' && mergeWorkflow.stage !== 'completed' && mergeWorkflow.stage !== 'failed') {
          return;
        }
        const listStr = (s.relatedNotes || []).map(n => n.replace(/\.md$/, '')).join(', ');
        const targetTitle = s.noteName.replace(/\.md$/, '');
        const confirmationMsg = t('confirmMergeNotes')
          .replace('{list}', listStr)
          .replace('{target}', targetTitle);
        
        if (await confirm({ message: confirmationMsg, danger: true })) {
          try {
            dispatchMergeWorkflow({ type: 'START' });
            const syncDir = settings.syncDirectory || undefined;
            let mergedContent = '';
            const api = getElectronApi();
            if (!api) {
              throw new Error('electronAPI is not available');
            }

            const targetRes = await api.readNote(s.noteName, syncDir);
            if (targetRes.success && targetRes.data !== undefined) {
              mergedContent = targetRes.data as string;
            } else if (activeNoteName === s.noteName) {
              mergedContent = activeNoteContent;
            } else {
              // Can't read the target and it isn't the open note — abort rather
              // than overwrite it with empty/partial content.
              throw new Error(t('mergeAborted'));
            }
            dispatchMergeWorkflow({ type: 'TARGET_READ' });

            // Only sources whose content we actually merged are safe to delete;
            // a note that failed to read must NOT be deleted (its content would
            // be lost without ever being merged).
            const mergedSources: string[] = [];
            let relatedProcessed = 0;
            for (const relatedNote of s.relatedNotes || []) {
              const res = await api.readNote(relatedNote, syncDir);
              if (res.success && res.data !== undefined) {
                const noteContent = res.data as string;
                const noteTitle = relatedNote.replace(/\.md$/, '');
                mergedContent += `\n\n<hr />\n\n<h2>${t('mergedHeading').replace('{title}', noteTitle)}</h2>\n\n${noteContent}`;
                mergedSources.push(relatedNote);
              }
              relatedProcessed += 1;
              dispatchMergeWorkflow({ type: 'RELATED_READ', processed: relatedProcessed });
            }

            const saveRes = await api.saveNote(s.noteName, mergedContent, syncDir);
            if (!saveRes.success) {
              throw new Error(saveRes.error || 'Failed to save merged note');
            }
            dispatchMergeWorkflow({ type: 'SAVED' });

            dispatchMergeWorkflow({ type: 'DELETING_RELATED' });
            for (const relatedNote of mergedSources) {
              await deleteNote(relatedNote);
            }
            
            await openNote(s.noteName);
            dispatchMergeWorkflow({ type: 'REOPENED' });
            toast(t('notesMergedSuccess'), 'success');
          } catch (err: unknown) {
            console.error('Merge failed:', err);
            dispatchMergeWorkflow({
              type: 'FAILED',
              message: (err as Error)?.message ?? 'merge workflow failed',
            });
            toast(t('mergeNotesError'), 'error');
          } finally {
            dispatchMergeWorkflow({ type: 'RESET' });
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
      retrieve,
      ragNoteCount: notes.length,
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

  // Announce note switches to screen readers via the app-root live region.
  useEffect(() => {
    if (!activeNoteName) return;
    const title = activeNoteName.replace(/\.md$/i, '').split('/').pop() || activeNoteName;
    announce(`${t('noteOpened')} ${title}`);
  }, [activeNoteName, announce, t]);

  // Link updates after renames: the store decides when, the UI asks and reports.
  // A held-back (title-driven) rewrite is also settled when the window loses focus.
  const linkUpdateDeps = useRef({ confirm, toast, t });
  useEffect(() => { linkUpdateDeps.current = { confirm, toast, t }; });
  useEffect(() => {
    registerLinkUpdateUi({
      confirm: ({ name, notes, links }) => {
        const { confirm: ask, t: tr } = linkUpdateDeps.current;
        return ask({
          message: tr('linkUpdateConfirm').replace('{name}', name).replace('{links}', String(links)).replace('{notes}', String(notes)),
          confirmLabel: tr('linkUpdateConfirmYes'),
          cancelLabel: tr('linkUpdateConfirmNo'),
        });
      },
      notify: ({ notes, links, failed }) => {
        const { toast: show, t: tr } = linkUpdateDeps.current;
        if (failed > 0) show(tr('linkUpdatePartial').replace('{n}', String(failed)), 'error');
        else show(tr('linkUpdateDone').replace('{links}', String(links)).replace('{notes}', String(notes)), 'success');
      },
    });
    const onBlur = () => { void useStore.getState().flushPendingLinkRewrite(); };
    window.addEventListener('blur', onBlur);
    return () => { registerLinkUpdateUi(null); window.removeEventListener('blur', onBlur); };
  }, []);

  // Tell the user once when sync pauses on a conflict. The engine reports
  // 'syncing' on every cycle, so compare against the last settled phase, or a
  // paused sync would re-announce itself each time it re-checks.
  const conflictToastDeps = useRef({ toast, t });
  useEffect(() => { conflictToastDeps.current = { toast, t }; });
  useEffect(() => {
    let settled = useGitSyncStore.getState().state?.phase;
    return useGitSyncStore.subscribe(({ state }) => {
      const phase = state?.phase;
      if (phase === 'syncing' || phase === settled) return;
      if (phase === 'conflict') {
        const { toast: show, t: tr } = conflictToastDeps.current;
        show(tr('gitSyncConflictToast').replace('{n}', String(state?.conflicts.length ?? 0)), 'error');
      }
      settled = phase;
    });
  }, []);

  // React to vault writes by anyone other than the app itself (an MCP client, a
  // sync client): refresh the list, since a note they created or deleted would
  // otherwise stay invisible until the next launch, and hand the open note to the
  // editor when it is the one that changed, so autosave doesn't clobber it.
  // The active note is read at event time rather than closed over: the
  // subscription is set up once and must outlive note switching.
  useEffect(() => {
    const api = getElectronApi();
    if (!api?.onNoteChangedExternally) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = api.onNoteChangedExternally((fileName) => {
      // The editor decides what to do (reload / keep both) and tells the user.
      if (fileName === useStore.getState().activeNoteName) useStore.getState().notifyExternalChange(fileName);
      // Coalesce: one external batch fires an event per file, and every refresh
      // re-reads the whole vault.
      clearTimeout(timer);
      timer = setTimeout(() => { void fetchNotes(); }, 300);
    });
    return () => { clearTimeout(timer); off(); };
  }, [fetchNotes]);

  return (
    <div className={`h-screen w-screen flex flex-col bg-white/85 dark:bg-gray-900/85 ${fontClass} ${sizeClass}`}>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{srAnnouncement}</div>
      <AppChrome
        {...composition.chrome}
        editorRef={editorRef}
        onGetEditorText={getEditorText}
        onEditorReady={handleEditorReady}
        onAgentAction={handleAgentAction}
      />
      <AppModals
        {...composition.modals}
        onHandleAdvisorAction={(s) => { void handleAdvisorAction(s); }}
        onRestoreVersion={(content) => {
          // Load the restored version into the editor so the stale buffer can't
          // clobber it on the next autosave, and persist it.
          editorRef.current?.commands.setContent(content);
          void saveActiveNote(content).catch(() => undefined);
        }}
      />
    </div>
  );
}

export default App;
