import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { getElectronApi } from '../lib/electronApi';
import type { VaultWatchStatus } from '../types';

/** Keeps the store's vaultWatch in step with the main process: asked once at start, then pushed on every change. */
export function useVaultWatchStatus(): void {
  useEffect(() => {
    const api = getElectronApi();
    if (!api?.onVaultWatchStatus) return;
    const set = (vaultWatch: VaultWatchStatus) => useStore.setState({ vaultWatch });
    const off = api.onVaultWatchStatus(set);
    void api.getVaultWatchStatus?.().then(set).catch(() => undefined);
    return off;
  }, []);
}
