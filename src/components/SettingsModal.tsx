import { useState, useCallback, useEffect } from 'react';
import { X, RefreshCw } from 'lucide-react';
import type { LLMProvider } from '../store/useStore';
import { fetchAvailableModels } from '../lib/llm';
import { useI18n } from '../lib/i18n';

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
  language?: 'en' | 'it';
}

interface SettingsModalProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onSelectFolder: () => void;
  onImportVault?: () => void;
  onUseICloud?: () => void;
  onClose: () => void;
}

const isLocalProvider = (p: LLMProvider) => p === 'lmstudio' || p === 'ollama';

export function SettingsModal({ settings, onUpdate, onSelectFolder, onImportVault, onUseICloud, onClose }: SettingsModalProps) {
  const { t } = useI18n();
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);

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
      void discoverModels();
    } else {
      setDiscoveredModels([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.llmProvider, settings.lmStudioUrl]);

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
              className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm focus:border-blue-500 focus:outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
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
                  className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
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
                className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm focus:border-blue-500 focus:outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
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
                className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm focus:border-blue-500 focus:outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
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
                className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm focus:border-blue-500 focus:outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
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
                className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm focus:border-blue-500 focus:outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
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
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
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
              <label title={t('customColor')} className="flex items-center cursor-pointer">
                <input
                  type="color"
                  value={settings.accentColor ?? '#6366f1'}
                  onChange={e => onUpdate({ accentColor: e.target.value })}
                  className="w-7 h-7 rounded-full cursor-pointer border-0 p-0"
                />
              </label>
            </div>
          </div>

          {/* Language selector */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">{t('language')}</label>
            <div className="flex gap-2">
              {(['en', 'it'] as const).map(lang => (
                <button
                  key={lang}
                  onClick={() => onUpdate({ language: lang })}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    (settings.language ?? 'en') === lang
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-[var(--accent)]'
                  }`}
                >
                  {lang === 'en' ? '🇬🇧 English' : '🇮🇹 Italiano'}
                </button>
              ))}
            </div>
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
                    className={`w-9 h-5 rounded-full transition-colors flex items-center ${settings[key] ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
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
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
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
                { value: 'xl', label: 'XL' },
              ] as const).map(({ value, ...rest }) => (
                <button
                  key={value}
                  onClick={() => onUpdate({ editorFontSize: value })}
                  className={`flex-1 py-1.5 rounded-md text-sm border transition-colors ${
                    (settings.editorFontSize ?? 'md') === value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  {'labelKey' in rest ? t(rest.labelKey) : rest.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="sync-dir" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('notesDirectory')}</label>
            <div className="flex">
              <input
                id="sync-dir"
                type="text"
                disabled
                value={settings.syncDirectory || t('directoryDefault')}
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-l-md p-2 text-sm bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
              />
              <button
                onClick={onSelectFolder}
                className="bg-gray-100 dark:bg-gray-700 border border-l-0 border-gray-300 dark:border-gray-600 px-4 rounded-r-md text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                {t('change')}
              </button>
            </div>
            <div className="flex gap-2 mt-2">
              {onUseICloud && (
                <button
                  onClick={onUseICloud}
                  className="flex-1 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  {t('useICloud')}
                </button>
              )}
              {onImportVault && (
                <button
                  onClick={onImportVault}
                  className="flex-1 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  {t('importVault')}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
          >
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
