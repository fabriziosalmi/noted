import { useState, useEffect, useCallback } from 'react';
import { GitBranch, GitCommit, Upload, GitPullRequest, RefreshCw, X, Check, AlertCircle, Loader2, ExternalLink } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useI18n } from '../lib/i18n';

interface GitPanelProps {
  activeNoteName: string | null;
  onClose: () => void;
}

type Phase = 'idle' | 'committing' | 'pushing' | 'creating-pr';

export function GitPanel({ activeNoteName, onClose }: GitPanelProps) {
  const { t } = useI18n();
  const { settings, updateSettings } = useStore();
  const syncDir = settings.syncDirectory || undefined;

  const [status, setStatus] = useState<GitStatusData | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Commit form
  const [commitMsg, setCommitMsg] = useState('');

  // PR form
  const [showPrForm, setShowPrForm] = useState(false);
  const [prTitle, setPrTitle] = useState('');
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

  // Auto-populate PR title from note name
  useEffect(() => {
    if (activeNoteName) {
      setPrTitle(activeNoteName.replace(/\.md$/, '').replace(/[-_]/g, ' '));
    }
  }, [activeNoteName]);

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
    if (!window.electronAPI?.gitInit) return;
    setPhase('committing');
    const res = await window.electronAPI.gitInit(syncDir);
    setPhase('idle');
    if (res.success) { showSuccess(t('gitInitialized')); void refreshStatus(); }
    else showError(res.error ?? t('gitInitError'));
  };

  const handleCommitNote = async () => {
    if (!activeNoteName || !window.electronAPI?.gitCommitNote) return;
    setPhase('committing');
    const res = await window.electronAPI.gitCommitNote(activeNoteName, commitMsg.trim() || undefined, syncDir);
    setPhase('idle');
    if (res.success) {
      showSuccess(`${t('gitCommitted')} ${res.data?.hash ?? ''}`);
      setCommitMsg('');
      void refreshStatus();
    } else showError(res.error ?? t('gitCommitError'));
  };

  const handleCreatePr = async () => {
    if (!activeNoteName || !window.electronAPI) return;
    if (!settings.gitRemote) { showError(t('gitNoRemote')); return; }
    const tokenRes = await window.electronAPI.gitGetToken();
    const token = tokenRes.success ? (tokenRes.data ?? '') : '';
    if (!token) { showError(t('gitNoToken')); return; }
    if (!prTitle.trim()) { showError(t('gitPrTitleRequired')); return; }

    setPhase('committing');
    // 1. Prepare branch (commit + create note/slug branch)
    const branchRes = await window.electronAPI.gitPreparePrBranch(activeNoteName, commitMsg.trim() || undefined, syncDir);
    if (!branchRes.success || !branchRes.data) {
      setPhase('idle');
      showError(branchRes.error ?? t('gitBranchError'));
      return;
    }
    const { branch } = branchRes.data;

    // 2. Push branch
    setPhase('pushing');
    const pushRes = await window.electronAPI.gitPushBranch(branch, settings.gitRemote, syncDir);
    if (!pushRes.success) {
      setPhase('idle');
      showError(pushRes.error ?? t('gitPushError'));
      return;
    }

    // 3. Create PR
    setPhase('creating-pr');
    const prRes = await window.electronAPI.gitCreatePr({
      remoteUrl: settings.gitRemote,
      token,
      branch,
      base: settings.gitDefaultBase ?? 'main',
      title: prTitle.trim(),
      body: prBody.trim(),
    });
    setPhase('idle');
    if (prRes.success && prRes.data) {
      setPrUrl(prRes.data.url);
      showSuccess(t('gitPrCreated'));
      setShowPrForm(false);
    } else showError(prRes.error ?? t('gitPrError'));
  };

  const handleSaveToken = async (token: string) => {
    if (!window.electronAPI?.gitStoreToken) return;
    await window.electronAPI.gitStoreToken(token);
    updateSettings({ gitGhToken: '' }); // never persist in store
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const busy = phase !== 'idle';

  const phaseLabel: Record<Phase, string> = {
    idle: '',
    committing: t('gitCommitting'),
    pushing: t('gitPushing'),
    'creating-pr': t('gitCreatingPr'),
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-end z-50 pt-12 pr-2" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-80 flex flex-col overflow-hidden border border-gray-200/60 dark:border-gray-700/60"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
            <GitBranch size={14} className="text-[var(--accent)]" />
            {t('gitTitle')}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded">
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
              <button onClick={refreshStatus} disabled={loadingStatus} className="text-gray-400 hover:text-gray-600 p-0.5 rounded">
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
                  className="w-full text-xs bg-[var(--accent)] text-white py-1.5 rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity"
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
                    {status.modifiedFiles.slice(0, 5).map(f => (
                      <div key={f} className="truncate">M {f}</div>
                    ))}
                    {status.modifiedFiles.length > 5 && <div>+{status.modifiedFiles.length - 5} more</div>}
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
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs bg-[var(--accent)] text-white py-1.5 rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity"
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
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs bg-[var(--accent)] text-white py-1.5 rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity"
                    >
                      {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                      {busy ? phaseLabel[phase] : t('gitPublish')}
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
    <button
      onClick={onClick}
      className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-[var(--accent)] transition-colors flex items-center gap-1"
      title="Git"
    >
      <GitBranch size={16} />
      {initialized && (
        <span className={`w-1.5 h-1.5 rounded-full ${dirty ? 'bg-amber-400' : 'bg-emerald-400'}`} />
      )}
    </button>
  );
}
