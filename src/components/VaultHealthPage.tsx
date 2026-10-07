import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileDown, Loader2, RefreshCw } from 'lucide-react';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { getElectronApi } from '../lib/electronApi';
import { askLLM, describeLlmError } from '../lib/llm';
import { createMasker } from '../lib/piiMasker';
import { diskToWire } from '../lib/noteIo';
import { htmlToPlainText, deriveTitleFromRelPath } from '../../shared/search/textExtract';
import { KIND_DESC, KIND_ORDER, KIND_TITLE, reportMarkdown, reportName } from '../lib/vaultHealth';
import type { Finding, LintReport } from '../../shared/lint/vaultLint';
import { useConfirm } from './ConfirmProvider';

const STALE_CHOICES = [90, 180, 365, 730];
const SHOWN = 50;
const small = 'shrink-0 text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40';
const link = 'font-medium text-gray-800 dark:text-gray-100 hover:text-[var(--accent)] text-left';
const stem = (name: string): string => name.replace(/\.md$/i, '');

/** Makes the folders a note will be in, one level at a time (the app creates a folder inside a folder that exists), as many as are missing. */
async function ensureFolders(file: string, syncDir: string | undefined): Promise<string | null> {
  const api = getElectronApi();
  const parts = file.split('/').slice(0, -1);
  for (let i = 0; i < parts.length; i++) {
    const res = await api?.createFolder(parts.slice(0, i + 1).join('/'), syncDir);
    if (res && !res.success && !/already exists/i.test(res.error ?? '')) return res.error ?? 'failed';
  }
  return null;
}

/**
 * The health of the whole vault: links that lead nowhere, notes nothing leads to, notes that say the same thing, notes
 * untouched for a long time. Every check is deterministic (no model); a model is asked for one thing only, a summary
 * for a long note, and its answer is shown to be edited before anything is written. Each finding has the fixes that make
 * sense for it; none is done until you press it.
 */
