import { useEffect } from 'react';
import type { GlobalShortcutsArgs } from './contracts';

function isTextInputTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLElement && (target.isContentEditable || !!target.closest('[contenteditable="true"]'))) return true;
  return false;
}

function hasShortcutModifier(e: KeyboardEvent): boolean {
  if (e.metaKey) return true;
  // Avoid treating AltGr (Ctrl+Alt) combos as app shortcuts on intl layouts.
  return e.ctrlKey && !e.altKey;
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
      if (e.defaultPrevented || e.isComposing || e.repeat) return;

      const key = e.key.toLowerCase();
      const accel = hasShortcutModifier(e);

      if (e.key === '?' && !accel && !e.altKey && !isTextInputTarget(e.target)) {
        onToggleShortcuts();
      }
      if (accel && key === 'p') {
        e.preventDefault();
        onToggleQuickOpen();
      }
      if (accel && key === 'f' && !e.shiftKey) {
        e.preventDefault();
        onToggleFind();
      }
      if (accel && e.shiftKey && key === 'f') {
        e.preventDefault();
        onToggleGlobalSearch();
      }
      // Use physical key code for layout-safe behaviour on non-US keyboards.
      if (accel && e.code === 'Backslash') {
        e.preventDefault();
        onToggleFocusMode();
      }
      if (accel && key === 'n' && !e.shiftKey) {
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
