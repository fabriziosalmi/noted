import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { getElectronApi } from '../lib/electronApi';
import type { VaultIndexDelta } from '../lib/vaultIndexTypes';

/**
 * Keeps the renderer's link/tag maps in step with the main-process VaultIndex:
 * one snapshot when the vault opens, then small deltas.
 *
 * A delta can overtake the snapshot's reply (they travel on different IPC
 * channels). Deltas received before the snapshot lands are buffered and applied
 * afterwards; the store drops any whose sequence number the snapshot already
 * covers, so nothing is applied twice and nothing is lost.
 */
export function useVaultIndex(syncDirectory: string | undefined): void {
  useEffect(() => {
    const api = getElectronApi();
    if (!api?.getVaultIndexSnapshot || !api.onVaultIndexDelta) return;
    let cancelled = false;
    let loaded = false;
    const buffered: VaultIndexDelta[] = [];
    let retry: ReturnType<typeof setTimeout> | undefined;

    const off = api.onVaultIndexDelta(delta => {
      if (cancelled) return;
      if (loaded) useStore.getState().applyVaultIndexDelta(delta);
      else buffered.push(delta);
    });

    const load = (attempt: number) => {
      api.getVaultIndexSnapshot(syncDirectory).then(snapshot => {
        if (cancelled) return;
        const store = useStore.getState();
        store.applyVaultIndexSnapshot(snapshot);
        loaded = true;
        for (const d of buffered.splice(0)) store.applyVaultIndexDelta(d);
      }).catch(() => {
        if (!cancelled && attempt < 3) retry = setTimeout(() => load(attempt + 1), 2000 * attempt);
      });
    };
    load(1);

    return () => { cancelled = true; clearTimeout(retry); off(); };
  }, [syncDirectory]);
}
