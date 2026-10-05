import { formatAgo, type SyncSummary } from './gitSyncPolicy';
import type { TranslationKey } from './i18n';

/** One-line, localised description of a sync summary (badge tooltip, panel status). */
export function syncStatusText(
  summary: SyncSummary,
  t: (key: TranslationKey) => string,
  language: string,
  now: number,
): string {
  switch (summary.kind) {
    case 'off': return t('gitSyncStatusOff');
    case 'never': return t('gitSyncStatusNever');
    case 'synced': return t('gitSyncStatusSynced').replace('{when}', formatAgo(summary.at, now, language));
    case 'syncing': return t('gitSyncStatusSyncing');
    case 'conflict': return t('gitSyncStatusConflict').replace('{n}', String(summary.count));
    case 'unconfigured': return t('gitSyncStatusUnconfigured');
    case 'error': return t('gitSyncStatusError');
  }
}
