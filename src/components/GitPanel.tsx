import { useState, useEffect, useCallback, useReducer, useRef } from 'react';
import { GitBranch, GitCommit, Upload, GitPullRequest, RefreshCw, X, Check, AlertCircle, Loader2, ExternalLink } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useI18n } from '../lib/i18n';
import { gitWorkflowReducer, initialGitWorkflowState, isGitWorkflowBusy, type GitWorkflowStage } from '../lib/gitWorkflow';
import { Tooltip } from './Tooltip';
import { useModalStack } from '../hooks/useModalStack';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface GitPanelProps {
  syncDir?: string | null;
  activeNoteName: string | null;
  onClose: () => void;
}

interface LocalGitStatus {
  initialized: boolean;
  branch: string;
  dirty: boolean;
  ahead: number;
  stagedFiles: string[];
  modifiedFiles: string[];
}

export function GitPanel({ activeNoteName, onClose }: GitPanelProps) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  useModalStack('git-panel', true, onClose);
  useFocusTrap(panelRef, true);
  const { settings, updateSettings } = useStore();
  const syncDir = settings.syncDirectory || undefined;

  const [status, setStatus] = useState<LocalGitStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [workflow, dispatchWorkflow] = useReducer(gitWorkflowReducer, initialGitWorkflowState);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Commit form
  const [commitMsg, setCommitMsg] = useState('');

  // PR form
  const [showPrForm, setShowPrForm] = useState(false);
  const [prTitle, setPrTitle] = useState(() => activeNoteName?.replace(/\.md$/, '').replace(/[-_]/g, ' ') ?? '');
  const [prBody, setPrBody] = useState('');
  const [prUrl, setPrUrl] = useState<string | null>(null);

  // ── Status polling ───────────────────────────────────────────────────────────

  const refreshStatus = useCallback(async () => {
    if (!window.electronAPI?.gitStatus) return;
    setLoadingStatus(true);
    const res = await window.electronAPI.gitStatus(syncDir);
    setLoadingStatus(false);
    if (res.success && res.data) setStatus(res.data);
  }, [syncDir]);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const showError = (msg: string) => {
    setError(msg);
    setSuccess(null);
    setTimeout(() => setError(null), 6000);
  };

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setError(null);
    setTimeout(() => setSuccess(null), 4000);
  };

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleInit = async () => {
    if (isGitWorkflowBusy(workflow.stage)) return;
    if (!window.electronAPI?.gitInit) return;
    dispatchWorkflow({ type: 'START_INIT' });
    const res = await window.electronAPI.gitInit(syncDir);
    if (res.success) {
      dispatchWorkflow({ type: 'COMPLETED' });
      showSuccess(t('gitInitialized'));
      void refreshStatus();
    } else {
      const message = res.error ?? t('gitInitError');
      dispatchWorkflow({ type: 'FAILED', message });
      showError(message);
    }
  };

  const handleCommitNote = async () => {
    if (isGitWorkflowBusy(workflow.stage)) return;
    if (!activeNoteName || !window.electronAPI?.gitCommitNote) return;
    dispatchWorkflow({ type: 'START_COMMIT_NOTE' });
    const res = await window.electronAPI.gitCommitNote(activeNoteName, commitMsg.trim() || undefined, syncDir);
    if (res.success) {
      dispatchWorkflow({ type: 'COMPLETED' });
      showSuccess(`${t('gitCommitted')} ${res.data?.hash ?? ''}`);
      setCommitMsg('');
      void refreshStatus();
    } else {
      const message = res.error ?? t('gitCommitError');
      dispatchWorkflow({ type: 'FAILED', message });
      showError(message);
    }
  };

  const handleCreatePr = async () => {
    if (isGitWorkflowBusy(workflow.stage)) return;
    if (!activeNoteName || !window.electronAPI) return;
    dispatchWorkflow({ type: 'START_PR' });
    if (!settings.gitRemote) {
      const message = t('gitNoRemote');
      dispatchWorkflow({ type: 'FAILED', message });
      showError(message);
      return;
    }
    const tokenRes = await window.electronAPI.gitGetToken();
    const token = tokenRes.success ? (tokenRes.data ?? '') : '';
    if (!token) {
      const message = t('gitNoToken');
      dispatchWorkflow({ type: 'FAILED', message });
      showError(message);
      return;
    }
    if (!prTitle.trim()) {
      const message = t('gitPrTitleRequired');
      dispatchWorkflow({ type: 'FAILED', message });
      showError(message);
      return;
    }

    dispatchWorkflow({ type: 'PR_VALIDATED' });
    // 1. Prepare branch (commit + create note/slug branch)
    const branchRes = await window.electronAPI.gitPreparePrBranch(activeNoteName, commitMsg.trim() || undefined, syncDir);
    if (!branchRes.success || !branchRes.data) {
      const message = branchRes.error ?? t('gitBranchError');
      dispatchWorkflow({ type: 'FAILED', message });
      showError(message);
      return;
    }
    const { branch } = branchRes.data;
    dispatchWorkflow({ type: 'BRANCH_PREPARED', branch });

    // 2. Push branch
    const pushRes = await window.electronAPI.gitPushBranch(branch, settings.gitRemote, syncDir);
    if (!pushRes.success) {
      const message = pushRes.error ?? t('gitPushError');
      dispatchWorkflow({ type: 'FAILED', message });
      showError(message);
      return;
    }
    dispatchWorkflow({ type: 'PUSHED' });

    // 3. Create PR
    const prRes = await window.electronAPI.gitCreatePr({
      remoteUrl: settings.gitRemote,
      token,
      branch,
      base: settings.gitDefaultBase ?? 'main',
      title: prTitle.trim(),
      body: prBody.trim(),
    });
    if (prRes.success && prRes.data) {
      dispatchWorkflow({ type: 'COMPLETED' });
      setPrUrl(prRes.data.url);
      showSuccess(t('gitPrCreated'));
      setShowPrForm(false);
    } else {
      const message = prRes.error ?? t('gitPrError');
      dispatchWorkflow({ type: 'FAILED', message });
      showError(message);
    }
  };

  const handleSaveToken = async (token: string) => {
    if (!window.electronAPI?.gitStoreToken) return;
    await window.electronAPI.gitStoreToken(token);
    updateSettings({ gitGhToken: '' }); // never persist in store
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const busy = isGitWorkflowBusy(workflow.stage);

  const phaseLabel: Record<GitWorkflowStage, string> = {
    idle: '',
    initializing: t('gitCommitting'),
    committingNote: t('gitCommitting'),
    validatingPr: t('gitCommitting'),
    preparingPrBranch: t('gitCommitting'),
    pushingPrBranch: t('gitPushing'),
    creatingPr: t('gitCreatingPr'),
    completed: '',
    failed: '',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end pt-12 pr-2">
      <button
        type="button"
        aria-label={t('close')}
        className="absolute inset-0 bg-black/40"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          if (e.target !== e.currentTarget) return;
          onClose();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('gitTitle')}
        className="relative z-10 bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-80 flex flex-col overflow-hidden border border-gray-200/60 dark:border-gray-700/60"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
            <GitBranch size={14} className="text-[var(--accent)]" />
            {t('gitTitle')}
          </div>
          <button onClick={onClose} aria-label={t('close')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Feedback */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 rounded-lg px-3 py-2 text-xs text-red-700 dark:text-red-300">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/40 rounded-lg px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
              <Check size={12} className="shrink-0" />
              <span>{success}</span>
            </div>
          )}
          {prUrl && (
            <a href={prUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] rounded-lg px-3 py-2 text-xs text-[var(--accent)] hover:opacity-80 transition-opacity">
              <ExternalLink size={12} className="shrink-0" />
              <span className="truncate">{prUrl}</span>
            </a>
          )}

          {/* Status */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{t('gitStatus')}</span>
              <button onClick={refreshStatus} disabled={loadingStatus} aria-label={t('refresh')} className="text-gray-400 hover:text-gray-600 p-0.5 rounded">
                <RefreshCw size={11} className={loadingStatus ? 'animate-spin' : ''} />
              </button>
            </div>

            {!status ? (
              <p className="text-xs text-gray-400">{t('gitLoading')}</p>
            ) : !status.initialized ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('gitNotInitialized')}</p>
                <button
                  onClick={handleInit}
                  disabled={busy}
                  className="btn-primary w-full text-xs py-1.5 rounded-lg"
                >
                  {t('gitInit')}
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <GitBranch size={11} className="text-gray-400" />
                  <span className="font-mono text-gray-600 dark:text-gray-300">{status.branch}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full ${status.dirty ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                  <span className="text-gray-500 dark:text-gray-400">
                    {status.dirty ? t('gitDirty') : t('gitClean')}
                  </span>
                  {status.ahead > 0 && (
                    <span className="ml-auto text-gray-400">↑{status.ahead}</span>
                  )}
                </div>
                {status.modifiedFiles.length > 0 && (
                  <div className="mt-1 text-[10px] text-gray-400 font-mono space-y-0.5 max-h-16 overflow-y-auto">
                    {status.modifiedFiles.slice(0, 5).map((f: string) => (
                      <div key={f} className="truncate">M {f}</div>
                    ))}
                    {status.modifiedFiles.length > 5 && <div>{t('gitMoreFiles').replace('{count}', String(status.modifiedFiles.length - 5))}</div>}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Commit section */}
          {status?.initialized && (
            <section>
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">{t('gitCommitSection')}</p>
              <input
                type="text"
                value={commitMsg}
                onChange={e => setCommitMsg(e.target.value)}
                placeholder={t('gitCommitPlaceholder')}
                className="w-full text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:border-[var(--accent)] mb-2"
                maxLength={500}
                disabled={busy}
              />
              <div className="flex gap-2">
                {activeNoteName && (
                  <button
                    onClick={handleCommitNote}
                    disabled={busy || !status.dirty}
                    className="btn-primary flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg"
                  >
                    <GitCommit size={11} />
                    {t('gitCommitNote')}
                  </button>
                )}
              </div>
            </section>
          )}

          {/* PR section */}
          {status?.initialized && (
            <section>
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">{t('gitPrSection')}</p>
              {!settings.gitRemote && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">{t('gitNoRemote')}</p>
              )}
              {!showPrForm ? (
                <button
                  onClick={() => setShowPrForm(true)}
                  disabled={busy || !settings.gitRemote || !activeNoteName}
                  className="w-full flex items-center justify-center gap-1.5 text-xs border border-[var(--accent)] text-[var(--accent)] py-1.5 rounded-lg disabled:opacity-40 hover:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] transition-colors"
                >
                  <GitPullRequest size={11} />
                  {t('gitCreatePr')}
                </button>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={prTitle}
                    onChange={e => setPrTitle(e.target.value)}
                    placeholder={t('gitPrTitlePlaceholder')}
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:border-[var(--accent)]"
                    maxLength={256}
                    disabled={busy}
                  />
                  <textarea
                    value={prBody}
                    onChange={e => setPrBody(e.target.value)}
                    placeholder={t('gitPrBodyPlaceholder')}
                    rows={3}
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:border-[var(--accent)] resize-none"
                    maxLength={4096}
                    disabled={busy}
                  />
                  <div className="flex gap-2">
                    <button onClick={() => setShowPrForm(false)} disabled={busy} className="flex-1 text-xs border border-gray-200 dark:border-gray-700 text-gray-500 py-1.5 rounded-lg hover:border-gray-300 transition-colors">
                      {t('gitCancel')}
                    </button>
                    <button
                      onClick={handleCreatePr}
                      disabled={busy || !prTitle.trim()}
                      className="btn-primary flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg"
                    >
                      {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                      {busy ? phaseLabel[workflow.stage] : t('gitPublish')}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Settings inline — remote + token */}
          <section>
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">{t('gitSettingsSection')}</p>
            <div className="space-y-2">
              <div>
                <label className="text-[10px] text-gray-400 mb-0.5 block">{t('gitRemote')}</label>
                <input
                  type="text"
                  aria-label={t('gitRemote')}
                  defaultValue={settings.gitRemote ?? ''}
                  onBlur={e => updateSettings({ gitRemote: e.target.value.trim() })}
                  placeholder="https://github.com/user/repo"
                  className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:border-[var(--accent)] font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 mb-0.5 block">{t('gitGhToken')}</label>
                <input
                  type="password"
                  aria-label={t('gitGhToken')}
                  placeholder="ghp_…"
                  onBlur={e => { if (e.target.value) void handleSaveToken(e.target.value); }}
                  className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:border-[var(--accent)] font-mono"
                />
                <p className="text-[10px] text-gray-400 mt-0.5">{t('gitTokenHelp')}</p>
              </div>
              <div>
                <label className="text-[10px] text-gray-400 mb-0.5 block">{t('gitDefaultBase')}</label>
                <input
                  type="text"
                  aria-label={t('gitDefaultBase')}
                  defaultValue={settings.gitDefaultBase ?? 'main'}
                  onBlur={e => updateSettings({ gitDefaultBase: e.target.value.trim() || 'main' })}
                  placeholder="main"
                  className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:border-[var(--accent)] font-mono"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.gitAutoCommit ?? false}
                  onChange={e => updateSettings({ gitAutoCommit: e.target.checked })}
                  className="accent-[var(--accent)] w-3.5 h-3.5"
                />
                <span className="text-xs text-gray-600 dark:text-gray-300">{t('gitAutoCommit')}</span>
              </label>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}

/** Small status badge shown in the titlebar. */
export function GitBadge({ onClick }: { onClick: () => void }) {
  const { settings } = useStore();
  const [dirty, setDirty] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const syncDir = settings.syncDirectory || undefined;

  useEffect(() => {
    if (!settings.gitEnabled || !window.electronAPI?.gitStatus) return;
    const poll = async () => {
      const res = await window.electronAPI.gitStatus(syncDir);
      if (res.success && res.data) {
        setInitialized(res.data.initialized);
        setDirty(res.data.dirty);
      }
    };
    void poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [settings.gitEnabled, syncDir]);

  if (!settings.gitEnabled) return null;

  return (
    <Tooltip label="Git">
      <button
        type="button"
        onClick={onClick}
        aria-label="Git"
        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-[var(--accent)] transition-colors flex items-center gap-1"
      >
        <GitBranch size={16} />
        {initialized && (
          <span className={`w-1.5 h-1.5 rounded-full ${dirty ? 'bg-amber-400' : 'bg-emerald-400'}`} />
        )}
      </button>
    </Tooltip>
  );
}
