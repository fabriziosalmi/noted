import { useEffect } from 'react';
import type { GlobalShortcutsArgs } from './contracts';

function isTextInputTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export function useGlobalShortcuts({
  onToggleShortcuts,
  onToggleQuickOpen,
  onToggleFind,
  onToggleGlobalSearch,
  onToggleFocusMode,
  onCreateNote,
}: GlobalShortcutsArgs): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !isTextInputTarget(e.target)) {
        onToggleShortcuts();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        onToggleQuickOpen();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && !e.shiftKey) {
        e.preventDefault();
        onToggleFind();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        onToggleGlobalSearch();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        onToggleFocusMode();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n' && !e.shiftKey) {
        e.preventDefault();
        onCreateNote();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [
    onToggleShortcuts,
    onToggleQuickOpen,
    onToggleFind,
    onToggleGlobalSearch,
    onToggleFocusMode,
    onCreateNote,
  ]);
}
