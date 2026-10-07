import { RefreshCw } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { getElectronApi } from '../lib/electronApi';
import { embeddingConfigOf } from '../lib/embeddings';
import { requestEmbeddingSync } from '../lib/embeddingSync';

/** How far the vault's vectors are, under the embeddings settings; and the way to throw them away and start again. */
export function EmbeddingsStatus() {
  const { t } = useI18n();
  const progress = useStore(s => s.embeddingProgress);
  const settings = useStore(s => s.settings);
  const cfg = embeddingConfigOf(settings);
  if (!cfg) return null;

  const numbers = { done: String(progress.embedded), total: String(progress.chunks) };
  const line = progress.state === 'error'
    ? t('embeddingsError').replace('{error}', progress.error ?? '')
    : progress.chunks === 0 && progress.state === 'running'
      ? t('embeddingsWaiting')
      : t(progress.state === 'running' ? 'embeddingsRunning' : 'embeddingsProgress').replace('{done}', numbers.done).replace('{total}', numbers.total);

  const rebuild = async () => {
    await getElectronApi()?.embeddingsClear({ provider: cfg.provider, model: cfg.model }, settings.syncDirectory || undefined);
    useStore.getState().setEmbeddingProgress({ state: 'running', chunks: 0, embedded: 0, capped: false });
    requestEmbeddingSync();
  };

  return (
    <div className="space-y-1" data-testid="embeddings-status" data-state={progress.state}>
      <div className="flex items-center gap-2">
        <p role="status" className={`text-[11px] flex-1 ${progress.state === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>{line}</p>
        <button
          type="button"
          onClick={() => { void rebuild(); }}
          disabled={progress.state === 'running'}
          title={t('embeddingsRebuildHint')}
          className="shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
        >
          <RefreshCw size={11} aria-hidden="true" /> {t('embeddingsRebuild')}
        </button>
      </div>
      {progress.capped && <p className="text-[11px] text-amber-600 dark:text-amber-300">{t('embeddingsCapped')}</p>}
    </div>
  );
}
