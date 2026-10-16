import { useState, useCallback } from 'react';
import type { ToastMessage, ToastVariant } from '../components/Toast';

let _nextId = 1;

/** More than this many at once used to pile up over the editor and the save warning; the oldest go first. */
export const MAX_TOASTS = 3;

export function useToast() {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  // Stable identities: `setMessages` is stable, so `toast`/`dismiss` don't change
  // between renders. Otherwise every App re-render (e.g. each keystroke) hands
  // ToastItem a fresh `onDismiss`, re-arming its auto-dismiss timer so toasts
  // never disappear while the user is active.
  const toast = useCallback((text: string, variant: ToastVariant = 'success') => {
    const id = _nextId++;
    setMessages(prev => {
      // The same message already on screen is not shown twice (a failure repeated by a loop or a retry).
      if (prev.some(m => m.text === text && m.variant === variant)) return prev;
      return [...prev, { id, text, variant }].slice(-MAX_TOASTS);
    });
  }, []);

  const dismiss = useCallback((id: number) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  }, []);

  return { messages, toast, dismiss };
}
