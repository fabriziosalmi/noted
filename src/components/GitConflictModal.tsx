import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, GitMerge, Loader2, X } from 'lucide-react';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { useModalStack } from '../hooks/useModalStack';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useGitSyncStore } from '../store/gitSyncStore';
import { getElectronApi } from '../lib/electronApi';
import type { GitSyncConflict } from '../lib/gitSyncTypes';
import type { Choice } from '../lib/diff3';
import {
  buildResolutions, chunksFor, conflictKey, displayLine, emptyTextDecision, isTextConflict,
  reconcileDecisions, remainingCount, remainingFor, resultText,
  type Decision, type Decisions, type TextDecision,
} from '../lib/conflictResolution';

const NO_CONFLICTS: GitSyncConflict[] = [];

const KIND_LABEL: Record<GitSyncConflict['kind'], TranslationKey> = {
  'both-modified': 'conflictKindBothModified',
  'both-added': 'conflictKindBothAdded',
  'deleted-by-us': 'conflictKindDeletedByUs',
  'deleted-by-them': 'conflictKindDeletedByThem',
};

/** Text to start hand-editing from while some hunks are undecided: yours for those. */
function joinForEdit(conflict: GitSyncConflict, decision: TextDecision): string {
  const filled = decision.choices.map(c => c ?? 'ours');
  return resultText(conflict, { ...decision, choices: filled, manual: null }) ?? '';
}

const buttonBase = 'text-xs px-2.5 py-1 rounded-md border transition-colors';
const buttonOff = 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800';
const buttonOn = 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]';

