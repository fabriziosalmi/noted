import { useCallback, useEffect, useId, useState } from 'react';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { Modal } from './Modal';
import { getElectronApi } from '../lib/electronApi';
import { flushPendingSaves } from '../lib/pendingSave';
import { useStore } from '../store/useStore';
import type { MigrationOutcome, MigrationProgress, MigrationReport } from '../types';

type Direction = 'to-markdown' | 'to-html';
type Format = 'html' | 'markdown';

const fill = (text: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), text);

const PHASE_KEY: Record<MigrationProgress['phase'], TranslationKey> = {
  scan: 'noteFormatPhaseScan',
  convert: 'noteFormatPhaseConvert',
  backup: 'noteFormatPhaseBackup',
  write: 'noteFormatPhaseWrite',
  finish: 'noteFormatPhaseFinish',
};

/**
 * How the vault stores its notes (ADR 0001), and the way from HTML to Markdown and back. Converting never
 * starts without showing what it would do first; the report lists every note that is not converted exactly,
 * and a conversion that would lose text needs an explicit second yes.
 */
export function NoteFormatSettings({ syncDirectory }: { syncDirectory: string | null }) {
  const { t } = useI18n();
  const setVaultConverting = useStore(s => s.setVaultConverting);
  const [format, setFormat] = useState<Format | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [report, setReport] = useState<MigrationReport | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [outcome, setOutcome] = useState<MigrationOutcome | null>(null);
  const syncDir = syncDirectory || undefined;

  const refreshFormat = useCallback(async () => {
    const res = await getElectronApi()?.getVaultFormat?.(syncDir);
    if (res?.success && res.data) setFormat(res.data);
  }, [syncDir]);

  useEffect(() => {
    void refreshFormat();
    return getElectronApi()?.onVaultFormatChanged?.(() => { void refreshFormat(); });
  }, [refreshFormat]);

  useEffect(() => getElectronApi()?.onMigrationProgress?.(setProgress), []);

  const closeDialog = () => { setReport(null); setOutcome(null); setProgress(null); };

  // The open note is read-only from here until the conversion is over or called off.
  const start = async (direction: Direction) => {
    const api = getElectronApi();
    if (!api?.migrationPlan || busy) return;
    setBusy(true);
    setStatus(t('noteFormatChecking'));
    setVaultConverting(true);
    let showing = false;
    try {
      await flushPendingSaves(); // what is typed but not yet saved goes to disk, in the old format, first
      const plan = await api.migrationPlan(direction, syncDir);
      if (!plan.success || !plan.data) { setStatus(plan.error ?? t('noteFormatFailedRun')); return; }
      setStatus(null);
      setOutcome(null);
      setProgress(null);
      setReport(plan.data);
      showing = true;
    } catch {
      setStatus(t('noteFormatFailedRun'));
    } finally {
      setBusy(false);
      if (!showing) setVaultConverting(false);
    }
  };

  const run = async (allowLossy: boolean) => {
    const api = getElectronApi();
    if (!api || !report || running) return;
    setRunning(true);
    setProgress({ phase: 'scan', done: 0, total: 0 });
    try {
      const result = report.direction === 'to-markdown'
        ? await api.migrationApply({ allowLossy }, syncDir)
        : await api.migrationRevert(syncDir);
      setOutcome(result);
      if (result.ok) await refreshFormat();
    } catch (err) {
      setOutcome({ ok: false, reason: (err as Error).message });
    } finally {
      setRunning(false);
      setVaultConverting(false);
    }
  };

  const closeAfterRun = () => { closeDialog(); setVaultConverting(false); };

  return (
    <div className="space-y-2 pt-1" data-testid="note-format">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{t('noteFormatTitle')}</p>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">
            {format === 'markdown' ? t('noteFormatHelpMarkdown') : t('noteFormatHelpHtml')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void start(format === 'markdown' ? 'to-html' : 'to-markdown'); }}
          disabled={busy || running || format === null}
          className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
        >
          {format === 'markdown' ? t('noteFormatToHtml') : t('noteFormatToMarkdown')}
        </button>
      </div>
      {format && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400" data-testid="note-format-current">
          {format === 'markdown' ? t('noteFormatCurrentMarkdown') : t('noteFormatCurrentHtml')}
        </p>
      )}
      {status && <p className="text-[11px] text-gray-500 dark:text-gray-400" role="status">{status}</p>}
      {report && (
        <ConversionDialog
          report={report}
          running={running}
          progress={progress}
          outcome={outcome}
          onConvert={allowLossy => { void run(allowLossy); }}
          onClose={outcome || !running ? closeAfterRun : () => undefined}
        />
      )}
    </div>
  );
}

