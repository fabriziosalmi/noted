import { describe, it, expect } from 'vitest';
import { syncStatusText } from './gitSyncText';
import { translate } from './i18n';
import type { SyncSummary } from './gitSyncPolicy';

const now = 1_700_000_000_000;
const en = (k: Parameters<typeof translate>[0]) => translate(k, 'en');

describe('syncStatusText', () => {
  it('fills the placeholders and covers every summary kind', () => {
    const cases: [SyncSummary, RegExp][] = [
      [{ kind: 'off', tone: 'off' }, /off/i],
      [{ kind: 'never', tone: 'ok' }, /not synced yet/i],
      [{ kind: 'synced', tone: 'ok', at: now - 5 * 60_000 }, /^Synced 5 minutes ago$/],
      [{ kind: 'syncing', tone: 'busy' }, /Syncing/],
      [{ kind: 'conflict', tone: 'attention', count: 3 }, /\(3\)/],
      [{ kind: 'unconfigured', tone: 'attention' }, /upstream/i],
      [{ kind: 'error', tone: 'error', message: 'x' }, /failed/i],
    ];
    for (const [summary, re] of cases) {
      const text = syncStatusText(summary, en, 'en', now);
      expect(text).toMatch(re);
      expect(text).not.toMatch(/\{\w+\}/); // no unfilled placeholder
    }
  });

  it('speaks the user\'s language', () => {
    const it = (k: Parameters<typeof translate>[0]) => translate(k, 'it');
    expect(syncStatusText({ kind: 'synced', tone: 'ok', at: now - 5 * 60_000 }, it, 'it', now)).toBe('Sincronizzato 5 minuti fa');
  });
});
