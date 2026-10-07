import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { getElectronApi } from '../lib/electronApi';
import { embedTexts, embeddingConfigOf } from '../lib/embeddings';
import { EMBEDDING_SYNC_EVENT, runEmbeddingSync, type SyncApi } from '../lib/embeddingSync';

const NOTES_SETTLE_MS = 4_000;
const EVERY_MS = 2 * 60_000;

/**
 * Keeps the vault's vectors current while embeddings are on: a run when they are switched on or their model, key or vault
 * changes, another a few seconds after the notes change, on a slow timer (which also retries after an error), and when the
 * window regains focus. A run only sends what has no vector yet, so a run with nothing new is one cheap question to the main
 * process. Runs never overlap: a trigger that arrives during one asks for another when it ends.
 */
export function useEmbeddingSync(): void {
  const enabled = useStore(s => s.settings.embeddingsEnabled);
  const provider = useStore(s => s.settings.embeddingProvider);
  const model = useStore(s => s.settings.embeddingModel);
  const apiKey = useStore(s => s.settings.llmApiKey);
  const lmStudioUrl = useStore(s => s.settings.lmStudioUrl);
  const piiMasking = useStore(s => s.settings.piiMasking);
  const syncDir = useStore(s => s.settings.syncDirectory) || undefined;

  useEffect(() => {
    const cfg = embeddingConfigOf({ embeddingsEnabled: enabled, embeddingProvider: provider, embeddingModel: model, llmApiKey: apiKey, lmStudioUrl, piiMasking });
    const api = getElectronApi();
    const set = useStore.getState().setEmbeddingProgress;
    if (!cfg || !api?.embeddingsPending) {
      set({ state: 'off', chunks: 0, embedded: 0, capped: false });
      return;
    }

    const controller = new AbortController();
    let running = false;
    let again = false;
    let settle: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      if (controller.signal.aborted) return;
      if (running) { again = true; return; }
      running = true;
      const before = useStore.getState().embeddingProgress;
      set({ ...before, state: 'running', error: undefined });
      try {
        const outcome = await runEmbeddingSync({
          api: api as unknown as SyncApi,
          embed: texts => embedTexts(cfg, texts),
          model: { provider: cfg.provider, model: cfg.model },
          syncDir,
          signal: controller.signal,
          onProgress: p => { if (!controller.signal.aborted) set({ ...p, state: 'running' }); },
        });
        if (controller.signal.aborted) return;
        set(outcome.state === 'error' ? { ...outcome.progress, state: 'error', error: outcome.error } : { ...outcome.progress, state: 'idle' });
      } finally {
        running = false;
        if (again && !controller.signal.aborted) { again = false; void run(); }
      }
    };

    // Whatever the model was before, this is a new run: show it from nothing rather than with the last model's numbers.
    set({ state: 'running', chunks: 0, embedded: 0, capped: false });
    void run();

    const onNotes = () => { clearTimeout(settle); settle = setTimeout(() => void run(), NOTES_SETTLE_MS); };
    const unsubscribe = useStore.subscribe((s, prev) => { if (s.notes !== prev.notes) onNotes(); });
    const timer = setInterval(() => void run(), EVERY_MS);
    const onFocus = () => void run();
    window.addEventListener('focus', onFocus);
    window.addEventListener(EMBEDDING_SYNC_EVENT, onFocus);

    return () => {
      controller.abort();
      clearTimeout(settle);
      clearInterval(timer);
      unsubscribe();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(EMBEDDING_SYNC_EVENT, onFocus);
    };
  }, [enabled, provider, model, apiKey, lmStudioUrl, piiMasking, syncDir]);
}
