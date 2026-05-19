import { useEffect } from 'react';
import type { AppLifecycleArgs } from './contracts';

export function useAppLifecycle({
  accentColor,
  editorBg,
  activeNoteName,
  fetchNotes,
  loadApiKey,
}: AppLifecycleArgs): void {
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accentColor ?? '#6366f1');
  }, [accentColor]);

  useEffect(() => {
    const root = document.documentElement;
    if (editorBg) {
      root.style.setProperty('--editor-bg', editorBg);
      root.setAttribute('data-editor-bg', '');
    } else {
      root.style.removeProperty('--editor-bg');
      root.removeAttribute('data-editor-bg');
    }
  }, [editorBg]);

  useEffect(() => {
    void fetchNotes();
    void loadApiKey();
    window.electronAPI?.onRefreshNotes(() => {
      void fetchNotes();
    });
  }, [fetchNotes, loadApiKey]);

  useEffect(() => {
    window.electronAPI?.setNoteTitle(activeNoteName ?? '');
  }, [activeNoteName]);
}
