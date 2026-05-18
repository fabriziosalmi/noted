import { useState, useCallback, useEffect } from 'react';
import { X, RefreshCw, Cloud, HardDrive, FolderOpen, CheckCircle2 } from 'lucide-react';
import type { LLMProvider } from '../store/useStore';
import { fetchAvailableModels } from '../lib/llm';
import { useI18n } from '../lib/i18n';

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
}

interface SettingsModalProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onSelectFolder: () => void;
  onImportVault?: () => void;
  onClose: () => void;
}

const isLocalProvider = (p: LLMProvider) => p === 'lmstudio' || p === 'ollama';

export function SettingsModal({ settings, onUpdate, onSelectFolder, onImportVault, onClose }: SettingsModalProps) {
  const { t } = useI18n();
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [cloudProviders, setCloudProviders] = useState<CloudProvider[]>([]);
  const [activating, setActivating] = useState<string | null>(null);

  const discoverModels = useCallback(async () => {
    setDiscovering(true);
    const models = await fetchAvailableModels(settings.llmProvider, settings.lmStudioUrl);
    setDiscoveredModels(models);
    if (models.length === 1) onUpdate({ llmModel: models[0] });
    setDiscovering(false);
  }, [settings.llmProvider, settings.lmStudioUrl, onUpdate]);

  // Auto-discover when opening for local providers
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

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[500px] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800">
          <h2 className="font-semibold text-gray-800 dark:text-gray-200">{t('settingsTitle')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label={t('closeSettings')}>
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto max-h-[80vh]">
          <div>
            <label htmlFor="llm-provider" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('llmProvider')}</label>
            <select
              id="llm-provider"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm focus:border-[var(--accent)] focus:outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              value={settings.llmProvider}
              onChange={(e) => onUpdate({ llmProvider: e.target.value as LLMProvider })}
            >
              <option value="openai">OpenAI (GPT-4o)</option>
              <option value="anthropic">Anthropic (Claude 3)</option>
              <option value="gemini">Google Gemini</option>
              <option value="openrouter">OpenRouter</option>
              <option value="lmstudio">LM Studio (Local)</option>
              <option value="ollama">Ollama (Local)</option>
            </select>
          </div>

          {/* Model — dropdown if local models discovered, text input otherwise */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="llm-model" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('model')}</label>
              {isLocalProvider(settings.llmProvider) && (
                <button
                  onClick={discoverModels}
                  disabled={discovering}
                  className="flex items-center gap-1 text-xs text-[var(--accent)] hover:opacity-80 disabled:opacity-50"
                >
                  <RefreshCw size={11} className={discovering ? 'animate-spin' : ''} />
                  {discovering ? t('detectingModels') : t('detectModels')}
                </button>
              )}
            </div>

            {isLocalProvider(settings.llmProvider) && discoveredModels.length > 0 ? (
              <select
                id="llm-model"
                value={settings.llmModel}
                onChange={e => onUpdate({ llmModel: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm focus:border-[var(--accent)] focus:outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              >
                {discoveredModels.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                id="llm-model"
                type="text"
                value={settings.llmModel}
                onChange={(e) => onUpdate({ llmModel: e.target.value })}
                placeholder={
                  settings.llmProvider === 'openai' ? 'gpt-4o' :
                  settings.llmProvider === 'anthropic' ? 'claude-3-5-sonnet-20241022' :
                  settings.llmProvider === 'gemini' ? 'gemini-1.5-pro' :
                  settings.llmProvider === 'openrouter' ? 'anthropic/claude-3.5-sonnet' :
                  settings.llmProvider === 'ollama' ? 'llama3' : 'auto-detect'
                }
                className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm focus:border-[var(--accent)] focus:outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              />
            )}
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              {isLocalProvider(settings.llmProvider)
                ? discoveredModels.length === 0
                  ? t('noModelsHelp')
                  : `${discoveredModels.length} ${t(discoveredModels.length === 1 ? 'modelsFound_one' : 'modelsFound_other')}`
                : settings.llmProvider === 'openrouter'
                  ? t('openrouterExample')
                  : t('defaultModelHelp')}
            </p>
          </div>

          {settings.llmProvider === 'lmstudio' && (
            <div>
              <label htmlFor="lmstudio-url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('lmStudioUrl')}</label>
              <input
                id="lmstudio-url"
                type="text"
                value={settings.lmStudioUrl}
                onChange={(e) => onUpdate({ lmStudioUrl: e.target.value })}
                placeholder="http://localhost:1234/v1"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm focus:border-[var(--accent)] focus:outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('lmStudioHelp')}</p>
            </div>
          )}

          {['openai', 'anthropic', 'gemini', 'openrouter'].includes(settings.llmProvider) && (
            <div>
              <label htmlFor="api-key" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('apiKey')}</label>
              <input
                id="api-key"
                type="password"
                value={settings.llmApiKey}
                onChange={(e) => onUpdate({ llmApiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm focus:border-[var(--accent)] focus:outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('apiKeyHelp')}</p>
            </div>
          )}

          {/* Theme selector */}
          <div>
            <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('theme')}</p>
            <div className="flex gap-2">
              {([
                { value: 'auto',  labelKey: 'themeAuto' },
                { value: 'light', labelKey: 'themeLight' },
                { value: 'dark',  labelKey: 'themeDark' },
                { value: 'sepia', labelKey: 'themeSepia' },
              ] as const).map(({ value, labelKey }) => (
                <button
                  key={value}
                  onClick={() => onUpdate({ theme: value })}
                  className={`flex-1 py-1.5 rounded-md text-sm border transition-colors ${
                    settings.theme === value
                      ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]'
                      : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Accent color */}
          <div>
            <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('accentColor')}</p>
            <div className="flex items-center gap-3 flex-wrap">
              {['#6366f1', '#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#5ac8fa', '#636366'].map(color => (
                <button
                  key={color}
                  onClick={() => onUpdate({ accentColor: color })}
                  title={color}
                  style={{ background: color }}
                  className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${
                    (settings.accentColor ?? '#6366f1') === color ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''
                  }`}
                />
              ))}
              <input
                type="color"
                aria-label={t('customColor')}
                title={t('customColor')}
                value={settings.accentColor ?? '#6366f1'}
                onChange={e => onUpdate({ accentColor: e.target.value })}
                className="w-7 h-7 rounded-full cursor-pointer border-0 p-0"
              />
            </div>
          </div>

          {/* Language selector */}
          <div>
            <label htmlFor="lang-select" className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">{t('language')}</label>
            <select
              id="lang-select"
              value={settings.language ?? 'en'}
              onChange={e => onUpdate({ language: e.target.value as 'en' | 'it' | 'es' | 'pt' | 'fr' | 'de' })}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm focus:border-[var(--accent)] focus:outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
            >
              <option value="en">English</option>
              <option value="it">Italiano</option>
              <option value="es">Español</option>
              <option value="pt">Português</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
            </select>
          </div>

          {/* PII Masking */}
          <div className="flex items-start justify-between gap-4 py-1">
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('piiMasking')}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t('piiMaskingDesc')}</p>
            </div>
            <button
              role="switch"
              aria-checked={!!settings.piiMasking}
              onClick={() => onUpdate({ piiMasking: !settings.piiMasking })}
              className={`shrink-0 relative inline-flex h-5 w-9 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none mt-0.5 ${settings.piiMasking ? 'bg-[var(--accent)]' : 'bg-gray-200 dark:bg-gray-600'}`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${settings.piiMasking ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Editor appearance toggles */}
          <div>
            <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('editorSection')}</p>
            <div className="space-y-2">
              {([
                { key: 'showToolbar',    labelKey: 'showToolbar' },
                { key: 'showAiBar',      labelKey: 'showAiBar' },
                { key: 'typewriterMode', labelKey: 'typewriterMode' },
              ] as const).map(({ key, labelKey }) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer select-none">
                  <div
                    role="checkbox"
                    aria-checked={!!settings[key]}
                    tabIndex={0}
                    onClick={() => onUpdate({ [key]: !settings[key] })}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onUpdate({ [key]: !settings[key] })}
                    className={`w-9 h-5 rounded-full transition-colors flex items-center ${settings[key] ? 'bg-[var(--accent)]' : 'bg-gray-300 dark:bg-gray-600'}`}
                  >
                    <span className={`w-4 h-4 bg-white rounded-full shadow transition-transform mx-0.5 ${settings[key] ? 'translate-x-4' : 'translate-x-0'}`} />
                  </div>
                  <span className="text-sm text-gray-600 dark:text-gray-300">{t(labelKey)}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Font family */}
          <div>
            <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('editorFont')}</p>
            <div className="flex gap-2">
              {([
                { value: 'system', labelKey: 'fontSystem' },
                { value: 'serif',  labelKey: 'fontSerif' },
                { value: 'mono',   labelKey: 'fontMono' },
              ] as const).map(({ value, labelKey }) => (
                <button
                  key={value}
                  onClick={() => onUpdate({ editorFont: value })}
                  className={`flex-1 py-1.5 rounded-md text-sm border transition-colors ${
                    (settings.editorFont ?? 'system') === value
                      ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]'
                      : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Font size */}
          <div>
            <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('fontSize')}</p>
            <div className="flex gap-2">
              {([
                { value: 'sm', labelKey: 'fontSmall' },
                { value: 'md', labelKey: 'fontNormal' },
                { value: 'lg', labelKey: 'fontLarge' },
                { value: 'xl', labelKey: 'fontXl' },
              ] as const).map(({ value, ...rest }) => (
                <button
                  key={value}
                  onClick={() => onUpdate({ editorFontSize: value })}
                  className={`flex-1 py-1.5 rounded-md text-sm border transition-colors ${
                    (settings.editorFontSize ?? 'md') === value
                      ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]'
                      : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  {t(rest.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* ── Cloud Storage & Sync ── */}
          <div>
            <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-0.5">{t('cloudSync')}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{t('cloudSyncDesc')}</p>

            <div className="grid grid-cols-2 gap-2 mb-3">
              {cloudProviders.map(p => {
                const isActive = !!settings.syncDirectory && settings.syncDirectory === p.notedPath;
                const isLoading = activating === p.notedPath;
                return (
                  <button
                    key={p.id}
                    onClick={() => p.available && !isActive && handleActivateProvider(p.notedPath)}
                    disabled={!p.available || isLoading}
                    className={`relative flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all ${
                      isActive
                        ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                        : p.available
                          ? 'border-gray-200 dark:border-gray-700 hover:border-[var(--accent-mid)] hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer'
                          : 'border-gray-200 dark:border-gray-700 opacity-40 cursor-not-allowed'
                    }`}
                  >
                    {isActive && (
                      <CheckCircle2 size={12} className="absolute top-2 right-2 text-[var(--accent)]" />
                    )}
                    <div className="flex items-center gap-1.5">
                      <Cloud size={13} className={isActive ? 'text-[var(--accent)]' : 'text-gray-400'} />
                      <span className={`text-sm font-medium ${isActive ? 'text-[var(--accent)]' : 'text-gray-700 dark:text-gray-300'}`}>{p.name}</span>
                    </div>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">
                      {isActive ? t('cloudActive') : p.available ? t('cloudActivate') : t('cloudNotInstalled')}
                    </span>
                  </button>
                );
              })}

              {/* Local only */}
              {(() => {
                const isLocal = !settings.syncDirectory;
                return (
                  <button
                    onClick={() => !isLocal && onUpdate({ syncDirectory: null })}
                    className={`flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all ${
                      isLocal
                        ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                        : 'border-gray-200 dark:border-gray-700 hover:border-[var(--accent-mid)] hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    {isLocal && <CheckCircle2 size={12} className="absolute" style={{ display: 'none' }} />}
                    <div className="flex items-center gap-1.5">
                      <HardDrive size={13} className={isLocal ? 'text-[var(--accent)]' : 'text-gray-400'} />
                      <span className={`text-sm font-medium ${isLocal ? 'text-[var(--accent)]' : 'text-gray-700 dark:text-gray-300'}`}>{t('cloudLocalOnly')}</span>
                    </div>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">{isLocal ? t('cloudActive') : '~/Documents/Noted'}</span>
                  </button>
                );
              })()}

              {/* Custom folder */}
              <button
                onClick={onSelectFolder}
                className="flex flex-col items-start gap-1 p-3 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-left hover:border-[var(--accent-mid)] hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
              >
                <div className="flex items-center gap-1.5">
                  <FolderOpen size={13} className="text-gray-400" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('cloudCustomFolder')}</span>
                </div>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">{t('change')}…</span>
              </button>
            </div>

            {/* Current path */}
            <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
              <span className="font-medium">{t('cloudCurrentPath')}:</span>{' '}
              {settings.syncDirectory ?? '~/Documents/Noted'}
            </p>

            {onImportVault && (
              <button
                onClick={onImportVault}
                className="mt-2 w-full py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                {t('importVault')}
              </button>
            )}
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="text-white px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
            style={{ background: 'var(--accent)' } as React.CSSProperties}
          >
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