export function VaultHealthPage({ onOpenNote, onNotice }: {
  onOpenNote: (name: string) => void;
  onNotice?: (message: string, variant?: 'success' | 'error') => void;
}) {
  const { t, language } = useI18n();
  const confirm = useConfirm();
  const closeHealth = useStore(s => s.closeHealth);
  const syncDir = useStore(s => s.settings.syncDirectory) || undefined;
  const piiMasking = useStore(s => s.settings.piiMasking ?? false);
  const [report, setReport] = useState<LintReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [staleDays, setStaleDays] = useState(365);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const check = useCallback(async () => {
    setChecking(true);
    const res = await getElectronApi()?.vaultLint?.({ staleDays }, syncDir).catch((e: Error) => ({ success: false as const, error: e.message, data: undefined }));
    if (res?.success && res.data) { setReport(res.data); setError(null); } else setError(res?.error ?? 'unavailable');
    setChecking(false);
  }, [staleDays, syncDir]);
  useEffect(() => { void check(); }, [check]);

  const grouped = useMemo(() => KIND_ORDER.map(kind => ({ kind, found: (report?.findings ?? []).filter(f => f.kind === kind) })).filter(g => g.found.length > 0), [report]);

  /** Runs a fix on a finding, shows that it is working, and checks the vault again once it is done. */
  const act = async (f: Finding, work: () => Promise<string | null>) => {
    setBusy(b => new Set(b).add(f.id));
    try {
      const failed = await work();
      if (failed) onNotice?.(t('healthFixFailed').replace('{error}', failed), 'error');
      else onNotice?.(t('healthDone'), 'success');
      void useStore.getState().fetchNotes();
      await check();
    } finally {
      setBusy(b => { const next = new Set(b); next.delete(f.id); return next; });
    }
  };

  const createMissing = (f: Extract<Finding, { kind: 'broken-link' }>) => act(f, async () => {
    const title = deriveTitleFromRelPath(`${f.target}.md`);
    const safe = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const name = `${f.target.replace(/\.md$/i, '')}.md`;
    const folderError = await ensureFolders(name, syncDir);
    if (folderError) return folderError;
    const res = await getElectronApi()?.saveNote(name, `<h1>${safe}</h1><p></p>`, syncDir);
    return res?.success ? null : (res?.error ?? 'failed');
  });

  const retarget = (f: Extract<Finding, { kind: 'broken-link' }>) => act(f, async () => {
    if (!f.suggestion) return 'no suggestion';
    // Every link to the name that leads nowhere now leads to the note that was meant: the same rewrite as a rename's.
    const res = await getElectronApi()?.rewriteLinks([{ from: `${f.target.replace(/\.md$/i, '')}.md`, to: f.suggestion }], syncDir);
    return res?.success ? null : (res?.error ?? 'failed');
  });

  const archive = (f: Finding, name: string) => act(f, async () => {
    const res = await getElectronApi()?.moveNote(name, 'Archive', syncDir, { updateLinks: true });
    return res?.success ? null : (res?.error ?? 'failed');
  });

  const trash = async (f: Finding, names: string[], keep?: string) => {
    const ok = await confirm({
      title: t('healthConfirmTrashTitle'),
      message: keep ? t('healthConfirmCopies').replace('{keep}', stem(keep)).replace('{n}', String(names.length)) : t('healthConfirmTrash').replace('{name}', stem(names[0])),
      confirmLabel: t('healthTrash'),
      danger: true,
    });
    if (!ok) return;
    await act(f, async () => {
      for (const name of names) {
        const res = await getElectronApi()?.deleteNote(name, syncDir);
        if (!res?.success) return res?.error ?? 'failed';
      }
      return null;
    });
  };

  const suggest = (f: Extract<Finding, { kind: 'no-summary' }>) => act(f, async () => {
    const read = await getElectronApi()?.readNote(f.note, syncDir);
    if (!read?.success || typeof read.data !== 'string') return read?.error ?? 'could not read the note';
    const masker = piiMasking ? createMasker() : undefined;
    const text = htmlToPlainText(read.data).slice(0, 6000);
    try {
      const summary = await askLLM([
        { role: 'system', content: 'Summarize this note in one or two sentences, in the same language as the note. Return ONLY the summary text: no preface, no quotes, no Markdown.' },
        { role: 'user', content: masker ? masker.mask(text) : text },
      ], { masker });
      setDrafts(d => ({ ...d, [f.id]: summary.trim() }));
      return null;
    } catch (e) {
      return describeLlmError(e);
    }
  });

  const saveSummary = (f: Extract<Finding, { kind: 'no-summary' }>) => act(f, async () => {
    const res = await useStore.getState().setNoteProperty(f.note, 'summary', drafts[f.id] ?? '');
    if (res.ok) { setDrafts(d => { const next = { ...d }; delete next[f.id]; return next; }); return null; }
    return res.conflict ? t('viewEditConflict') : res.error;
  });

  const save = async () => {
    if (!report) return;
    const name = reportName(new Date());
    const md = reportMarkdown(report, language, new Date());
    const folderError = await ensureFolders(name, syncDir);
    const res = folderError ? { success: false, error: folderError } : await getElectronApi()?.saveNote(name, diskToWire(md, 'markdown'), syncDir);
    if (res?.success) { onNotice?.(t('healthSaved').replace('{name}', name), 'success'); void useStore.getState().fetchNotes(); onOpenNote(name); }
    else onNotice?.(t('healthSaveFailed').replace('{error}', res?.error ?? 'failed'), 'error');
  };

  const open = (name: string, label = stem(name)) => <button type="button" onClick={() => onOpenNote(name)} className={link} title={name}>{label}</button>;
  const action = (f: Finding, label: string, run: () => void, danger = false) => (
    <button type="button" disabled={busy.has(f.id)} onClick={run} className={`${small} ${danger ? 'text-red-700 dark:text-red-400' : ''}`}>{label}</button>
  );

  const row = (f: Finding) => {
    switch (f.kind) {
      case 'broken-link':
        return (
          <>
            <span className="min-w-0 flex-1">{open(f.note)} <span className="text-gray-500">{t('healthLinksTo')}</span> <span className="font-mono text-xs">{f.target}</span>
              {f.suggestion && <span className="ml-2 text-xs text-gray-500">{t('healthMeant').replace('{name}', stem(f.suggestion))}</span>}</span>
            {f.suggestion && action(f, t('healthUse').replace('{name}', stem(f.suggestion)), () => { void retarget(f); })}
            {action(f, t('healthCreate'), () => { void createMissing(f); })}
          </>
        );
      case 'broken-heading':
        return <span className="min-w-0 flex-1">{open(f.note)} <span className="text-gray-500">{t('healthLinksTo')}</span> {open(f.resolved)} <span className="text-gray-500">›</span> <span className="font-mono text-xs">{f.heading}</span></span>;
      case 'isolated':
        return <><span className="min-w-0 flex-1">{open(f.note)}</span>{action(f, t('healthOpen'), () => onOpenNote(f.note))}</>;
      case 'empty':
        return <><span className="min-w-0 flex-1">{open(f.note)}</span>{action(f, t('healthTrash'), () => { void trash(f, [f.note]); }, true)}</>;
      case 'duplicate': {
        const [keep, ...copies] = f.notes;
        return (
          <>
            <span className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2">{f.notes.map((n, i) => <span key={n}>{i > 0 && <span className="text-gray-400 mr-2">=</span>}{open(n)}</span>)}</span>
            {action(f, t('healthKeepOldest').replace('{n}', String(copies.length)), () => { void trash(f, copies, keep); }, true)}
          </>
        );
      }
      case 'near-duplicate':
        return <span className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2">{open(f.notes[0])}<span className="text-gray-400">≈</span>{open(f.notes[1])}<span className="text-xs text-gray-500">{t('healthAlike').replace('{n}', String(Math.round(f.similarity * 100)))}</span></span>;
      case 'same-name':
        return <span className="min-w-0 flex-1 flex flex-wrap items-center gap-x-3">{f.notes.map(n => <span key={n}>{open(n, n.replace(/\.md$/i, ''))}</span>)}</span>;
      case 'stale':
        return <><span className="min-w-0 flex-1">{open(f.note)} <span className="text-xs text-gray-500">{t('healthAgo').replace('{n}', String(f.days))}</span></span>{action(f, t('healthArchive'), () => { void archive(f, f.note); })}</>;
      case 'no-summary': {
        const draft = drafts[f.id];
        return (
          <>
            <span className="min-w-0 flex-1">{open(f.note)} <span className="text-xs text-gray-500">{t('healthWords').replace('{n}', String(f.words))}</span>
              {draft !== undefined && (
                <span className="mt-1.5 block">
                  <label className="text-[11px] text-gray-500" htmlFor={`sum-${f.id}`}>{t('healthSummaryFor').replace('{name}', stem(f.note))}</label>
                  <textarea
                    id={`sum-${f.id}`} value={draft} rows={2}
                    onChange={e => setDrafts(d => ({ ...d, [f.id]: e.target.value }))}
                    className="mt-0.5 w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1.5 outline-none focus:border-[var(--accent)]"
                  />
                </span>
              )}
            </span>
            {draft === undefined
              ? action(f, t('healthSuggest'), () => { void suggest(f); })
              : <>
                  {action(f, t('healthSummarySave'), () => { void saveSummary(f); })}
                  {action(f, t('healthSummaryCancel'), () => setDrafts(d => { const next = { ...d }; delete next[f.id]; return next; }))}
                </>}
          </>
        );
      }
    }
  };

  const descFor = (kind: Finding['kind']): string => (kind === 'no-summary' ? t(KIND_DESC[kind] as TranslationKey).replace('{n}', String(report?.options.summaryMinWords ?? 200)) : t(KIND_DESC[kind]));

  return (
    <section aria-label={t('healthTitle')} className="flex-1 flex flex-col overflow-hidden" data-testid="health-page">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <button type="button" onClick={closeHealth} aria-label={t('viewClose')} title={t('viewClose')} className="p-1 rounded text-gray-500 hover:text-[var(--accent)] hover:bg-gray-100 dark:hover:bg-gray-800">
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-lg font-semibold">{t('healthTitle')}</h1>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-500 flex items-center gap-1.5">
            {t('healthStaleAfter')}
            <select value={staleDays} onChange={e => setStaleDays(Number(e.target.value))} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-1 text-xs outline-none focus:border-[var(--accent)]">
              {STALE_CHOICES.map(n => <option key={n} value={n}>{t('healthDays').replace('{n}', String(n))}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => { void check(); }} disabled={checking} className={`${small} inline-flex items-center gap-1`}>
            {checking ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={12} aria-hidden="true" />} {t('healthRun')}
          </button>
          <button type="button" onClick={() => { void save(); }} disabled={!report || checking} className={`${small} inline-flex items-center gap-1`}>
            <FileDown size={12} aria-hidden="true" /> {t('healthSave')}
          </button>
        </span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{t('healthFailed').replace('{error}', error)}</p>}
        {!report && !error && <p role="status" className="text-sm text-gray-500">{t('healthChecking')}</p>}
        {report && (
          <>
            <p className="text-xs text-gray-500 dark:text-gray-400" data-testid="health-summary">{t('healthIntro').replace('{n}', String(report.notes)).replace('{found}', String(report.findings.length))}</p>
            {report.findings.length === 0 && <p className="text-sm text-green-700 dark:text-green-400" data-testid="health-clean">{t('healthClean')}</p>}
            {grouped.map(({ kind, found }) => {
              const all = expanded.has(kind);
              return (
                <section key={kind} data-kind={kind} aria-label={t(KIND_TITLE[kind])}>
                  <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t(KIND_TITLE[kind])} <span className="font-normal text-gray-500" data-testid={`count-${kind}`}>{found.length}</span></h2>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">{descFor(kind)}</p>
                  <ul className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200/70 dark:border-gray-700/70 rounded-lg">
                    {(all ? found : found.slice(0, SHOWN)).map(f => (
                      <li key={f.id} data-finding={f.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
                        {row(f)}
                        {busy.has(f.id) && <Loader2 size={12} className="animate-spin text-gray-400" aria-label={t('healthWorking')} />}
                      </li>
                    ))}
                  </ul>
                  {!all && found.length > SHOWN && (
                    <button type="button" onClick={() => setExpanded(e => new Set(e).add(kind))} className="mt-1 text-xs text-[var(--accent)] hover:underline">{t('healthShowAll').replace('{n}', String(found.length))}</button>
                  )}
                </section>
              );
            })}
            {report.unread.length > 0 && <p className="text-[11px] text-gray-500">{t('healthUnread').replace('{n}', String(report.unread.length))}</p>}
          </>
        )}
      </div>
    </section>
  );
}
