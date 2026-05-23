import { useState, useCallback, useEffect, useReducer } from 'react';
import {
  X, RefreshCw, Cloud, HardDrive, FolderOpen, CheckCircle2,
  Bot, Palette, Type, GitBranch, FolderSync, Info, Copy, Check,
  Plug, ExternalLink, Globe,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useModalStack } from '../hooks/useModalStack';
import { useStore } from '../store/useStore';
import type { LLMProvider } from '../store/useStore';
import { fetchAvailableModels } from '../lib/llm';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { getElectronApi } from '../lib/electronApi';
import { importWorkflowReducer, initialImportWorkflowState, isImportWorkflowBusy } from '../lib/importWorkflow';

type SettingsTab = 'ai' | 'appearance' | 'editor' | 'sync' | 'mcp' | 'git' | 'import';

interface CloudProvider { id: string; name: string; basePath: string; notedPath: string; available: boolean }

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
  aiGhostMode?: 'off' | 'manual' | 'auto';
  editorWidth?: 'narrow' | 'normal' | 'wide' | 'full';
  editorBg?: string | null;
  gitEnabled?: boolean;
  gitRemote?: string;
  gitAutoCommit?: boolean;
  gitDefaultBase?: string;
  gitGhToken?: string;
  ragTopK?: number;
  ragMaxNotes?: number;
  ragContextChars?: number;
  ragDebug?: boolean;
  embeddingsEnabled?: boolean;
  embeddingProvider?: 'openai' | 'lmstudio' | 'ollama' | 'none';
  embeddingModel?: string;
  mcpSseEnabled?: boolean;
  mcpSsePort?: number;
  smartTagsEnabled?: boolean;
}

interface SettingsModalProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onSelectFolder: () => void;
  onImportVault?: () => void;
  onClose: () => void;
  onToast?: (text: string, variant?: 'success' | 'error') => void;
}

