import { useEffect } from 'react';

/**
 * Coordinates Escape-to-close across simultaneously-open modals.
 *
 * Each modal registers itself when open; the last one to open is "top of
 * stack" and is the only one that closes on Escape. This avoids the previous
 * behaviour where Settings + Templates open at once and Escape would close
 * both (or neither, depending on listener order).
 *
 * Implementation notes:
 *  - The stack lives at module scope, intentionally not in React state — we
 *    want a single global ordering across the whole app.
 *  - We attach exactly one capture-phase listener once the stack becomes
 *    non-empty, and remove it when the stack drains. Per-modal listeners
 *    would race; a single capture-phase one is deterministic.
 */
const stack: string[] = [];
let listenerAttached = false;

function handleKey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing || e.repeat) return;
  if (e.key !== 'Escape') return;
  const top = stack[stack.length - 1];
  if (!top) return;
  const cb = closers.get(top);
  if (cb) {
    e.stopPropagation();
    e.preventDefault();
    cb();
  }
}

const closers = new Map<string, () => void>();

function ensureListener() {
  if (listenerAttached) return;
  document.addEventListener('keydown', handleKey, true);
  listenerAttached = true;
}

function teardownIfEmpty() {
  if (stack.length === 0 && listenerAttached) {
    document.removeEventListener('keydown', handleKey, true);
    listenerAttached = false;
  }
}

export function useModalStack(id: string, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    stack.push(id);
    ensureListener();
    return () => {
      const i = stack.lastIndexOf(id);
      if (i !== -1) stack.splice(i, 1);
      closers.delete(id);
      teardownIfEmpty();
    };
  }, [id, open]);

  // Parents often pass a new onClose on every render. That only replaces the closer: it must not move the modal back
  // to the top of the stack, above a dialog opened over it (Escape would then close the one underneath).
  useEffect(() => {
    if (open) closers.set(id, onClose);
  }, [id, open, onClose]);
}
