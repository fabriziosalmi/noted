import { useEffect } from 'react';
import type { AppLifecycleArgs } from './contracts';

function getContrastColor(hex: string): string {
  const color = hex.startsWith('#') ? hex.slice(1) : hex;
  if (color.length !== 6) return '#ffffff';
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return (yiq >= 170) ? '#111111' : '#ffffff';
}

export function useAppLifecycle({
  accentColor,
  editorBg,
  activeNoteName,
  fetchNotes,
  loadApiKey,
}: AppLifecycleArgs): void {
  useEffect(() => {
    const accent = accentColor ?? '#6366f1';
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-contrast', getContrastColor(accent));
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