const TABS: { id: SettingsTab; labelKey: TranslationKey; icon: LucideIcon }[] = [
  { id: 'ai',         labelKey: 'tabAi',         icon: Bot },
  { id: 'appearance', labelKey: 'tabAppearance',  icon: Palette },
  { id: 'editor',     labelKey: 'tabEditor',      icon: Type },
  { id: 'sync',       labelKey: 'tabSync',        icon: FolderSync },
  { id: 'mcp',        labelKey: 'tabMcp',         icon: Plug },
  { id: 'git',        labelKey: 'tabIntegrations', icon: GitBranch },
  { id: 'import',     labelKey: 'tabImport',      icon: FolderOpen },
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

function Seg3({ label, description, options, value, onChange }: {
  label: string;
  description?: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
      {description && <p className="text-[10.5px] text-gray-400 dark:text-gray-500 -mt-1">{description}</p>}
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
      className={`w-full border border-gray-200/40 dark:border-gray-750/40 rounded-md px-2.5 py-1.5 text-sm focus:border-[var(--accent)] focus:outline-none bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 ${props.className ?? ''}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full border border-gray-200/40 dark:border-gray-750/40 rounded-md px-2.5 py-1.5 text-sm focus:border-[var(--accent)] focus:outline-none bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 ${props.className ?? ''}`}
    />
  );
}

function CopyBlock({ value, kind, copiedCmd, copyText, mono = true, label }: {
  value: string;
  kind: string;
  copiedCmd: string | null;
  copyText: (v: string, k: string) => void | Promise<void>;
  mono?: boolean;
  label?: string;
}) {
  const copied = copiedCmd === kind;
  return (
    <div className="flex items-start gap-2">
      <pre className={`flex-1 min-w-0 text-[11px] rounded-md px-2 py-1.5 bg-gray-100/40 dark:bg-gray-900/30 text-gray-700 dark:text-gray-200 border border-gray-200/40 dark:border-gray-700/40 overflow-x-auto whitespace-pre ${mono ? 'font-mono' : ''}`}>{value}</pre>
      <button
        type="button"
        onClick={() => { void copyText(value, kind); }}
        className="shrink-0 text-xs px-2 py-1 rounded-md border border-gray-200/40 dark:border-gray-700/40 text-gray-600 dark:text-gray-300 hover:bg-gray-100/40 dark:hover:bg-gray-800/30 transition-colors"
        title={label}
        aria-label={label}
      >
        <span className="inline-flex items-center gap-1">{copied ? <Check size={11} /> : <Copy size={11} />}</span>
      </button>
    </div>
  );
}

function McpTab({ t, copyText, copiedCmd, mcpServer, vaultPath, settings, onUpdate }: {
  t: (k: TranslationKey) => string;
  copyText: (v: string, k: string) => void | Promise<void>;
  copiedCmd: string | null;
  mcpServer: { path: string; exists: boolean } | null;
  vaultPath: string;
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}) {
  const serverPath = mcpServer?.path ?? '/path/to/dist-mcp/index.cjs';
  const built = mcpServer?.exists === true;

  const claudeCodeCmd = `claude mcp add noted -- node ${serverPath}`;
  const claudeDesktopJson = JSON.stringify({
    mcpServers: { noted: { command: 'node', args: [serverPath] } },
  }, null, 2);
  const vscodeJson = JSON.stringify({
    servers: { noted: { type: 'stdio', command: 'node', args: [serverPath] } },
  }, null, 2);
  const codexToml = `[mcp_servers.noted]\ncommand = "node"\nargs = ["${serverPath}"]`;

  const [setupStatus, setSetupStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [setupError, setSetupError] = useState<string | null>(null);

  const handleSetupClaudeMcp = async () => {
    setSetupStatus('loading');
    setSetupError(null);
    try {
      const api = getElectronApi();
      const res = await api?.setupClaudeMcp();
      if (res?.success) {
        setSetupStatus('success');
      } else {
        setSetupStatus('error');
        setSetupError(res?.error ?? 'Errore sconosciuto');
      }
    } catch (err) {
      setSetupStatus('error');
      setSetupError((err as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      {/* Status + how it works */}
      <div className="rounded-lg border border-gray-200/40 dark:border-gray-700/40 bg-gray-50/40 dark:bg-gray-800/25 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Plug size={13} className="text-gray-500 dark:text-gray-400 shrink-0" />
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate">{t('mcpSectionTitle')}</p>
          </div>
          <span
            className={`shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              built
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
            }`}
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${built ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {built ? t('mcpStatusReady') : t('mcpStatusMissing')}
          </span>
        </div>
        <p className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-300">{t('mcpTabBody')}</p>
        <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{t('mcpHowItWorks')}</p>

        {!built && (
          <div className="pt-1 space-y-1">
            <p className="text-[11px] font-medium text-gray-600 dark:text-gray-300">{t('mcpBuildLabel')}</p>
            <CopyBlock value="npm run build:mcp" kind="build" copiedCmd={copiedCmd} copyText={copyText} label={t('copyCommand')} />
          </div>
        )}

        <div className="pt-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-gray-600 dark:text-gray-300">{t('mcpServerPath')}</p>
            {built && (
              <button
                type="button"
                onClick={() => {
                  const api = getElectronApi();
                  void api?.revealInFinder?.(serverPath);
                }}
                className="text-[11px] inline-flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-[var(--accent)] transition-colors"
                title={t('mcpRevealInFinder')}
              >
                <ExternalLink size={11} />
                {t('mcpRevealInFinder')}
              </button>
            )}
          </div>
          <CopyBlock value={serverPath} kind="server-path" copiedCmd={copiedCmd} copyText={copyText} label={t('copy')} />
        </div>

        <div className="pt-1 space-y-1">
          <p className="text-[11px] font-medium text-gray-600 dark:text-gray-300">{t('mcpVaultPath')}</p>
          <CopyBlock value={vaultPath} kind="vault-path" copiedCmd={copiedCmd} copyText={copyText} label={t('copy')} />
        </div>
      </div>

      {/* Remote Access (HTTP/SSE) */}
      <div className="rounded-lg border border-gray-200/40 dark:border-gray-700/40 bg-gray-50/40 dark:bg-gray-800/25 p-3 space-y-3">
        <div className="flex items-center gap-1.5 border-b border-gray-200/40 dark:border-gray-700/40 pb-2">
          <Globe size={13} className="text-gray-500 dark:text-gray-400 shrink-0" />
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate">{t('mcpSseToggle')}</p>
        </div>

        <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          {t('mcpSseToggleHelp')}
        </p>

        <SegRow
          label={t('mcpSseToggle')}
          value={!!settings.mcpSseEnabled}
          onChange={() => onUpdate({ mcpSseEnabled: !settings.mcpSseEnabled })}
        />

        {settings.mcpSseEnabled && (
          <div className="pt-1 space-y-3 border-t border-gray-200/40 dark:border-gray-700/40">
            {/* Port selector */}
            <div className="flex items-center justify-between gap-4 py-1">
              <div>
                <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{t('mcpSsePortLabel')}</p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">{t('mcpSsePortHelp')}</p>
              </div>
              <input
                type="number"
                min="1024"
                max="65535"
                value={settings.mcpSsePort ?? 3000}
                onChange={(e) => {
                  const port = parseInt(e.target.value, 10);
                  if (!isNaN(port)) {
                    onUpdate({ mcpSsePort: port });
                  }
                }}
                className="w-20 px-2 py-1 text-xs text-right border border-gray-300/40 dark:border-gray-600/40 rounded bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>

            {/* Local SSE URL */}
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-gray-600 dark:text-gray-300">{t('mcpSseLocalUrl')}</p>
              <CopyBlock
                value={`http://localhost:${settings.mcpSsePort ?? 3000}/sse`}
                kind="mcp-sse-url"
                copiedCmd={copiedCmd}
                copyText={copyText}
                label={t('copy')}
              />
            </div>

            {/* Cloudflare Tunnel Helper */}
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-gray-600 dark:text-gray-300">{t('mcpSseCloudflareHelp')}</p>
              <CopyBlock
                value={`cloudflared tunnel --url http://localhost:${settings.mcpSsePort ?? 3000}`}
                kind="mcp-cloudflare-cmd"
                copiedCmd={copiedCmd}
                copyText={copyText}
                label={t('copy')}
              />
            </div>
          </div>
        )}
      </div>

      {/* Per-client snippets */}
      <div className="rounded-lg border border-gray-200/40 dark:border-gray-700/40 bg-gray-50/40 dark:bg-gray-800/25 p-3 space-y-3">
        <div>
          <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">{t('mcpClientClaudeCode')}</p>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">CLI one-liner</p>
          <CopyBlock value={claudeCodeCmd} kind="cli-claude-code" copiedCmd={copiedCmd} copyText={copyText} label={t('copy')} />
        </div>

        <div className="pt-1 border-t border-gray-200/40 dark:border-gray-700/40">
          <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 mt-2">{t('mcpClientClaudeDesktop')}</p>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">{t('mcpClientClaudeDesktopHint')}</p>
          <div className="flex flex-col gap-2">
            <CopyBlock value={claudeDesktopJson} kind="cfg-claude-desktop" copiedCmd={copiedCmd} copyText={copyText} label={t('copy')} />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSetupClaudeMcp}
                disabled={setupStatus === 'loading'}
                className="text-xs bg-[var(--accent)] text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50 py-1.5 px-3 rounded font-medium flex items-center justify-center gap-1.5 transition-opacity"
              >
                {setupStatus === 'loading' ? (
                  <span>Configurazione in corso...</span>
                ) : setupStatus === 'success' ? (
                  <span>Configurato con successo! ✓</span>
                ) : setupStatus === 'error' ? (
                  <span>Errore di configurazione! ✗</span>
                ) : (
                  <span>Configura Claude Desktop in 1-Click</span>
                )}
              </button>
              {setupError && (
                <span className="text-[10px] text-red-500 font-medium">{setupError}</span>
              )}
            </div>
          </div>
        </div>

        <div className="pt-1 border-t border-gray-200/40 dark:border-gray-700/40">
          <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 mt-2">{t('mcpClientVsCode')}</p>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">{t('mcpClientVsCodeHint')}</p>
          <CopyBlock value={vscodeJson} kind="cfg-vscode" copiedCmd={copiedCmd} copyText={copyText} label={t('copy')} />
        </div>

        <div className="pt-1 border-t border-gray-200/40 dark:border-gray-700/40">
          <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 mt-2">{t('mcpClientCodex')}</p>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">{t('mcpClientCodexHint')}</p>
          <CopyBlock value={codexToml} kind="cfg-codex" copiedCmd={copiedCmd} copyText={copyText} label={t('copy')} />
        </div>

        <p className="text-[10.5px] text-gray-500 dark:text-gray-400 pt-1 leading-snug">{t('mcpAfterAdding')}</p>
      </div>
    </div>
  );
}

export function SettingsModal({ settings, onUpdate, onSelectFolder, onImportVault, onClose, onToast }: SettingsModalProps) {
  useModalStack('settings', true, onClose);
  const { t } = useI18n();
  const fetchNotes = useStore(state => state.fetchNotes);
  const wipeAllNotes = useStore(state => state.wipeAllNotes);

  const handleWipe = useCallback(async () => {
    if (window.confirm(t('wipeAllNotesConfirm'))) {
      try {
        await wipeAllNotes();
        onToast?.(t('wipeAllNotesSuccess'), 'success');
      } catch (err) {
        onToast?.(t('wipeAllNotesError') + ': ' + (err as Error).message, 'error');
      }
    }
  }, [wipeAllNotes, onToast, t]);
  const [tab, setTab] = useState<SettingsTab>('ai');
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [cloudProviders, setCloudProviders] = useState<CloudProvider[]>([]);
  const [gitTokenInput, setGitTokenInput] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [encryptionAvailable, setEncryptionAvailable] = useState(true);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [mcpServer, setMcpServer] = useState<{ path: string; exists: boolean } | null>(null);
  const [importWorkflow, dispatchImportWorkflow] = useReducer(
    importWorkflowReducer,
    initialImportWorkflowState,
  );

  const handleImportVault = useCallback(async () => {
    if (isImportWorkflowBusy(importWorkflow.stage)) return;
    const api = getElectronApi();
    if (!api) return;
    dispatchImportWorkflow({ type: 'START_IMPORT_VAULT' });
    try {
      const res = await api.importVault(settings.syncDirectory ?? undefined);
      if (res.success) {
        dispatchImportWorkflow({ type: 'IMPORT_SUCCESS', count: res.data ?? 0 });
        void fetchNotes();
      } else {
        dispatchImportWorkflow({ type: 'FAILED', message: res.error ?? 'Import failed' });
      }
    } catch (err) {
      dispatchImportWorkflow({ type: 'FAILED', message: (err as Error).message });
    }
  }, [settings.syncDirectory, fetchNotes, importWorkflow.stage]);

  const handleImportAppleNotes = useCallback(async () => {
    if (isImportWorkflowBusy(importWorkflow.stage)) return;
    const api = getElectronApi();
    if (!api) return;
    dispatchImportWorkflow({ type: 'START_IMPORT_APPLE' });
    try {
      const res = await api.importAppleNotes(settings.syncDirectory ?? undefined);
      if (res.success) {
        dispatchImportWorkflow({ type: 'IMPORT_SUCCESS', count: res.data ?? 0 });
        void fetchNotes();
      } else {
        dispatchImportWorkflow({ type: 'FAILED', message: res.error ?? 'Import failed' });
      }
    } catch (err) {
      dispatchImportWorkflow({ type: 'FAILED', message: (err as Error).message });
    }
  }, [settings.syncDirectory, fetchNotes, importWorkflow.stage]);

  useEffect(() => {
    const api = getElectronApi();
    api?.safeStorageStatus?.()
      .then(r => setEncryptionAvailable(r.encrypted))
      .catch(() => { /* assume available if check fails */ });
  }, []);

  const discoverModels = useCallback(async () => {
    setDiscovering(true);
    const models = await fetchAvailableModels(settings.llmProvider, settings.lmStudioUrl);
    setDiscoveredModels(models);
    if (models.length === 1) onUpdate({ llmModel: models[0] });
    setDiscovering(false);
  }, [settings.llmProvider, settings.lmStudioUrl, onUpdate]);

  useEffect(() => {
    if (isLocalProvider(settings.llmProvider)) {
      void discoverModels();
    } else {
      setDiscoveredModels([]);
    }
  }, [settings.llmProvider, settings.lmStudioUrl, discoverModels]);

  useEffect(() => {
    const api = getElectronApi();
    if (!api?.detectCloudProviders) return;
    api.detectCloudProviders().then(res => {
       
      if (res.success && res.data) setCloudProviders(res.data);
    });
   
  }, []);

  const handleActivateProvider = useCallback(async (notedPath: string) => {
    if (isImportWorkflowBusy(importWorkflow.stage)) return;
    const api = getElectronApi();
    if (!api) return;
    dispatchImportWorkflow({ type: 'START_ACTIVATE_CLOUD', path: notedPath });
    const res = await api.activateCloudProvider(notedPath);
    if (res.success && res.data) {
      onUpdate({ syncDirectory: res.data });
      dispatchImportWorkflow({ type: 'ACTIVATE_SUCCESS' });
    } else {
      dispatchImportWorkflow({ type: 'FAILED', message: res.error ?? 'Cloud activation failed' });
    }
  }, [onUpdate, importWorkflow.stage]);

  const handleSaveToken = useCallback(async () => {
    const api = getElectronApi();
    if (!gitTokenInput.trim() || !api?.gitStoreToken) return;
    setSavingToken(true);
    await api.gitStoreToken(gitTokenInput.trim());
    setGitTokenInput('');
    setSavingToken(false);
  }, [gitTokenInput]);

  const copyText = useCallback(async (value: string, kind: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedCmd(kind);
      window.setTimeout(() => setCopiedCmd(prev => (prev === kind ? null : prev)), 1600);
    } catch {
      // Keep silent: clipboard may be blocked by OS policy/focus.
    }
  }, []);

  useEffect(() => {
    const api = getElectronApi();
    api?.getMcpServerPath?.()
      .then(setMcpServer)
      .catch(() => { /* leave null — UI shows path-unknown state */ });
  }, []);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50">
      <button
        type="button"
        aria-label={t('closeSettings')}
        className="absolute inset-0 modal-backdrop-animate"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          if (e.target !== e.currentTarget) return;
          onClose();
        }}
      />
      <div className="relative z-10 glass-modal rounded-xl shadow-2xl w-[520px] overflow-hidden flex flex-col modal-content-animate">

        {/* Header */}
        <div className="px-5 py-3.5 border-b border-gray-100/40 dark:border-gray-700/40 flex justify-between items-center">
          <h2 className="font-semibold text-gray-800 dark:text-gray-200 text-sm">{t('settingsTitle')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label={t('closeSettings')}>
            <X size={16} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-100/40 dark:border-gray-700/40 bg-gray-50/40 dark:bg-gray-800/30">
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
              <div className="rounded-lg border border-blue-200/40 dark:border-blue-800/40 bg-blue-50/30 dark:bg-blue-900/15 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Info size={13} className="text-blue-600 dark:text-blue-300" />
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-200">{t('aiHowItWorksTitle')}</p>
                </div>
                <p className="text-[11px] leading-relaxed text-blue-800/95 dark:text-blue-200/90">
                  {t('aiHowItWorksBody')}
                </p>
                <p className="text-[11px] mt-1 leading-relaxed text-blue-800/95 dark:text-blue-200/90">
                  {t('aiRetrievalMode')}
                </p>
              </div>

              <div>
                <div className="flex items-center gap-1">
                  <FieldLabel>{t('llmProvider')}</FieldLabel>
                  <span
                    className="inline-flex items-center text-gray-400 dark:text-gray-500"
                    title={t('llmProviderHelp')}
                    aria-label={t('llmProviderHelp')}
                  >
                    <Info size={12} />
                  </span>
                </div>
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
                  {!encryptionAvailable && (
                    <div className="mb-1.5 text-[11px] px-2.5 py-1.5 rounded-md bg-amber-50/30 dark:bg-amber-900/15 border border-amber-200/40 dark:border-amber-800/40 text-amber-800 dark:text-amber-200">
                      {t('safeStorageUnavailable')}
                    </div>
                  )}
                  <Input type="password" value={settings.llmApiKey} onChange={(e) => onUpdate({ llmApiKey: e.target.value })} placeholder="sk-..." />
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{t('apiKeyHelp')}</p>
                </div>
              )}

              <div className="rounded-lg border border-gray-200/40 dark:border-gray-700/40 bg-gray-50/40 dark:bg-gray-800/25 p-3 space-y-3">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('ragSectionTitle')}</p>
                <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{t('ragSectionBody')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <FieldLabel>{t('ragTopKLabel')}</FieldLabel>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={settings.ragTopK ?? 3}
                      onChange={(e) => onUpdate({ ragTopK: Math.max(1, Math.min(10, Number(e.target.value) || 3)) })}
                    />
                  </div>
                  <div>
                    <FieldLabel>{t('ragMaxNotesLabel')}</FieldLabel>
                    <Input
                      type="number"
                      min={10}
                      max={500}
                      value={settings.ragMaxNotes ?? 100}
                      onChange={(e) => onUpdate({ ragMaxNotes: Math.max(10, Math.min(500, Number(e.target.value) || 100)) })}
                    />
                  </div>
                </div>
                <div>
                  <FieldLabel>{t('ragContextCharsLabel')}</FieldLabel>
                  <Input
                    type="number"
                    min={1500}
                    max={30000}
                    step={500}
                    value={settings.ragContextChars ?? 8000}
                    onChange={(e) => onUpdate({ ragContextChars: Math.max(1500, Math.min(30000, Number(e.target.value) || 8000)) })}
                  />
                </div>
                <SegRow
                  label={t('ragDebugLabel')}
                  description={t('ragDebugDesc')}
                  value={!!settings.ragDebug}
                  onChange={() => onUpdate({ ragDebug: !settings.ragDebug })}
                />
              </div>

              <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                <SegRow
                  label={t('smartTagsLabel')}
                  description={t('smartTagsDesc')}
                  value={!!settings.smartTagsEnabled}
                  onChange={() => onUpdate({ smartTagsEnabled: !settings.smartTagsEnabled })}
                />
              </div>
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
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('editorBg')}</p>
                <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-2">{t('editorBgHelp')}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* "Default" tile — clears the override and falls back to theme */}
                  <button
                    onClick={() => onUpdate({ editorBg: null })}
                    title={t('editorBgDefault')}
                    aria-label={t('editorBgDefault')}
                    className={`w-6 h-6 rounded-full transition-transform hover:scale-110 border border-gray-300 dark:border-gray-600 bg-gradient-to-br from-white via-gray-200 to-gray-400 ${
                      !settings.editorBg ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''
                    }`}
                  />
                  {['#000000', '#ffffff', '#fbf3e0', '#f5f5f7', '#1c1c1e', '#0a1929', '#1a1a2e', '#2c2c2e'].map(color => (
                    <button key={color} onClick={() => onUpdate({ editorBg: color })} title={color}
                      style={{ background: color }}
                      className={`w-6 h-6 rounded-full transition-transform hover:scale-110 border border-gray-300 dark:border-gray-600 ${settings.editorBg === color ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''}`}
                    />
                  ))}
                  <input type="color" aria-label={t('customColor')} title={t('customColor')}
                    value={settings.editorBg ?? '#ffffff'}
                    onChange={e => onUpdate({ editorBg: e.target.value })}
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

              <Seg3
                label={t('editorWidth')}
                description={t('editorWidthHelp')}
                options={[
                  { value: 'narrow', label: t('widthNarrow') },
                  { value: 'normal', label: t('widthNormal') },
                  { value: 'wide',   label: t('widthWide') },
                  { value: 'full',   label: t('widthFull') },
                ]}
                value={settings.editorWidth ?? 'normal'}
                onChange={v => onUpdate({ editorWidth: v as Settings['editorWidth'] })}
              />

              <Seg3
                label={t('aiSuggestions')}
                description={t('aiSuggestionsHelp')}
                options={[
                  { value: 'off',    label: t('aiGhostOff') },
                  { value: 'manual', label: t('aiGhostManual') },
                  { value: 'auto',   label: t('aiGhostAuto') },
                ]}
                value={settings.aiGhostMode ?? 'manual'}
                onChange={v => onUpdate({ aiGhostMode: v as Settings['aiGhostMode'] })}
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
                    const isLoading =
                      importWorkflow.stage === 'activatingCloud' &&
                      importWorkflow.activeProviderPath === p.notedPath;
                    return (
                      <button key={p.id}
                        onClick={() => p.available && !isActive && handleActivateProvider(p.notedPath)}
                        disabled={!p.available || isLoading}
                        className={`relative flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left transition-all ${
                          isActive
                            ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                            : p.available
                              ? 'border-gray-200/40 dark:border-gray-700/40 hover:border-[var(--accent-mid)] hover:bg-gray-50/40 dark:hover:bg-gray-800/30'
                              : 'border-gray-200/40 dark:border-gray-700/40 opacity-40 cursor-not-allowed'
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
                          isLocal ? 'border-[var(--accent)] bg-[var(--accent-light)]' : 'border-gray-200/40 dark:border-gray-700/40 hover:border-[var(--accent-mid)] hover:bg-gray-50/40 dark:hover:bg-gray-800/30'
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
                    className="flex flex-col items-start gap-1 p-2.5 rounded-lg border border-dashed border-gray-300/40 dark:border-gray-600/40 text-left hover:border-[var(--accent-mid)] hover:bg-gray-50/40 dark:hover:bg-gray-800/30 transition-all"
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
                  className="w-full py-1.5 text-xs border border-gray-200/40 dark:border-gray-650/40 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-50/40 dark:hover:bg-gray-800/30 transition-colors">
                  {t('importVault')}
                </button>
              )}

              {/* Danger Zone */}
              <div className="border border-red-200/40 dark:border-red-900/30 bg-red-50/30 dark:bg-red-950/10 p-3 rounded-lg mt-4 space-y-2">
                <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                  <Info size={12} className="shrink-0" />
                  <span className="text-xs font-semibold">{t('dangerZone')}</span>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('dangerZoneDesc')}</p>
                <button
                  type="button"
                  onClick={handleWipe}
                  className="w-full py-1.5 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200/40 dark:border-red-800/40 rounded-md hover:bg-red-50/30 dark:hover:bg-red-950/15 active:bg-red-100/40 transition-colors"
                >
                  {t('wipeAllNotes')}
                </button>
              </div>
            </div>
          )}

          {/* ── MCP Tab ── */}
          {tab === 'mcp' && (
            <McpTab
              t={t}
              copyText={copyText}
              copiedCmd={copiedCmd}
              mcpServer={mcpServer}
              vaultPath={settings.syncDirectory || t('directoryDefault')}
              settings={settings}
              onUpdate={onUpdate}
            />
          )}

          {/* ── Git Tab ── */}
          {tab === 'git' && (
            <div className="space-y-4">

              <div className="rounded-lg border border-gray-200/40 dark:border-gray-700/40 bg-gray-50/40 dark:bg-gray-800/25 p-3 space-y-3">
                <SegRow
                  label={t('embeddingsBetaTitle')}
                  description={t('embeddingsBetaDesc')}
                  value={!!settings.embeddingsEnabled}
                  onChange={() => onUpdate({ embeddingsEnabled: !settings.embeddingsEnabled })}
                />
                {settings.embeddingsEnabled && (
                  <div className="space-y-2 pt-1 border-t border-gray-200/40 dark:border-gray-700/40">
                    <div>
                      <FieldLabel>{t('embeddingsProvider')}</FieldLabel>
                      <Select value={settings.embeddingProvider ?? 'none'} onChange={e => onUpdate({ embeddingProvider: e.target.value as Settings['embeddingProvider'] })}>
                        <option value="none">{t('embeddingsProviderNone')}</option>
                        <option value="openai">OpenAI</option>
                        <option value="lmstudio">LM Studio (Local)</option>
                        <option value="ollama">Ollama (Local)</option>
                      </Select>
                    </div>
                    <div>
                      <FieldLabel>{t('embeddingsModel')}</FieldLabel>
                      <Input
                        type="text"
                        value={settings.embeddingModel ?? ''}
                        onChange={e => onUpdate({ embeddingModel: e.target.value })}
                        placeholder="text-embedding-3-small"
                      />
                    </div>
                    <p className="text-[11px] text-amber-600 dark:text-amber-300">{t('embeddingsBetaNote')}</p>
                  </div>
                )}
              </div>

              <SegRow
                label={t('gitEnable')}
                description={t('gitEnableDesc')}
                value={!!settings.gitEnabled}
                onChange={() => onUpdate({ gitEnabled: !settings.gitEnabled })}
              />

              {settings.gitEnabled && (
                <>
                  <div className="pt-1 space-y-3 border-t border-gray-100/40 dark:border-gray-700/40">
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
                          className="btn-primary px-3 py-1.5 text-xs rounded-md transition-all shrink-0"
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
                <div className="mt-2 p-3 rounded-lg bg-gray-50/40 dark:bg-gray-800/25 border border-gray-100/40 dark:border-gray-700/40">
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
                    Git integration lets you version-control your notes, create branches, push to GitHub, open PRs, and save notes as public or private Gists — all from inside Noted.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Import Tab ── */}
          {tab === 'import' && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-0.5">{t('importTitle')}</p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-4">
                  {t('importTitle')} — Importa note da altre fonti locali.
                </p>

                <div className="flex flex-col gap-3">
                  {/* Obsidian / Markdown Folder */}
                  <div className="rounded-lg border border-gray-200/40 dark:border-gray-700/40 bg-gray-50/40 dark:bg-gray-800/25 p-3 flex flex-col justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <FolderOpen size={14} className="text-[var(--accent)]" />
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                          Obsidian Vault / Markdown Folder
                        </span>
                      </div>
                      <p className="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
                        {t('importObsidianDesc')}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleImportVault}
                        disabled={importWorkflow.stage === 'importingVault'}
                        className="btn-primary text-xs py-1.5 px-3 rounded-md transition-all font-medium disabled:opacity-50"
                      >
                        {importWorkflow.stage === 'importingVault' ? t('importing') : t('importObsidian')}
                      </button>
                    </div>
                  </div>

                  {/* Apple Notes */}
                  <div className="rounded-lg border border-gray-200/40 dark:border-gray-700/40 bg-gray-50/40 dark:bg-gray-800/25 p-3 flex flex-col justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Info size={14} className="text-amber-500 dark:text-amber-400" />
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                          Apple Notes
                        </span>
                      </div>
                      <p className="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
                        {t('importAppleNotesDesc')}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleImportAppleNotes}
                        disabled={importWorkflow.stage === 'importingAppleNotes'}
                        className="btn-primary text-xs py-1.5 px-3 rounded-md transition-all font-medium disabled:opacity-50"
                      >
                        {importWorkflow.stage === 'importingAppleNotes' ? t('importing') : t('importAppleNotes')}
                      </button>
                    </div>
                  </div>
                </div>

                {importWorkflow.status && (
                  <div className={`mt-3 p-2.5 rounded-md text-xs font-medium flex items-center gap-2 ${
                    importWorkflow.status.success
                      ? 'bg-emerald-50/30 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300 border border-emerald-100/40 dark:border-emerald-900/40'
                      : 'bg-red-50/30 text-red-800 dark:bg-red-950/20 dark:text-red-300 border border-red-100/40 dark:border-red-900/40'
                  }`}>
                    {importWorkflow.status.success ? (
                      <>
                        <CheckCircle2 size={13} className="text-emerald-500" />
                        <span>{t('importSuccess').replace('{count}', String(importWorkflow.status.count))}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-red-500 font-bold">✗</span>
                        <span>{importWorkflow.status.error}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50/40 dark:bg-gray-800/30 border-t border-gray-100/40 dark:border-gray-700/40 flex justify-end">
          <button
            onClick={onClose}
            className="btn-primary px-4 py-1.5 rounded-md text-sm font-medium transition-all"
          >
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
