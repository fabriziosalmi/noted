import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { getElectronApi } from '../lib/electronApi';
import { forgetVaultFormat } from '../lib/noteIo';

/**
 * The vault's note format changed under the app (a conversion finished): what was remembered about it is
 * stale, the list and the open note must be read again, and the notes now come from the files in the new format.
 */
export function useVaultFormatSync(): void {
  useEffect(() => {
    const api = getElectronApi();
    if (!api?.onVaultFormatChanged) return;
    return api.onVaultFormatChanged(() => {
      forgetVaultFormat();
      const store = useStore.getState();
      void store.fetchNotes().then(() => {
        const open = useStore.getState().activeNoteName;
        if (open) void useStore.getState().openNote(open);
      });
    });
  }, []);
}
