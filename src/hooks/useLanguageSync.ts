import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { getElectronApi } from '../lib/electronApi';

/** Tell the main process the app's language, at start and whenever it changes: update dialogs and the native menu follow it. */
export function useLanguageSync(): void {
  const language = useStore(s => s.settings.language ?? 'en');
  useEffect(() => {
    void getElectronApi()?.setLanguage?.(language)?.catch?.(() => undefined);
  }, [language]);
}