export function ConversionDialog({
  report, running, progress, outcome, onConvert, onClose,
}: {
  report: MigrationReport;
  running: boolean;
  progress: MigrationProgress | null;
  outcome: MigrationOutcome | null;
  onConvert: (allowLossy: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [acceptLoss, setAcceptLoss] = useState(false);
  const toMarkdown = report.direction === 'to-markdown';
  const { verdicts } = report;
  const blocked = report.failed > 0;
  const needsAck = verdicts.lossy > 0;
  const shown = report.notes.filter(n => n.verdict !== 'exact' || n.error);
  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  return (
    <Modal id="note-format-dialog" onClose={onClose} labelledBy={titleId} dismissOnBackdrop={!running} solid className="w-[560px] max-w-[92vw] max-h-[85vh]">
      <div className="px-5 py-4 overflow-y-auto space-y-3">
        <h2 id={titleId} className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {fill(t(toMarkdown ? 'noteFormatReportTitleMd' : 'noteFormatReportTitleHtml'), { n: report.convert })}
        </h2>

        {!outcome && (
          <>
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{t('noteFormatReportIntro')}</p>
            <p className="text-xs text-gray-700 dark:text-gray-200" data-testid="note-format-summary">
              {fill(t('noteFormatSummary'), { convert: report.convert, skip: report.skip })}
            </p>
            {toMarkdown && (
              <ul className="text-xs text-gray-600 dark:text-gray-300 space-y-0.5 list-disc pl-5">
                <li>{fill(t('noteFormatExact'), { n: verdicts.exact })}</li>
                {verdicts.raw > 0 && <li>{fill(t('noteFormatRaw'), { n: verdicts.raw })}</li>}
                {verdicts.formatting > 0 && <li>{fill(t('noteFormatFormatting'), { n: verdicts.formatting })}</li>}
                {verdicts.lossy > 0 && <li className="text-red-600 dark:text-red-400">{fill(t('noteFormatLossy'), { n: verdicts.lossy })}</li>}
                {report.failed > 0 && <li className="text-red-600 dark:text-red-400">{fill(t('noteFormatCannot'), { n: report.failed })}</li>}
              </ul>
            )}

            {shown.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">{t('noteFormatReview')}</p>
                <ul className="max-h-48 overflow-y-auto text-[11px] space-y-1 border border-gray-200/60 dark:border-gray-700/60 rounded-lg p-2" data-testid="note-format-notes">
                  {shown.map(n => (
                    <li key={n.name}>
                      <span className="font-medium text-gray-700 dark:text-gray-200">{n.name}</span>
                      <span className="text-gray-500 dark:text-gray-400"> — {n.error ?? n.findings.join('; ')}</span>
                    </li>
                  ))}
                  {report.truncated && <li className="text-gray-400">{t('noteFormatMore')}</li>}
                </ul>
              </div>
            )}

            {blocked && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{t('noteFormatBlocked')}</p>}
            {needsAck && !blocked && (
              <label className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-200">
                <input type="checkbox" checked={acceptLoss} onChange={e => setAcceptLoss(e.target.checked)} className="mt-0.5" />
                <span>{t('noteFormatLossyAck')}</span>
              </label>
            )}
          </>
        )}

        {running && progress && (
          <div role="status" aria-live="polite" data-testid="note-format-progress">
            <p className="text-xs text-gray-600 dark:text-gray-300">
              {t(PHASE_KEY[progress.phase])}{progress.total > 0 ? ` ${progress.done} / ${progress.total}` : ''}
            </p>
            <div className="mt-1 h-1.5 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden" aria-hidden="true">
              <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {outcome?.ok && (
          <p className="text-xs text-gray-700 dark:text-gray-200" role="status" data-testid="note-format-done">
            {fill(t('noteFormatDone'), { n: outcome.converted, path: outcome.backup })}
          </p>
        )}
        {outcome && !outcome.ok && (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert" data-testid="note-format-error">{outcome.reason}</p>
        )}
      </div>

      <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100/40 dark:border-gray-700/40 bg-gray-50/30 dark:bg-gray-900/20">
        <button
          type="button"
          onClick={onClose}
          disabled={running}
          className="px-3 py-1.5 text-sm rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-gray-700/60 disabled:opacity-40"
        >
          {outcome ? t('close') : t('cancel')}
        </button>
        {!outcome && (
          <button
            type="button"
            onClick={() => onConvert(acceptLoss)}
            disabled={running || blocked || (needsAck && !acceptLoss)}
            className="px-3 py-1.5 text-sm rounded-lg text-white btn-primary disabled:opacity-40"
          >
            {t('noteFormatConvert')}
          </button>
        )}
      </div>
    </Modal>
  );
}
