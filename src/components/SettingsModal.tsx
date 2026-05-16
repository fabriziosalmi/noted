import { X } from 'lucide-react';
import type { LLMProvider } from '../store/useStore';

interface Settings {
  llmProvider: LLMProvider;
  llmApiKey: string;
  lmStudioUrl: string;
  syncDirectory: string | null;
}

interface SettingsModalProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onSelectFolder: () => void;
  onClose: () => void;
}

export function SettingsModal({ settings, onUpdate, onSelectFolder, onClose }: SettingsModalProps) {
  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[500px] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h2 className="font-semibold text-gray-800">Impostazioni</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Chiudi impostazioni">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <label htmlFor="llm-provider" className="block text-sm font-medium text-gray-700 mb-1">Provider LLM</label>
            <select
              id="llm-provider"
              className="w-full border border-gray-300 rounded-md p-2 text-sm focus:border-blue-500 focus:outline-none"
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

          {settings.llmProvider === 'lmstudio' && (
            <div>
              <label htmlFor="lmstudio-url" className="block text-sm font-medium text-gray-700 mb-1">LM Studio API URL</label>
              <input
                id="lmstudio-url"
                type="text"
                value={settings.lmStudioUrl}
                onChange={(e) => onUpdate({ lmStudioUrl: e.target.value })}
                placeholder="http://localhost:1234/v1"
                className="w-full border border-gray-300 rounded-md p-2 text-sm focus:border-blue-500 focus:outline-none"
              />
              <p className="text-xs text-gray-400 mt-1">L'URL locale dove gira LM Studio.</p>
            </div>
          )}

          {['openai', 'anthropic', 'gemini', 'openrouter'].includes(settings.llmProvider) && (
            <div>
              <label htmlFor="api-key" className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
              <input
                id="api-key"
                type="password"
                value={settings.llmApiKey}
                onChange={(e) => onUpdate({ llmApiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full border border-gray-300 rounded-md p-2 text-sm focus:border-blue-500 focus:outline-none"
              />
              <p className="text-xs text-gray-400 mt-1">La tua chiave è cifrata con il keychain del sistema operativo.</p>
            </div>
          )}

          <div>
            <label htmlFor="sync-dir" className="block text-sm font-medium text-gray-700 mb-1">Directory Note</label>
            <div className="flex">
              <input
                id="sync-dir"
                type="text"
                disabled
                value={settings.syncDirectory || '~/Documents/Noted'}
                className="flex-1 border border-gray-300 rounded-l-md p-2 text-sm bg-gray-50 text-gray-500"
              />
              <button
                onClick={onSelectFolder}
                className="bg-gray-100 border border-l-0 border-gray-300 px-4 rounded-r-md text-sm text-gray-600 hover:bg-gray-200"
              >
                Cambia
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
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
