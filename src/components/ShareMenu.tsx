import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Share2, Cloud, FolderOpen, FileDown, Wifi, Code2, Check, Globe, Lock,
  FileText as PdfIcon, FileCode, FileText as DocxIcon, Printer,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';

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

type GistState = 'idle' | 'confirm' | 'saving' | 'done';

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
  const [gistState, setGistState] = useState<GistState>('idle');
  const [gistPublic, setGistPublic] = useState(false);
  const [gistUrl, setGistUrl] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) { setGistState('idle'); setGistUrl(''); }
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
    setOpen(false);
    const icloudRes = await window.electronAPI.getICloudPath();
    if (!icloudRes.success || !icloudRes.data) {
      onToast(icloudRes.error ?? 'iCloud Drive not available', 'error'); return;
    }
    const res = await window.electronAPI.copyVaultToFolder({ destDir: icloudRes.data, syncDir: syncDirectory });
    if (res.success) onToast(`${res.data?.copied ?? 0} notes copied to iCloud Drive`, 'success');
    else if (!res.canceled) onToast(res.error ?? 'Export failed', 'error');
  };

  const handleExportVaultToFolder = async () => {
    setOpen(false);
    const res = await window.electronAPI.copyVaultToFolder({ syncDir: syncDirectory });
    if (res.success) onToast(`${res.data?.copied ?? 0} notes exported to ${res.data?.destDir ?? 'folder'}`, 'success');
    else if (!res.canceled) onToast(res.error ?? 'Export failed', 'error');
  };

  // ── Current note: format exports ──────────────────────────────────────
  const handleExportMd = async () => {
    setOpen(false);
    const content = getCurrentNoteContent();
    if (!content) { onToast('No active note', 'error'); return; }
    const res = await window.electronAPI.exportMarkdown(content);
    if (res.success) onToast(t('markdownExported'), 'success');
    else onToast(res.error ?? t('markdownExportError'), 'error');
  };

  const handleExportPdf = async () => {
    setOpen(false);
    const html = getCurrentNoteHtml();
    if (!html) { onToast('No active note', 'error'); return; }
    const res = await window.electronAPI.exportPdf(html);
    if (res.success) onToast(t('pdfExported'), 'success');
    else onToast(res.error ?? t('pdfExportError'), 'error');
  };

  const handleExportHtml = async () => {
    setOpen(false);
    const html = getCurrentNoteHtml();
    if (!html) { onToast('No active note', 'error'); return; }
    const title = getCurrentNoteTitle() || 'Nota';
    const res = await window.electronAPI.exportHtml(html, title);
    if (res.success) onToast(t('htmlExported'), 'success');
    else onToast(res.error ?? t('htmlExportError'), 'error');
  };

  const handleExportDocx = async () => {
    setOpen(false);
    const html = getCurrentNoteHtml();
    if (!html) { onToast('No active note', 'error'); return; }
    const title = getCurrentNoteTitle() || 'Nota';
    const res = await window.electronAPI.exportDocx(html, title);
    if (res.success) onToast(t('docxExported'), 'success');
    else onToast(res.error ?? t('docxExportError'), 'error');
  };

  const handlePrint = async () => {
    setOpen(false);
    const html = getCurrentNoteHtml();
    if (!html || !window.electronAPI?.printNote) return;
    const res = await window.electronAPI.printNote(html, getCurrentNoteTitle() || 'Nota');
    if (!res.success && res.error) onToast(res.error || t('printError'), 'error');
  };

  const handleShareNote = async () => {
    setOpen(false);
    const content = getCurrentNoteContent();
    const title = getCurrentNoteTitle();
    if (!content && !title) { onToast('No active note', 'error'); return; }
    const res = await window.electronAPI.shareNoteMacOS({ content, title });
    if (!res.success) onToast(res.error ?? 'Share failed', 'error');
  };

  const handleCreateGist = useCallback(async () => {
    setGistState('saving');
    const tokenRes = await window.electronAPI.gitGetToken?.();
    const token = tokenRes?.data ?? '';
    if (!token) {
      onToast('GitHub token required — add it in Settings → Git', 'error');
      setGistState('idle');
      return;
    }
    const content = getCurrentNoteContent();
    const fileName = getCurrentNoteFileName() || 'note.md';
    const res = await window.electronAPI.gitSaveAsGist?.({ fileName, content, isPublic: gistPublic, token });
    if (res?.success && res.data) {
      await navigator.clipboard.writeText(res.data);
      setGistUrl(res.data);
      setGistState('done');
      onToast(t('gistCreated'), 'success');
    } else {
      onToast(t('gistError').replace('{msg}', res?.error ?? 'unknown'), 'error');
      setGistState('confirm');
    }
  }, [gistPublic, getCurrentNoteContent, getCurrentNoteFileName, onToast, t]);

  // ── UI helpers ────────────────────────────────────────────────────────
  const menuItem = (icon: React.ReactNode, label: string, onClick: () => void, disabled = false) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span className="shrink-0 text-gray-400 dark:text-gray-500">{icon}</span>
      <span>{label}</span>
    </button>
  );

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(v => !v)}
        className="p-1.5 rounded transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-[var(--accent)]"
        aria-label={t('shareExport')}
        aria-haspopup="true"
        aria-expanded={open}
        title={t('shareExport')}
      >
        <Share2 size={15} />
      </button>

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
              {gistState === 'idle' && (
                <button
                  onClick={() => setGistState('confirm')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <Code2 size={14} className="shrink-0 text-gray-400 dark:text-gray-500" />
                  <span>{t('saveAsGist')}</span>
                </button>
              )}

              {gistState === 'confirm' && (
                <div className="px-3 py-2 space-y-2 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{t('gistVisibility')}</p>
                  <div className="flex gap-2">
                    {[
                      { value: false, icon: <Lock size={11} />, label: t('gistPrivate') },
                      { value: true,  icon: <Globe size={11} />, label: t('gistPublic') },
                    ].map(({ value, icon, label }) => (
                      <button
                        key={String(value)}
                        onClick={() => setGistPublic(value)}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs border transition-colors ${
                          gistPublic === value
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

              {gistState === 'saving' && (
                <div className="px-3 py-2 text-xs text-gray-400 animate-pulse border-t border-gray-100 dark:border-gray-700">
                  Creating gist…
                </div>
              )}

              {gistState === 'done' && (
                <div className="px-3 py-2 space-y-1.5 border-t border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    <Check size={11} /> {t('gistCreated')}
                  </div>
                  <button
                    onClick={() => { if (gistUrl) window.open(gistUrl, '_blank'); }}
                    className="w-full text-left text-[11px] text-[var(--accent)] hover:underline truncate"
                  >
                    {gistUrl}
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
