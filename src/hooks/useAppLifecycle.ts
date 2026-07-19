import { useEffect } from 'react';
import type { AppLifecycleArgs } from './contracts';
import { useStore, type SettingsState } from '../store/useStore';
import { detectLocalLLMs } from '../lib/llmAutoDetect';
import { getElectronApi } from '../lib/electronApi';

function getContrastColor(hex: string): string {
  const color = hex.startsWith('#') ? hex.slice(1) : hex;
  if (color.length !== 6) return '#ffffff';
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return (yiq >= 170) ? '#111111' : '#ffffff';
}

export function useAppLifecycle({
  accentColor,
  editorBg,
  activeNoteName,
  fetchNotes,
  loadApiKey,
}: AppLifecycleArgs): void {
  const syncDirectory = useStore((state) => state.settings.syncDirectory);

  useEffect(() => {
    const accent = accentColor ?? '#6366f1';
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-contrast', getContrastColor(accent));
  }, [accentColor]);

  useEffect(() => {
    const root = document.documentElement;
    if (editorBg) {
      root.style.setProperty('--editor-bg', editorBg);
      root.setAttribute('data-editor-bg', '');
    } else {
      root.style.removeProperty('--editor-bg');
      root.removeAttribute('data-editor-bg');
    }
  }, [editorBg]);

  useEffect(() => {
    void loadApiKey();
    const api = getElectronApi();
    api?.onRefreshNotes(() => {
      void fetchNotes();
    });
  }, [fetchNotes, loadApiKey]);

  useEffect(() => {
    void fetchNotes();
  }, [syncDirectory, fetchNotes]);

  // Mirror the configured vault dir to main so quick-capture writes there too.
  useEffect(() => {
    getElectronApi()?.setActiveVaultDir?.(syncDirectory || null);
  }, [syncDirectory]);

  // Register the configured local-LLM endpoint host so main's SSRF allowlist
  // accepts it (a LAN Ollama/LM Studio, beyond loopback + the cloud providers).
  const lmStudioUrl = useStore((state) => state.settings.lmStudioUrl);
  useEffect(() => {
    let host: string;
    try { host = lmStudioUrl ? new URL(lmStudioUrl).hostname : ''; } catch { host = ''; }
    getElectronApi()?.setLlmHosts?.(host ? [host] : []);
  }, [lmStudioUrl]);

  useEffect(() => {
    const api = getElectronApi();
    api?.setNoteTitle(activeNoteName ?? '');
  }, [activeNoteName]);

  // Scans for Ollama & LM Studio locally on startup
  useEffect(() => {
    async function runDetection() {
      try {
        const store = useStore.getState();
        const currentProvider = store.settings.llmProvider;
        const isCurrentlyLocal = currentProvider === 'ollama' || currentProvider === 'lmstudio';
        const result = await detectLocalLLMs(store.settings.lmStudioUrl);
        if (result.provider) {
          const update: Partial<SettingsState> = {
            detectedLocalModels: result.models
          };
          const hasCloudKey = !!store.settings.llmApiKey;
          if (!hasCloudKey || isCurrentlyLocal) {
            update.llmProvider = result.provider;
            // set to first model if no model set yet or if old model not in detected list
            if ((!store.settings.llmModel || !result.models.includes(store.settings.llmModel)) && result.models.length > 0) {
              update.llmModel = result.models[0];
            }
          }
          store.updateSettings(update);
        }
      } catch (err) {
        console.error('LLM local auto-detection failed:', err);
      }
    }
    void runDetection();
  }, []);

  // Background Auto-Commit Timer
  const enableAutoCommit = useStore((state) => state.settings.enableAutoCommit);
  const autoCommitInterval = useStore((state) => state.settings.autoCommitInterval);
  const gitEnabled = useStore((state) => state.settings.gitEnabled);

  useEffect(() => {
    const api = getElectronApi();
    if (!gitEnabled || !enableAutoCommit || !api?.gitCommitAll) {
      return;
    }
    let isCommitting = false;
    const intervalMs = (autoCommitInterval || 5) * 60 * 1000;
    const intervalId = setInterval(() => {
      if (isCommitting) {
        console.warn('Auto-commit skipped: previous commit still in progress');
        return;
      }
      isCommitting = true;
      api.gitCommitAll('Auto-commit: update notes', syncDirectory || undefined)
        .catch((err) => console.error('Auto-commit failed:', err))
        .finally(() => {
          isCommitting = false;
        });
    }, intervalMs);

    return () => {
      clearInterval(intervalId);
    };
  }, [gitEnabled, enableAutoCommit, autoCommitInterval, syncDirectory]);

  // Sync MCP SSE configuration to Electron
  const mcpSseEnabled = useStore((state) => state.settings.mcpSseEnabled);
  const mcpSsePort = useStore((state) => state.settings.mcpSsePort);

  useEffect(() => {
    const api = getElectronApi();
    if (api?.updateMcpSseConfig) {
      api.updateMcpSseConfig({
        enabled: !!mcpSseEnabled,
        port: mcpSsePort ?? 3000,
        syncDir: syncDirectory || undefined,
      }).catch((err) => {
        console.error('Failed to update MCP SSE config:', err);
      });
    }
  }, [mcpSseEnabled, mcpSsePort, syncDirectory]);
}
