import { useState, useCallback, useEffect } from 'react';
import {
  X, RefreshCw, Cloud, HardDrive, FolderOpen, CheckCircle2,
  Bot, Palette, Type, GitBranch, FolderSync,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { LLMProvider } from '../store/useStore';
import { fetchAvailableModels } from '../lib/llm';
import { useI18n, type TranslationKey } from '../lib/i18n';

type SettingsTab = 'ai' | 'appearance' | 'editor' | 'sync' | 'git';

type CloudProvider = { id: string; name: string; basePath: string; notedPath: string; available: boolean };

interface Settings {
  llmProvider: LLMProvider;
  llmApiKey: string;
  llmModel: string;
  lmStudioUrl: string;
  syncDirectory: string | null;
  showToolbar: boolean;
  showAiBar: boolean;
  theme: 'auto' | 'light' | 'dark' | 'sepia';
  accentColor: string;
  focusMode: boolean;
  editorFont: 'system' | 'serif' | 'mono';
  editorFontSize: 'sm' | 'md' | 'lg' | 'xl';
  typewriterMode: boolean;
  language?: 'en' | 'it' | 'es' | 'pt' | 'fr' | 'de';
  piiMasking?: boolean;
  showHints?: boolean;
  gitEnabled?: boolean;
  gitRemote?: string;
  gitAutoCommit?: boolean;
  gitDefaultBase?: string;
  gitGhToken?: string;
}

interface SettingsModalProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onSelectFolder: () => void;
  onImportVault?: () => void;
  onClose: () => void;
}

const TABS: Array<{ id: SettingsTab; labelKey: TranslationKey; icon: LucideIcon }> = [
  { id: 'ai',         labelKey: 'tabAi',         icon: Bot },
  { id: 'appearance', labelKey: 'tabAppearance',  icon: Palette },
  { id: 'editor',     labelKey: 'tabEditor',      icon: Type },
  { id: 'sync',       labelKey: 'tabSync',        icon: FolderSync },
  { id: 'git',        labelKey: 'tabGit',         icon: GitBranch },
];

