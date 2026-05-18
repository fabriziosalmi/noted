import { useState, useRef, useEffect } from 'react';
import { Share2, Cloud, FolderOpen, FileDown, Wifi } from 'lucide-react';

interface ShareMenuProps {
  getCurrentNoteContent: () => string;
  getCurrentNoteTitle: () => string;
  syncDirectory?: string;
  onToast: (msg: string, type: 'success' | 'error') => void;
  hasNote: boolean;
}

export function ShareMenu({ getCurrentNoteContent, getCurrentNoteTitle, syncDirectory, onToast, hasNote }: ShareMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  const handleCopyVaultToICloud = async () => {
    setOpen(false);
    const icloudRes = await window.electronAPI.getICloudPath();
    if (!icloudRes.success || !icloudRes.data) {
      onToast(icloudRes.error ?? 'iCloud Drive not available', 'error');
      return;
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

  const handleExportNoteMarkdown = async () => {
    setOpen(false);
    const content = getCurrentNoteContent();
    if (!content) { onToast('No active note', 'error'); return; }
    const res = await window.electronAPI.exportMarkdown(content);
    if (res.success) onToast('Note exported', 'success');
    else onToast(res.error ?? 'Export failed', 'error');
  };

  const handleShareNote = async () => {
    setOpen(false);
    const content = getCurrentNoteContent();
    const title = getCurrentNoteTitle();
    if (!content && !title) { onToast('No active note', 'error'); return; }
    const res = await window.electronAPI.shareNoteMacOS({ content, title });
    if (!res.success) onToast(res.error ?? 'Share failed', 'error');
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-[var(--accent)] transition-colors"
        aria-label="Share or export"
        aria-haspopup="true"
        aria-expanded={open}
        title="Share / Export"
      >
        <Share2 size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-60 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden py-1">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Vault</div>
          <button
            onClick={handleCopyVaultToICloud}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
          >
            <Cloud size={14} className="shrink-0 text-gray-400" />
            <span>Copy to iCloud Drive</span>
          </button>
          <button
            onClick={handleExportVaultToFolder}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
          >
            <FolderOpen size={14} className="shrink-0 text-gray-400" />
            <span>Export vault to folder…</span>
          </button>
          <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Current note</div>
          <button
            onClick={handleExportNoteMarkdown}
            disabled={!hasNote}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FileDown size={14} className="shrink-0 text-gray-400" />
            <span>Save as .md…</span>
          </button>
          <button
            onClick={handleShareNote}
            disabled={!hasNote}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Wifi size={14} className="shrink-0 text-gray-400" />
            <span>Share / AirDrop…</span>
          </button>
        </div>
      )}
    </div>
  );
}