function Side({ label, lines, tone }: { label: string; lines: string[]; tone: 'mine' | 'theirs' }) {
  return (
    <div className="min-w-0">
      <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${tone === 'mine' ? 'text-sky-600 dark:text-sky-400' : 'text-violet-600 dark:text-violet-400'}`}>{label}</div>
      <div className="text-xs font-mono whitespace-pre-wrap break-words rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-2 min-h-[2rem] text-gray-700 dark:text-gray-200">
        {lines.length === 0 ? <span className="text-gray-400">∅</span> : lines.map((l, i) => <div key={i} title={l}>{displayLine(l) || ' '}</div>)}
      </div>
    </div>
  );
}

function TextConflictEditor({ conflict, decision, onChange }: {
  conflict: GitSyncConflict;
  decision: TextDecision;
  onChange: (d: TextDecision) => void;
}) {
  const { t } = useI18n();
  const chunks = useMemo(() => chunksFor(conflict), [conflict]);
  const manual = decision.manual !== null;
  const setChoice = (idx: number, choice: Choice) => {
    const choices = [...decision.choices];
    choices[idx] = choice;
    onChange({ ...decision, choices });
  };

  let conflictIdx = -1;
  return (
    <div className="space-y-3">
      {chunks.map((chunk, i) => {
        if (chunk.kind === 'stable') {
          return <div key={i} className="text-[11px] text-gray-400 italic">{t('conflictUnchanged').replace('{n}', String(chunk.lines.length))}</div>;
        }
        if (chunk.kind === 'merged') {
          return (
            <div key={i} className="rounded-md border border-emerald-200/60 dark:border-emerald-800/40 bg-emerald-50/50 dark:bg-emerald-900/10 p-2">
              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1">
                <Check size={10} /> {t('conflictAutoMerged')}
              </div>
              <div className="text-xs font-mono whitespace-pre-wrap break-words text-gray-600 dark:text-gray-300">
                {chunk.lines.slice(0, 4).map((l, j) => <div key={j} title={l}>{displayLine(l) || ' '}</div>)}
                {chunk.lines.length > 4 && <div className="text-gray-400">…</div>}
              </div>
            </div>
          );
        }
        const idx = ++conflictIdx;
        const choice = decision.choices[idx];
        return (
          <div key={i} className="rounded-lg border border-amber-300/70 dark:border-amber-700/50 p-2.5 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Side label={t('conflictYours')} lines={chunk.ours} tone="mine" />
              <Side label={t('conflictTheirs')} lines={chunk.theirs} tone="theirs" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['ours', 'theirs', 'both'] as const).map(c => (
                <button
                  key={c}
                  type="button"
                  disabled={manual}
                  aria-pressed={choice === c}
                  onClick={() => setChoice(idx, c)}
                  className={`${buttonBase} ${choice === c ? buttonOn : buttonOff} disabled:opacity-40`}
                >
                  {c === 'ours' ? t('conflictUseYours') : c === 'theirs' ? t('conflictUseTheirs') : t('conflictUseBoth')}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      <div className="text-xs space-y-1.5">
        <button
          type="button"
          aria-pressed={manual}
          onClick={() => {
            // Entering manual mode seeds the editor with the current result.
            if (manual) onChange({ ...decision, manual: null });
            else onChange({ ...decision, manual: resultText(conflict, decision) ?? joinForEdit(conflict, decision) });
          }}
          className={`${buttonBase} ${manual ? buttonOn : buttonOff}`}
        >
          {t('conflictEditByHand')}
        </button>
        {manual && (
          <textarea
            aria-label={t('conflictResult')}
            value={decision.manual ?? ''}
            onChange={e => onChange({ ...decision, manual: e.target.value })}
            className="w-full h-40 text-xs font-mono p-2 rounded-md border border-gray-200 dark:border-gray-700 bg-transparent text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[var(--accent)]"
          />
        )}
      </div>
    </div>
  );
}

function SideConflictEditor({ conflict, decision, onChange }: {
  conflict: GitSyncConflict;
  decision: Decision | undefined;
  onChange: (d: Decision) => void;
}) {
  const { t } = useI18n();
  const chosen = decision?.kind === 'side' ? decision.choice : undefined;
  const opt = (choice: 'ours' | 'theirs', label: string) => (
    <button
      key={label}
      type="button"
      aria-pressed={chosen === choice}
      onClick={() => onChange({ kind: 'side', choice })}
      className={`${buttonBase} ${chosen === choice ? buttonOn : buttonOff}`}
    >
      {label}
    </button>
  );
  const present = conflict.ours ?? conflict.theirs;
  return (
    <div className="space-y-3">
      {conflict.binary
        ? <p className="text-xs text-gray-500 dark:text-gray-400">{t('conflictBinary')}</p>
        : present !== null && <Side label={conflict.ours !== null ? t('conflictYours') : t('conflictTheirs')} lines={present.split('\n')} tone={conflict.ours !== null ? 'mine' : 'theirs'} />}
      <div className="flex flex-wrap gap-1.5">
        {conflict.kind === 'deleted-by-them' && [opt('ours', t('conflictKeepNote')), opt('theirs', t('conflictDeleteNote'))]}
        {conflict.kind === 'deleted-by-us' && [opt('theirs', t('conflictKeepNote')), opt('ours', t('conflictDeleteNote'))]}
        {(conflict.kind === 'both-modified' || conflict.kind === 'both-added') && [opt('ours', t('conflictKeepYours')), opt('theirs', t('conflictKeepTheirs'))]}
      </div>
    </div>
  );
}

export function GitConflictModal({ syncDir, onClose }: { syncDir?: string; onClose: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useModalStack('git-conflicts', true, onClose);
  useFocusTrap(ref, true);

  const conflicts = useGitSyncStore(s => s.state?.conflicts ?? NO_CONFLICTS);
  const phase = useGitSyncStore(s => s.state?.phase);
  const [decisions, setDecisions] = useState<Decisions>({});
  const [selected, setSelected] = useState(0);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A conflict that changed under the user's feet invalidates only its own decision.
  useEffect(() => { setDecisions(d => reconcileDecisions(conflicts, d)); }, [conflicts]);

  // Resolved (here or elsewhere): nothing left to show.
  useEffect(() => {
    if (phase === 'idle' && conflicts.length === 0 && !applying) onClose();
  }, [phase, conflicts, applying, onClose]);

  const current = conflicts[Math.min(selected, Math.max(0, conflicts.length - 1))] as GitSyncConflict | undefined;
  const currentKey = current ? conflictKey(current) : '';
  const remaining = remainingCount(conflicts, decisions);
  const payload = useMemo(() => buildResolutions(conflicts, decisions), [conflicts, decisions]);
  const currentText = useMemo(() => (current && isTextConflict(current) ? emptyTextDecision(current) : null), [current]);

  const setDecision = (c: GitSyncConflict, d: Decision) => setDecisions(prev => ({ ...prev, [conflictKey(c)]: d }));

  const apply = async () => {
    const api = getElectronApi();
    if (!api?.gitSyncResolve || !payload || applying) return;
    setApplying(true);
    setError(null);
    try {
      const out = await api.gitSyncResolve(payload, syncDir);
      if (out.success) { onClose(); return; }
      setError(out.error ?? t('gitSyncStatusError'));
      // Whatever changed, show the user the fresh state of the conflicts.
      void api.gitSyncNow(syncDir).then(st => useGitSyncStore.getState().setState(st)).catch(() => undefined);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <button
        type="button"
        aria-label={t('conflictClose')}
        className="absolute inset-0 bg-black/50"
        onMouseDown={e => { if (e.button === 0 && e.target === e.currentTarget) onClose(); }}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t('conflictTitle')}
        className="relative z-10 flex flex-col w-[min(960px,94vw)] h-[min(660px,88vh)] bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200/60 dark:border-gray-700/60 overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
            <GitMerge size={14} className="text-[var(--accent)]" />
            {t('conflictTitle')}
          </div>
          <button onClick={onClose} aria-label={t('conflictClose')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded">
            <X size={14} />
          </button>
        </div>

        <p className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">{t('conflictIntro')}</p>

        <div className="flex flex-1 min-h-0">
          <nav aria-label={t('conflictFile')} className="w-56 shrink-0 overflow-y-auto border-r border-gray-100 dark:border-gray-800 p-2 space-y-1">
            {conflicts.map((c, i) => {
              const left = remainingFor(c, decisions[conflictKey(c)]);
              const active = conflictKey(c) === currentKey;
              return (
                <button
                  key={conflictKey(c)}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setSelected(i)}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-xs flex items-start gap-1.5 ${active ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'}`}
                >
                  {left === 0 ? <Check size={12} className="mt-0.5 shrink-0 text-emerald-500" /> : <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />}
                  <span className="min-w-0">
                    <span className="block truncate">{c.path.replace(/\.md$/i, '')}</span>
                    <span className="block text-[10px] text-gray-400 truncate">{t(KIND_LABEL[c.kind])}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <section className="flex-1 min-w-0 overflow-y-auto p-4">
            {current ? (
              <>
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-0.5">{current.path.replace(/\.md$/i, '')}</h2>
                <p className="text-[11px] text-gray-400 mb-3">{t(KIND_LABEL[current.kind])}</p>
                {isTextConflict(current) ? (
                  <TextConflictEditor
                    key={currentKey}
                    conflict={current}
                    decision={decisions[currentKey]?.kind === 'text' ? (decisions[currentKey] as TextDecision) : currentText!}
                    onChange={d => setDecision(current, d)}
                  />
                ) : (
                  <SideConflictEditor key={currentKey} conflict={current} decision={decisions[currentKey]} onChange={d => setDecision(current, d)} />
                )}
              </>
            ) : (
              <p className="text-xs text-gray-400">{error ?? ''}</p>
            )}
          </section>
        </div>

        <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-100 dark:border-gray-800">
          <div className="flex-1 min-w-0 text-xs">
            {error
              ? <span className="text-red-600 dark:text-red-400" role="alert">{error}</span>
              : <span className="text-gray-500 dark:text-gray-400">{remaining > 0 ? t('conflictLeft').replace('{n}', String(remaining)) : ''}</span>}
          </div>
          <button
            type="button"
            disabled={!payload || applying}
            onClick={() => { void apply(); }}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--accent)] text-white disabled:opacity-40 flex items-center gap-1.5"
          >
            {applying && <Loader2 size={12} className="animate-spin" />}
            {applying ? t('conflictApplying') : t('conflictApply')}
          </button>
        </div>
      </div>
    </div>
  );
}
