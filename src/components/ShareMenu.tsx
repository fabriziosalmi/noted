import { useState, useRef, useEffect, useCallback, useReducer } from 'react';
import {
  Share2, Cloud, FolderOpen, FileDown, Wifi, Code2, Check, Globe, Lock,
  FileText as PdfIcon, FileCode, FileText as DocxIcon, Printer,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { getElectronApi } from '../lib/electronApi';
import { initialShareWorkflowState, isShareWorkflowBusy, shareWorkflowReducer } from '../lib/shareWorkflow';
import { Tooltip } from './Tooltip';

interface ShareMenuProps {
  getCurrentNoteContent: () => string;
  getCurrentNoteTitle: () => string;
  getCurrentNoteFileName: () => string;
  /** Raw editor HTML — needed for PDF/HTML/DOCX/Print exports (not Markdown). */
  getCurrentNoteHtml: () => string;
  syncDirectory?: string;
  onToast: (msg: string, type: 'success' | 'error') => void;
  hasNote: boolean;
}

export function ShareMenu({
  getCurrentNoteContent,
  getCurrentNoteTitle,
  getCurrentNoteFileName,
  getCurrentNoteHtml,
  syncDirectory,
  onToast,
  hasNote,
}: ShareMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [workflow, dispatchWorkflow] = useReducer(shareWorkflowReducer, initialShareWorkflowState);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) dispatchWorkflow({ type: 'RESET' });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  // ── Vault-wide ────────────────────────────────────────────────────────
  const handleCopyVaultToICloud = async () => {
    if (isShareWorkflowBusy(workflow.stage)) return;
    const api = getElectronApi();
    if (!api) return;
    dispatchWorkflow({ type: 'START_ACTION', action: 'copyVaultToICloud' });
    setOpen(false);
    const icloudRes = await api.getICloudPath();
    if (!icloudRes.success || !icloudRes.data) {
      onToast(icloudRes.error ?? t('iCloudNotAvailable'), 'error');
      dispatchWorkflow({ type: 'ACTION_FAILED', message: icloudRes.error ?? t('iCloudNotAvailable') });
      return;
    }
    const res = await api.copyVaultToFolder({ destDir: icloudRes.data, syncDir: syncDirectory });
    if (res.success) {
      onToast(t('notesCopiedICloud').replace('{count}', String(res.data?.copied ?? 0)), 'success');
      dispatchWorkflow({ type: 'ACTION_SUCCESS' });
    } else if (!res.canceled) {
      onToast(res.error ?? t('exportFailed'), 'error');
      dispatchWorkflow({ type: 'ACTION_FAILED', message: res.error ?? t('exportFailed') });
    } else {
      dispatchWorkflow({ type: 'ACTION_SUCCESS' });
    }
  };

  const handleExportVaultToFolder = async () => {
    if (isShareWorkflowBusy(workflow.stage)) return;
    const api = getElectronApi();
    if (!api) return;
    dispatchWorkflow({ type: 'START_ACTION', action: 'exportVaultToFolder' });
    setOpen(false);
    const res = await api.copyVaultToFolder({ syncDir: syncDirectory });
    if (res.success) {
      onToast(t('notesExportedFolder').replace('{count}', String(res.data?.copied ?? 0)).replace('{dir}', res.data?.destDir ?? t('exportFolderFallback')), 'success');
      dispatchWorkflow({ type: 'ACTION_SUCCESS' });
    } else if (!res.canceled) {
      onToast(res.error ?? t('exportFailed'), 'error');
      dispatchWorkflow({ type: 'ACTION_FAILED', message: res.error ?? t('exportFailed') });
    } else {
      dispatchWorkflow({ type: 'ACTION_SUCCESS' });
    }
  };

  // ── Current note: format exports ──────────────────────────────────────
  const handleExportMd = async () => {
    if (isShareWorkflowBusy(workflow.stage)) return;
    const api = getElectronApi();
    if (!api) return;
    dispatchWorkflow({ type: 'START_ACTION', action: 'exportMarkdown' });
    setOpen(false);
    const content = getCurrentNoteContent();
    if (!content) {
      onToast(t('noActiveNote'), 'error');
      dispatchWorkflow({ type: 'ACTION_FAILED', message: t('noActiveNote') });
      return;
    }
    const res = await api.exportMarkdown(content);
    if (res.success) {
      onToast(t('markdownExported'), 'success');
      dispatchWorkflow({ type: 'ACTION_SUCCESS' });
    } else {
      onToast(res.error ?? t('markdownExportError'), 'error');
      dispatchWorkflow({ type: 'ACTION_FAILED', message: res.error ?? t('markdownExportError') });
    }
  };

  const handleExportPdf = async () => {
    if (isShareWorkflowBusy(workflow.stage)) return;
    const api = getElectronApi();
    if (!api) return;
    dispatchWorkflow({ type: 'START_ACTION', action: 'exportPdf' });
    setOpen(false);
    const html = getCurrentNoteHtml();
    if (!html) {
      onToast(t('noActiveNote'), 'error');
      dispatchWorkflow({ type: 'ACTION_FAILED', message: t('noActiveNote') });
      return;
    }
    const res = await api.exportPdf(html);
    if (res.success) {
      onToast(t('pdfExported'), 'success');
      dispatchWorkflow({ type: 'ACTION_SUCCESS' });
    } else {
      onToast(res.error ?? t('pdfExportError'), 'error');
      dispatchWorkflow({ type: 'ACTION_FAILED', message: res.error ?? t('pdfExportError') });
    }
  };

  const handleExportHtml = async () => {
    if (isShareWorkflowBusy(workflow.stage)) return;
    const api = getElectronApi();
    if (!api) return;
    dispatchWorkflow({ type: 'START_ACTION', action: 'exportHtml' });
    setOpen(false);
    const html = getCurrentNoteHtml();
    if (!html) {
      onToast(t('noActiveNote'), 'error');
      dispatchWorkflow({ type: 'ACTION_FAILED', message: t('noActiveNote') });
      return;
    }
    const title = getCurrentNoteTitle() || t('untitledExportTitle');
    const res = await api.exportHtml(html, title);
    if (res.success) {
      onToast(t('htmlExported'), 'success');
      dispatchWorkflow({ type: 'ACTION_SUCCESS' });
    } else {
      onToast(res.error ?? t('htmlExportError'), 'error');
      dispatchWorkflow({ type: 'ACTION_FAILED', message: res.error ?? t('htmlExportError') });
    }
  };

  const handleExportDocx = async () => {
    if (isShareWorkflowBusy(workflow.stage)) return;
    const api = getElectronApi();
    if (!api) return;
    dispatchWorkflow({ type: 'START_ACTION', action: 'exportDocx' });
    setOpen(false);
    const html = getCurrentNoteHtml();
    if (!html) {
      onToast(t('noActiveNote'), 'error');
      dispatchWorkflow({ type: 'ACTION_FAILED', message: t('noActiveNote') });
      return;
    }
    const title = getCurrentNoteTitle() || t('untitledExportTitle');
    const res = await api.exportDocx(html, title);
    if (res.success) {
      onToast(t('docxExported'), 'success');
      dispatchWorkflow({ type: 'ACTION_SUCCESS' });
    } else {
      onToast(res.error ?? t('docxExportError'), 'error');
      dispatchWorkflow({ type: 'ACTION_FAILED', message: res.error ?? t('docxExportError') });
    }
  };

  const handlePrint = async () => {
    if (isShareWorkflowBusy(workflow.stage)) return;
    const api = getElectronApi();
    if (!api) return;
    dispatchWorkflow({ type: 'START_ACTION', action: 'printNote' });
    setOpen(false);
    const html = getCurrentNoteHtml();
    if (!html || !api.printNote) {
      dispatchWorkflow({ type: 'ACTION_FAILED', message: t('noActiveNote') });
      return;
    }
    const res = await api.printNote(html, getCurrentNoteTitle() || t('untitledExportTitle'));
    if (!res.success && res.error) {
      onToast(res.error || t('printError'), 'error');
      dispatchWorkflow({ type: 'ACTION_FAILED', message: res.error || t('printError') });
    } else {
      dispatchWorkflow({ type: 'ACTION_SUCCESS' });
    }
  };

  const handleShareNote = async () => {
    if (isShareWorkflowBusy(workflow.stage)) return;
    const api = getElectronApi();
    if (!api) return;
    dispatchWorkflow({ type: 'START_ACTION', action: 'shareNote' });
    setOpen(false);
    const content = getCurrentNoteContent();
    const title = getCurrentNoteTitle();
    if (!content && !title) {
      onToast(t('noActiveNote'), 'error');
      dispatchWorkflow({ type: 'ACTION_FAILED', message: t('noActiveNote') });
      return;
    }
    const res = await api.shareNoteMacOS({ content, title });
    if (!res.success) {
      onToast(res.error ?? t('shareFailed'), 'error');
      dispatchWorkflow({ type: 'ACTION_FAILED', message: res.error ?? t('shareFailed') });
    } else {
      dispatchWorkflow({ type: 'ACTION_SUCCESS' });
    }
  };

  const handleCreateGist = useCallback(async () => {
    const api = getElectronApi();
    if (!api) return;
    dispatchWorkflow({ type: 'START_GIST_SAVE' });
    const tokenRes = await api.gitGetToken?.();
    const token = tokenRes?.data ?? '';
    if (!token) {
      onToast(t('gistTokenRequired'), 'error');
      dispatchWorkflow({ type: 'OPEN_GIST_CONFIRM' });
      return;
    }
    const content = getCurrentNoteContent();
    const fileName = getCurrentNoteFileName() || 'note.md';
    const res = await api.gitSaveAsGist?.({ fileName, content, isPublic: workflow.gistPublic, token });
    if (res?.success && res.data) {
      await navigator.clipboard.writeText(res.data);
      dispatchWorkflow({ type: 'GIST_SAVED', url: res.data });
      onToast(t('gistCreated'), 'success');
    } else {
      onToast(t('gistError').replace('{msg}', res?.error ?? 'unknown'), 'error');
      dispatchWorkflow({ type: 'OPEN_GIST_CONFIRM' });
    }
  }, [getCurrentNoteContent, getCurrentNoteFileName, onToast, t, workflow.gistPublic]);

  // ── UI helpers ────────────────────────────────────────────────────────
  const menuItem = (icon: React.ReactNode, label: string, onClick: () => void, disabled = false) => (
    <button
      onClick={onClick}
      disabled={disabled || isShareWorkflowBusy(workflow.stage)}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span className="shrink-0 text-gray-400 dark:text-gray-500">{icon}</span>
      <span>{label}</span>
    </button>
  );

  return (
    <div ref={ref} className="relative inline-block">
      <Tooltip label={t('shareExport')}>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="p-1.5 rounded transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-[var(--accent)]"
          aria-label={t('shareExport')}
          aria-haspopup="true"
          aria-expanded={open}
        >
          <Share2 size={15} />
        </button>
      </Tooltip>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden py-1">

          {/* Current note — format exports */}
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{t('shareExportNote')}</div>
          {menuItem(<FileDown size={14} />, t('exportMarkdown'),  handleExportMd,   !hasNote)}
          {menuItem(<PdfIcon size={14} />,  t('exportPdf'),       handleExportPdf,  !hasNote)}
          {menuItem(<FileCode size={14} />, t('exportHtml'),      handleExportHtml, !hasNote)}
          {menuItem(<DocxIcon size={14} />, t('exportDocx'),      handleExportDocx, !hasNote)}
          {menuItem(<Printer size={14} />,  t('print'),           handlePrint,      !hasNote)}
          {menuItem(<Wifi size={14} />,     t('shareAirdrop'),    handleShareNote,  !hasNote)}

          <div className="border-t border-gray-100 dark:border-gray-700 my-1" />

          {/* Vault */}
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{t('shareExportVault')}</div>
          {menuItem(<Cloud size={14} />,      t('copyToICloud'),      handleCopyVaultToICloud)}
          {menuItem(<FolderOpen size={14} />, t('exportVaultFolder'), handleExportVaultToFolder)}

          {/* Gist */}
          {hasNote && (
            <>
              <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
              {(workflow.stage === 'idle' || workflow.stage === 'failed') && (
                <button
                  onClick={() => dispatchWorkflow({ type: 'OPEN_GIST_CONFIRM' })}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <Code2 size={14} className="shrink-0 text-gray-400 dark:text-gray-500" />
                  <span>{t('saveAsGist')}</span>
                </button>
              )}

              {workflow.stage === 'gistConfirming' && (
                <div className="px-3 py-2 space-y-2 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{t('gistVisibility')}</p>
                  <div className="flex gap-2">
                    {[
                      { value: false, icon: <Lock size={11} />, label: t('gistPrivate') },
                      { value: true,  icon: <Globe size={11} />, label: t('gistPublic') },
                    ].map(({ value, icon, label }) => (
                      <button
                        key={String(value)}
                        onClick={() => dispatchWorkflow({ type: 'SET_GIST_VISIBILITY', isPublic: value })}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs border transition-colors ${
                          workflow.gistPublic === value
                            ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]'
                            : 'border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        {icon}{label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={handleCreateGist}
                    className="btn-primary w-full py-1.5 rounded text-xs font-medium"
                  >
                    {t('gistCreate')}
                  </button>
                </div>
              )}

              {workflow.stage === 'gistSaving' && (
                <div className="px-3 py-2 text-xs text-gray-400 animate-pulse border-t border-gray-100 dark:border-gray-700">
                  {t('gistCreating')}
                </div>
              )}

              {workflow.stage === 'gistDone' && (
                <div className="px-3 py-2 space-y-1.5 border-t border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    <Check size={11} /> {t('gistCreated')}
                  </div>
                  <button
                    onClick={() => { if (workflow.gistUrl) window.open(workflow.gistUrl, '_blank'); }}
                    className="w-full text-left text-[11px] text-[var(--accent)] hover:underline truncate"
                  >
                    {workflow.gistUrl}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
