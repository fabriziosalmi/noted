import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { buildNote, IngestError, prepareSource, writeSourceNote, type IngestInput, type IngestStage, type Prepared } from '../lib/ingest';
import { Modal } from './Modal';
import { ReviewDiff } from './ReviewDiff';

const field = 'w-full text-sm rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 outline-none focus:border-[var(--accent)]';
const button = 'text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40';
const primary = 'text-xs px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white disabled:opacity-40';
const STAGE = { fetching: 'ingestFetching', summarising: 'ingestSummarising', linking: 'ingestLinking' } as const;

/**
 * A note from a source: a web address or some pasted text becomes a short note in sources/ (summary, key points, where it came from,
 * which of your notes it is near). Nothing is written until the person has read it: the title can be changed, and each suggested link
 * to one of their notes is kept or dropped on its own.
 */
export function IngestDialog({ onOpenNote, onNotice }: {
  onOpenNote: (name: string) => void;
  onNotice?: (message: string, variant?: 'success' | 'error') => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const close = useStore(s => s.closeIngest);
  const settings = useStore(s => s.settings);
  const localOnly = settings.ingestLocalOnly ?? false;
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [textTitle, setTextTitle] = useState('');
  const [stage, setStage] = useState<IngestStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [title, setTitle] = useState('');
  const [kept, setKept] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const note = useMemo(() => (prepared ? buildNote(prepared, title) : null), [prepared, title]);

  const start = async () => {
    setError(null);
    const input: IngestInput = url.trim() ? { kind: 'url', url } : { kind: 'text', text, title: textTitle };
    controller.current?.abort();
    const mine = new AbortController();
    controller.current = mine;
    try {
      const result = await prepareSource(input, settings, { signal: mine.signal, onStage: s => { if (!mine.signal.aborted) setStage(s); } });
      if (mine.signal.aborted) return;
      setPrepared(result);
      setTitle(result.input.title);
      setKept(new Set(result.review.changes.map(c => c.id))); // the links are suggestions to read, all kept until dropped
    } catch (e) {
      if (mine.signal.aborted) return;
      setError(e instanceof IngestError ? e.message : (e as Error).message);
    } finally {
      if (!mine.signal.aborted) setStage(null);
    }
  };

  const cancelWork = () => { controller.current?.abort(); setStage(null); };

  const create = async () => {
    if (!prepared) return;
    setSaving(true);
    try {
      const taken = new Set(useStore.getState().notes.map(n => n.name));
      const name = await writeSourceNote(prepared, title, kept, taken, settings.syncDirectory || undefined);
      await useStore.getState().fetchNotes();
      onNotice?.(t('ingestCreated').replace('{name}', name), 'success');
      close();
      onOpenNote(name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const working = stage !== null;
  return (
    <Modal id="ingest" onClose={() => { cancelWork(); close(); }} labelledBy={titleId} solid dismissOnBackdrop={false} className="w-[760px] max-w-[94vw] max-h-[88vh]">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200/60 dark:border-gray-700/60">
        <h2 id={titleId} className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('ingestTitle')}</h2>
      </div>

      <div className="overflow-y-auto px-4 py-3 space-y-3" data-testid="ingest">
        {error && <p role="alert" data-testid="ingest-error" className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 rounded px-2 py-1.5">{error}</p>}

        {!prepared && (
          <>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('ingestHint')}</p>
            <div>
              <label htmlFor="ingest-url" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">{t('ingestUrl')}</label>
              <input id="ingest-url" type="url" value={url} onChange={e => setUrl(e.target.value)} disabled={working} placeholder={t('ingestUrlPlaceholder')} className={field} />
            </div>
            <div>
              <label htmlFor="ingest-text" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">{t('ingestText')}</label>
              <textarea id="ingest-text" value={text} onChange={e => setText(e.target.value)} disabled={working || !!url.trim()} rows={6} className={`${field} font-mono text-xs`} />
              <input aria-label={t('ingestTextTitle')} type="text" value={textTitle} onChange={e => setTextTitle(e.target.value)} disabled={working || !!url.trim()} placeholder={t('ingestTextTitle')} className={`${field} mt-1.5`} />
            </div>
            <label className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-200">
              <input type="checkbox" checked={localOnly} onChange={e => useStore.getState().updateSettings({ ingestLocalOnly: e.target.checked })} disabled={working} className="mt-0.5" />
              <span>{t('ingestLocalOnly')}<span className="block text-[11px] text-gray-500 dark:text-gray-400">{t('ingestLocalOnlyHint')}</span></span>
            </label>
          </>
        )}

        {working && (
          <p role="status" data-testid="ingest-stage" className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" /> {t(STAGE[stage])}
          </p>
        )}

        {prepared && note && (
          <>
            <div>
              <label htmlFor="ingest-title" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">{t('ingestNoteTitle')}</label>
              <input id="ingest-title" type="text" value={title} onChange={e => setTitle(e.target.value)} className={field} />
            </div>
            <div className="text-sm space-y-2" data-testid="ingest-preview">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t('ingestSummaryLabel')}</h3>
              <p className="whitespace-pre-wrap">{prepared.input.summary.summary}</p>
              {prepared.input.summary.keyPoints.length > 0 && (
                <>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t('ingestKeyPointsLabel')}</h3>
                  <ul className="list-disc pl-5 space-y-0.5">{prepared.input.summary.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </>
              )}
              {prepared.clipped && <p className="text-[11px] text-amber-700 dark:text-amber-400" data-testid="ingest-clipped">{t('ingestClipped')}</p>}
            </div>
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <p className="px-3 py-1.5 text-[11px] text-gray-500 dark:text-gray-400 border-b border-gray-200/60 dark:border-gray-700/60">{prepared.input.related.length > 0 ? t('ingestRelatedHelp') : t('ingestNoRelated')}</p>
              {prepared.input.related.length > 0 && <ReviewDiff before={note.before} after={note.after} model={note.review} accepted={kept} onChange={setKept} />}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200/60 dark:border-gray-700/60">
        {prepared ? (
          <>
            <button type="button" onClick={() => { setPrepared(null); setError(null); }} className={button}>{t('ingestBack')}</button>
            <button type="button" onClick={() => { void create(); }} disabled={saving || !title.trim()} className={primary}>{t('ingestCreate')}</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => { cancelWork(); close(); }} className={button}>{t('ingestCancel')}</button>
            <button type="button" onClick={() => { void start(); }} disabled={working || (!url.trim() && !text.trim())} className={primary}>{t('ingestStart')}</button>
          </>
        )}
      </div>
    </Modal>
  );
}
