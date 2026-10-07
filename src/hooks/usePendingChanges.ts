import { useCallback, useEffect, useState } from 'react';
import { getElectronApi } from '../lib/electronApi';
import type { PendingChange } from '../../shared/vault/pending';

const POLL_MS = 4000;

/**
 * The changes assistants have proposed in places where their writes need approval. Another process (the MCP server) adds
 * them, so the list is asked for now and then, and again whenever the window comes back to the front.
 */
export function usePendingChanges(syncDir: string | undefined): { changes: PendingChange[]; refresh: () => Promise<void> } {
  const [changes, setChanges] = useState<PendingChange[]>([]);

  const refresh = useCallback(async () => {
    const res = await getElectronApi()?.listPendingChanges?.(syncDir).catch(() => null);
    if (res?.success && res.data) {
      const next = res.data;
      setChanges(prev => (prev.length === next.length && prev.every((p, i) => p.id === next[i].id) ? prev : next));
    }
  }, [syncDir]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, POLL_MS);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  return { changes, refresh };
}
