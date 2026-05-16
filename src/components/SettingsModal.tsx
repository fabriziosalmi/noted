import { useState, useCallback, useEffect } from 'react';
import { X, RefreshCw } from 'lucide-react';
import type { LLMProvider } from '../store/useStore';
import { fetchAvailableModels } from '../lib/llm';

interface Settings {
  llmProvider: LLMProvider;
  llmApiKey: string;
  llmModel: string;
  lmStudioUrl: string;
  syncDirectory: string | null;
  showToolbar: boolean;
  showAiBar: boolean;
  theme: 'auto' | 'light' | 'dark';
}

interface SettingsModalProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onSelectFolder: () => void;
  onClose: () => void;
}

const isLocalProvider = (p: LLMProvider) => p === 'lmstudio' || p === 'ollama';

export function SettingsModal({ settings, onUpdate, onSelectFolder, onClose }: SettingsModalProps) {
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
          <h2 className="font-semibold text-gray-800 dark:text-gray-200">Impostazioni</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Chiudi impostazioni">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <label htmlFor="llm-provider" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Provider LLM</label>
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
              <label htmlFor="llm-model" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Modello</label>
              {isLocalProvider(settings.llmProvider) && (
                <button
                  onClick={discoverModels}
                  disabled={discovering}
                  className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
                >
                  <RefreshCw size={11} className={discovering ? 'animate-spin' : ''} />
                  {discovering ? 'Rilevamento...' : 'Rileva modelli'}
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
                  ? 'Avvia LM Studio / Ollama e clicca "Rileva modelli"'
                  : `${discoveredModels.length} modell${discoveredModels.length === 1 ? 'o trovato' : 'i trovati'}`
                : settings.llmProvider === 'openrouter'
                  ? 'Es. google/gemma-4-e2b, anthropic/claude-3.5-sonnet'
                  : 'Lascia vuoto per usare il modello predefinito'}
            </p>
          </div>

          {settings.llmProvider === 'lmstudio' && (
            <div>
              <label htmlFor="lmstudio-url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">LM Studio API URL</label>
              <input
                id="lmstudio-url"
                type="text"
                value={settings.lmStudioUrl}
                onChange={(e) => onUpdate({ lmStudioUrl: e.target.value })}
                placeholder="http://localhost:1234/v1"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm focus:border-blue-500 focus:outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">L'URL locale dove gira LM Studio.</p>
            </div>
          )}

          {['openai', 'anthropic', 'gemini', 'openrouter'].includes(settings.llmProvider) && (
            <div>
              <label htmlFor="api-key" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API Key</label>
              <input
                id="api-key"
                type="password"
                value={settings.llmApiKey}
                onChange={(e) => onUpdate({ llmApiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm focus:border-blue-500 focus:outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">La tua chiave è cifrata con il keychain del sistema operativo.</p>
            </div>
          )}

          {/* Theme selector */}
          <div>
            <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Tema</p>
            <div className="flex gap-2">
              {(['auto', 'light', 'dark'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => onUpdate({ theme: t })}
                  className={`flex-1 py-1.5 rounded-md text-sm border transition-colors capitalize ${
                    settings.theme === t
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  {t === 'auto' ? 'Automatico' : t === 'light' ? 'Chiaro' : 'Scuro'}
                </button>
              ))}
            </div>
          </div>

          {/* Editor appearance toggles */}
          <div>
            <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Editor</p>
            <div className="space-y-2">
              {([
                { key: 'showToolbar', label: 'Mostra barra formattazione (H1/H2, Grassetto, Corsivo…)' },
                { key: 'showAiBar',   label: 'Mostra barra AI (Continua, Espandi, Raffina…)' },
              ] as const).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer select-none">
                  <div
                    role="checkbox"
                    aria-checked={settings[key]}
                    tabIndex={0}
                    onClick={() => onUpdate({ [key]: !settings[key] })}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onUpdate({ [key]: !settings[key] })}
                    className={`w-9 h-5 rounded-full transition-colors flex items-center ${settings[key] ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                  >
                    <span className={`w-4 h-4 bg-white rounded-full shadow transition-transform mx-0.5 ${settings[key] ? 'translate-x-4' : 'translate-x-0'}`} />
                  </div>
                  <span className="text-sm text-gray-600 dark:text-gray-300">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="sync-dir" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Directory Note</label>
            <div className="flex">
              <input
                id="sync-dir"
                type="text"
                disabled
                value={settings.syncDirectory || '~/Documents/Noted'}
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-l-md p-2 text-sm bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
              />
              <button
                onClick={onSelectFolder}
                className="bg-gray-100 dark:bg-gray-700 border border-l-0 border-gray-300 dark:border-gray-600 px-4 rounded-r-md text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Cambia
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}
