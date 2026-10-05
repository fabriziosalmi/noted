import { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { useConfirm } from './ConfirmProvider';
import { getElectronApi } from '../lib/electronApi';
import { DEFAULT_ATTACHMENTS_FOLDER, isValidAttachmentsFolder } from '../../shared/vault/attachmentsFolder';

/**
 * Where pasted images are stored, and the one-shot move of images that older
 * versions embedded inside notes as base64. The move always shows what it would
 * do first, and every changed note keeps a history snapshot, so it can be undone.
 */
export function AttachmentsSettings({
  folder,
  syncDirectory,
  onChangeFolder,
}: {
  folder: string | undefined;
  syncDirectory: string | null;
  onChangeFolder: (name: string) => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [draft, setDraft] = useState(folder ?? DEFAULT_ATTACHMENTS_FOLDER);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const effective = folder ?? DEFAULT_ATTACHMENTS_FOLDER;

  const commit = () => {
    const name = draft.trim();
    if (!isValidAttachmentsFolder(name)) { setInvalid(true); return; }
    setInvalid(false);
    if (name !== effective) onChangeFolder(name);
  };

  const migrate = async () => {
    const api = getElectronApi();
    if (!api?.scanEmbeddedImages || !api.migrateEmbeddedImages || busy) return;
    const syncDir = syncDirectory || undefined;
    setBusy(true);
    setStatus(t('embeddedScanning'));
    try {
      const scan = await api.scanEmbeddedImages(syncDir);
      if (!scan.success || !scan.data) { setStatus(scan.error ?? t('embeddedFailed')); return; }
      const report = scan.data;
      if (report.images === 0) { setStatus(t('embeddedNone')); return; }
      const mb = (report.bytes / (1024 * 1024)).toFixed(1);
      const ok = await confirm({
        message: t('embeddedConfirm')
          .replace('{images}', String(report.images)).replace('{distinct}', String(report.distinct))
          .replace('{size}', mb).replace('{notes}', String(report.notes.length)).replace('{folder}', effective),
        confirmLabel: t('embeddedConfirmYes'),
      });
      if (!ok) { setStatus(null); return; }
      setStatus(t('embeddedMoving'));
      const done = await api.migrateEmbeddedImages(effective, syncDir);
      if (!done.success || !done.data) { setStatus(done.error ?? t('embeddedFailed')); return; }
      const base = t('embeddedDone').replace('{images}', String(done.data.images)).replace('{notes}', String(done.data.notes));
      setStatus(done.data.failed.length ? `${base} ${t('embeddedPartial').replace('{n}', String(done.data.failed.length))}` : base);
    } catch {
      setStatus(t('embeddedFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center justify-between gap-4">
        <div>
          <label htmlFor="attachments-folder" className="text-xs font-medium text-gray-700 dark:text-gray-200">{t('attachmentsFolderLabel')}</label>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">{t('attachmentsFolderHelp')}</p>
        </div>
        <input
          id="attachments-folder"
          type="text"
          value={draft}
          aria-invalid={invalid}
          onChange={e => { setDraft(e.target.value); setInvalid(false); }}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); }}
          className={`w-32 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-[var(--accent)] ${invalid ? 'border-red-400' : 'border-gray-300/40 dark:border-gray-600/40'}`}
        />
      </div>
      {invalid && <p className="text-[11px] text-red-600 dark:text-red-400" role="alert">{t('attachmentsFolderInvalid')}</p>}

      <div className="flex items-center justify-between gap-4">
        <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">{t('embeddedHelp')}</p>
        <button
          type="button"
          onClick={() => { void migrate(); }}
          disabled={busy}
          className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
        >
          {t('embeddedMove')}
        </button>
      </div>
      {status && <p className="text-[11px] text-gray-500 dark:text-gray-400" role="status">{status}</p>}
    </div>
  );
}
