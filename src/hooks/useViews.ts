import { useEffect } from 'react';
import { useStore } from '../store/useStore';

/** Loads the vault's saved views when a vault opens (and again when another one is chosen). */
export function useViews(syncDirectory: string | undefined): void {
  useEffect(() => {
    useStore.setState({ views: [] });
    void useStore.getState().loadViews().catch(() => undefined);
  }, [syncDirectory]);
}