const isLocalProvider = (p: LLMProvider) => p === 'lmstudio' || p === 'ollama';

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={onChange}
      className={`shrink-0 relative inline-flex h-5 w-9 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none ${value ? 'bg-[var(--accent)]' : 'bg-gray-200 dark:bg-gray-600'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  );
}

function SegRow({ icon: Icon, label, description, value, onChange }: {
  icon?: LucideIcon; label: string; description?: string; value: boolean; onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex items-start gap-2 min-w-0">
        {Icon && <Icon size={13} className="mt-0.5 shrink-0 text-gray-400" />}
        <div className="min-w-0">
          <p className="text-sm text-gray-700 dark:text-gray-200 leading-tight">{label}</p>
          {description && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 leading-snug">{description}</p>}
        </div>
      </div>
      <Toggle value={value} onChange={onChange} />
    </div>
  );
}

function Seg3({ label, options, value, onChange }: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <div className="flex gap-1.5">
        {options.map(o => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`flex-1 py-1.5 rounded-md text-xs border transition-colors ${
              value === o.value
                ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)] font-medium'
                : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{children}</p>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full border border-gray-200 dark:border-gray-600 rounded-md px-2.5 py-1.5 text-sm focus:border-[var(--accent)] focus:outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 ${props.className ?? ''}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full border border-gray-200 dark:border-gray-600 rounded-md px-2.5 py-1.5 text-sm focus:border-[var(--accent)] focus:outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 ${props.className ?? ''}`}
    />
  );
}

export function SettingsModal({ settings, onUpdate, onSelectFolder, onImportVault, onClose }: SettingsModalProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<SettingsTab>('ai');
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [cloudProviders, setCloudProviders] = useState<CloudProvider[]>([]);
  const [activating, setActivating] = useState<string | null>(null);
  const [gitTokenInput, setGitTokenInput] = useState('');
  const [savingToken, setSavingToken] = useState(false);

  const discoverModels = useCallback(async () => {
    setDiscovering(true);
    const models = await fetchAvailableModels(settings.llmProvider, settings.lmStudioUrl);
    setDiscoveredModels(models);
    if (models.length === 1) onUpdate({ llmModel: models[0] });
    setDiscovering(false);
  }, [settings.llmProvider, settings.lmStudioUrl, onUpdate]);

  useEffect(() => {
    if (isLocalProvider(settings.llmProvider)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void discoverModels();
    } else {
      setDiscoveredModels([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.llmProvider, settings.lmStudioUrl]);

  useEffect(() => {
    if (!window.electronAPI?.detectCloudProviders) return;
    window.electronAPI.detectCloudProviders().then(res => {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (res.success && res.data) setCloudProviders(res.data);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleActivateProvider = useCallback(async (notedPath: string) => {
    setActivating(notedPath);
    const res = await window.electronAPI.activateCloudProvider(notedPath);
    if (res.success && res.data) onUpdate({ syncDirectory: res.data });
    setActivating(null);
  }, [onUpdate]);

  const handleSaveToken = useCallback(async () => {
    if (!gitTokenInput.trim() || !window.electronAPI?.gitStoreToken) return;
    setSavingToken(true);
    await window.electronAPI.gitStoreToken(gitTokenInput.trim());
    setGitTokenInput('');
    setSavingToken(false);
  }, [gitTokenInput]);

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[520px] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
          <h2 className="font-semibold text-gray-800 dark:text-gray-200 text-sm">{t('settingsTitle')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label={t('closeSettings')}>
            <X size={16} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          {TABS.map(({ id, labelKey, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors border-b-2 ${
                tab === id
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
              }`}
            >
              <Icon size={15} />
              {t(labelKey)}
            </button>
          ))}
        </div>

        {/* Tab content — fixed height, no scroll */}
        <div className="p-5 overflow-y-auto" style={{ minHeight: 320, maxHeight: 420 }}>

          {/* ── AI Tab ── */}
          {tab === 'ai' && (
            <div className="space-y-4">
              <div>
                <FieldLabel>{t('llmProvider')}</FieldLabel>
                <Select value={settings.llmProvider} onChange={(e) => onUpdate({ llmProvider: e.target.value as LLMProvider })}>
                  <option value="openai">OpenAI (GPT-4o)</option>
                  <option value="anthropic">Anthropic (Claude 3)</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="lmstudio">LM Studio (Local)</option>
                  <option value="ollama">Ollama (Local)</option>
                </Select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <FieldLabel>{t('model')}</FieldLabel>
                  {isLocalProvider(settings.llmProvider) && (
                    <button onClick={discoverModels} disabled={discovering}
                      className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:opacity-80 disabled:opacity-50 mb-1">
                      <RefreshCw size={10} className={discovering ? 'animate-spin' : ''} />
                      {discovering ? t('detectingModels') : t('detectModels')}
                    </button>
                  )}
                </div>
                {isLocalProvider(settings.llmProvider) && discoveredModels.length > 0 ? (
                  <Select value={settings.llmModel} onChange={e => onUpdate({ llmModel: e.target.value })}>
                    {discoveredModels.map(m => <option key={m} value={m}>{m}</option>)}
                  </Select>
                ) : (
                  <Input type="text" value={settings.llmModel} onChange={(e) => onUpdate({ llmModel: e.target.value })}
                    placeholder={
                      settings.llmProvider === 'openai' ? 'gpt-4o' :
                      settings.llmProvider === 'anthropic' ? 'claude-3-5-sonnet-20241022' :
                      settings.llmProvider === 'gemini' ? 'gemini-1.5-pro' :
                      settings.llmProvider === 'openrouter' ? 'anthropic/claude-3.5-sonnet' :
                      settings.llmProvider === 'ollama' ? 'llama3' : 'auto-detect'
                    }
                  />
                )}
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                  {isLocalProvider(settings.llmProvider)
                    ? discoveredModels.length === 0 ? t('noModelsHelp') : `${discoveredModels.length} ${t(discoveredModels.length === 1 ? 'modelsFound_one' : 'modelsFound_other')}`
                    : settings.llmProvider === 'openrouter' ? t('openrouterExample') : t('defaultModelHelp')}
                </p>
              </div>

              {settings.llmProvider === 'lmstudio' && (
                <div>
                  <FieldLabel>{t('lmStudioUrl')}</FieldLabel>
                  <Input type="text" value={settings.lmStudioUrl} onChange={(e) => onUpdate({ lmStudioUrl: e.target.value })} placeholder="http://localhost:1234/v1" />
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{t('lmStudioHelp')}</p>
                </div>
              )}

              {['openai', 'anthropic', 'gemini', 'openrouter'].includes(settings.llmProvider) && (
                <div>
                  <FieldLabel>{t('apiKey')}</FieldLabel>
                  <Input type="password" value={settings.llmApiKey} onChange={(e) => onUpdate({ llmApiKey: e.target.value })} placeholder="sk-..." />
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{t('apiKeyHelp')}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Appearance Tab ── */}
          {tab === 'appearance' && (
            <div className="space-y-5">
              <Seg3
                label={t('theme')}
                options={[
                  { value: 'auto',  label: t('themeAuto') },
                  { value: 'light', label: t('themeLight') },
                  { value: 'dark',  label: t('themeDark') },
                  { value: 'sepia', label: t('themeSepia') },
                ]}
                value={settings.theme}
                onChange={v => onUpdate({ theme: v as Settings['theme'] })}
              />

              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('accentColor')}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {['#6366f1', '#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#5ac8fa', '#636366'].map(color => (
                    <button key={color} onClick={() => onUpdate({ accentColor: color })} title={color}
                      style={{ background: color }}
                      className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${(settings.accentColor ?? '#6366f1') === color ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''}`}
                    />
                  ))}
                  <input type="color" aria-label={t('customColor')} title={t('customColor')}
                    value={settings.accentColor ?? '#6366f1'}
                    onChange={e => onUpdate({ accentColor: e.target.value })}
                    className="w-6 h-6 rounded-full cursor-pointer border-0 p-0"
                  />
                </div>
              </div>

              <div>
                <FieldLabel>{t('language')}</FieldLabel>
                <Select value={settings.language ?? 'en'} onChange={e => onUpdate({ language: e.target.value as Settings['language'] })}>
                  <option value="en">English</option>
                  <option value="it">Italiano</option>
                  <option value="es">Español</option>
                  <option value="pt">Português</option>
                  <option value="fr">Français</option>
                  <option value="de">Deutsch</option>
                </Select>
              </div>
            </div>
          )}

          {/* ── Editor Tab ── */}
          {tab === 'editor' && (
            <div className="space-y-4">
              <Seg3
                label={t('editorFont')}
                options={[
                  { value: 'system', label: t('fontSystem') },
                  { value: 'serif',  label: t('fontSerif') },
                  { value: 'mono',   label: t('fontMono') },
                ]}
                value={settings.editorFont ?? 'system'}
                onChange={v => onUpdate({ editorFont: v as Settings['editorFont'] })}
              />

              <Seg3
                label={t('fontSize')}
                options={[
                  { value: 'sm', label: t('fontSmall') },
                  { value: 'md', label: t('fontNormal') },
                  { value: 'lg', label: t('fontLarge') },
                  { value: 'xl', label: t('fontXl') },
                ]}
                value={settings.editorFontSize ?? 'md'}
                onChange={v => onUpdate({ editorFontSize: v as Settings['editorFontSize'] })}
              />

              <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                <SegRow label={t('showToolbar')} value={!!settings.showToolbar} onChange={() => onUpdate({ showToolbar: !settings.showToolbar })} />
                <SegRow label={t('showAiBar')} value={!!settings.showAiBar} onChange={() => onUpdate({ showAiBar: !settings.showAiBar })} />
                <SegRow label={t('typewriterMode')} value={!!settings.typewriterMode} onChange={() => onUpdate({ typewriterMode: !settings.typewriterMode })} />
                <SegRow label={t('piiMasking')} description={t('piiMaskingDesc')} value={!!settings.piiMasking} onChange={() => onUpdate({ piiMasking: !settings.piiMasking })} />
                <SegRow label={t('showHints')} description={t('showHintsDesc')} value={settings.showHints !== false} onChange={() => onUpdate({ showHints: settings.showHints === false })} />
              </div>
            </div>
          )}

          {/* ── Sync Tab ── */}
          {tab === 'sync' && (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-gray-700 dark:text-gray-200 mb-0.5">{t('cloudSync')}</p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">{t('cloudSyncDesc')}</p>

                <div className="grid grid-cols-2 gap-2">
                  {cloudProviders.map(p => {
                    const isActive = !!settings.syncDirectory && settings.syncDirectory === p.notedPath;
                    const isLoading = activating === p.notedPath;
                    return (
                      <button key={p.id}
                        onClick={() => p.available && !isActive && handleActivateProvider(p.notedPath)}
                        disabled={!p.available || isLoading}
                        className={`relative flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left transition-all ${
                          isActive
                            ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                            : p.available
                              ? 'border-gray-200 dark:border-gray-700 hover:border-[var(--accent-mid)] hover:bg-gray-50 dark:hover:bg-gray-800'
                              : 'border-gray-200 dark:border-gray-700 opacity-40 cursor-not-allowed'
                        }`}
                      >
                        {isActive && <CheckCircle2 size={11} className="absolute top-2 right-2 text-[var(--accent)]" />}
                        <div className="flex items-center gap-1.5">
                          <Cloud size={12} className={isActive ? 'text-[var(--accent)]' : 'text-gray-400'} />
                          <span className={`text-xs font-medium ${isActive ? 'text-[var(--accent)]' : 'text-gray-700 dark:text-gray-300'}`}>{p.name}</span>
                        </div>
                        <span className="text-[10px] text-gray-400 leading-tight">
                          {isActive ? t('cloudActive') : p.available ? t('cloudActivate') : t('cloudNotInstalled')}
                        </span>
                      </button>
                    );
                  })}

                  {(() => {
                    const isLocal = !settings.syncDirectory;
                    return (
                      <button onClick={() => !isLocal && onUpdate({ syncDirectory: null })}
                        className={`flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left transition-all ${
                          isLocal ? 'border-[var(--accent)] bg-[var(--accent-light)]' : 'border-gray-200 dark:border-gray-700 hover:border-[var(--accent-mid)] hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <HardDrive size={12} className={isLocal ? 'text-[var(--accent)]' : 'text-gray-400'} />
                          <span className={`text-xs font-medium ${isLocal ? 'text-[var(--accent)]' : 'text-gray-700 dark:text-gray-300'}`}>{t('cloudLocalOnly')}</span>
                        </div>
                        <span className="text-[10px] text-gray-400">{isLocal ? t('cloudActive') : '~/Documents/Noted'}</span>
                      </button>
                    );
                  })()}

                  <button onClick={onSelectFolder}
                    className="flex flex-col items-start gap-1 p-2.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-left hover:border-[var(--accent-mid)] hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
                  >
                    <div className="flex items-center gap-1.5">
                      <FolderOpen size={12} className="text-gray-400" />
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{t('cloudCustomFolder')}</span>
                    </div>
                    <span className="text-[10px] text-gray-400">{t('change')}…</span>
                  </button>
                </div>
              </div>

              <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                <span className="font-medium">{t('cloudCurrentPath')}:</span>{' '}
                {settings.syncDirectory ?? '~/Documents/Noted'}
              </p>

              {onImportVault && (
                <button onClick={onImportVault}
                  className="w-full py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  {t('importVault')}
                </button>
              )}
            </div>
          )}

          {/* ── Git Tab ── */}
          {tab === 'git' && (
            <div className="space-y-4">
              <SegRow
                label={t('gitEnable')}
                description={t('gitEnableDesc')}
                value={!!settings.gitEnabled}
                onChange={() => onUpdate({ gitEnabled: !settings.gitEnabled })}
              />

              {settings.gitEnabled && (
                <>
                  <div className="pt-1 space-y-3 border-t border-gray-100 dark:border-gray-700">
                    <div>
                      <FieldLabel>{t('gitRemote')}</FieldLabel>
                      <Input
                        type="text"
                        value={settings.gitRemote ?? ''}
                        onChange={e => onUpdate({ gitRemote: e.target.value })}
                        placeholder="https://github.com/user/notes.git"
                      />
                    </div>

                    <div>
                      <FieldLabel>{t('gitGhToken')}</FieldLabel>
                      <div className="flex gap-2">
                        <Input
                          type="password"
                          value={gitTokenInput}
                          onChange={e => setGitTokenInput(e.target.value)}
                          placeholder="ghp_..."
                          className="flex-1"
                        />
                        <button
                          onClick={handleSaveToken}
                          disabled={!gitTokenInput.trim() || savingToken}
                          className="px-3 py-1.5 text-xs rounded-md bg-[var(--accent)] text-white disabled:opacity-50 hover:opacity-90 transition-opacity shrink-0"
                        >
                          {savingToken ? '…' : t('save')}
                        </button>
                      </div>
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{t('gitTokenHelp')}</p>
                    </div>

                    <div>
                      <FieldLabel>{t('gitDefaultBase')}</FieldLabel>
                      <Input
                        type="text"
                        value={settings.gitDefaultBase ?? 'main'}
                        onChange={e => onUpdate({ gitDefaultBase: e.target.value })}
                        placeholder="main"
                      />
                    </div>

                    <SegRow
                      label={t('gitAutoCommit')}
                      value={!!settings.gitAutoCommit}
                      onChange={() => onUpdate({ gitAutoCommit: !settings.gitAutoCommit })}
                    />
                  </div>
                </>
              )}

              {!settings.gitEnabled && (
                <div className="mt-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
                    Git integration lets you version-control your notes, create branches, push to GitHub, open PRs, and save notes as public or private Gists — all from inside Noted.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="text-white px-4 py-1.5 rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
            style={{ background: 'var(--accent)' } as React.CSSProperties}
          >
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
