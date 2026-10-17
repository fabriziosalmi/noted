import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

/**
 * Keyboard movement inside a toolbar or a menu, as ARIA describes it: Tab reaches the group at one place (the item
 * last focused), and the arrow keys, Home and End move between its items. `vertical` uses ↑↓ (a menu), otherwise ←→.
 */
export function useRovingFocus(ref: RefObject<HTMLElement | null>, selector: string, orientation: 'horizontal' | 'vertical' = 'horizontal') {
  // After every render (items come and go): exactly one item is reachable with Tab. An element that has left the
  // group (a menu item that became a plain button) gets its own tab order back instead of keeping -1.
  const managed = useRef<Set<HTMLElement>>(new Set());
  useEffect(() => {
    const items = ref.current ? [...ref.current.querySelectorAll<HTMLElement>(selector)] : [];
    for (const el of managed.current) {
      if (items.includes(el)) continue;
      el.removeAttribute('tabindex');
      delete el.dataset.rovingCurrent;
    }
    managed.current = new Set(items);
    if (!items.length) return;
    const current = items.find(i => i.dataset.rovingCurrent === 'true') ?? items[0];
    for (const item of items) {
      item.tabIndex = item === current ? 0 : -1;
      item.dataset.rovingCurrent = String(item === current);
    }
  });

  const onFocus = useCallback((e: React.FocusEvent) => {
    const items = ref.current ? [...ref.current.querySelectorAll<HTMLElement>(selector)] : [];
    if (!items.includes(e.target as HTMLElement)) return;
    for (const item of items) {
      item.tabIndex = item === e.target ? 0 : -1;
      item.dataset.rovingCurrent = String(item === e.target);
    }
  }, [ref, selector]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    const items = ref.current ? [...ref.current.querySelectorAll<HTMLElement>(selector)].filter(i => !(i as HTMLButtonElement).disabled) : [];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at === -1 || !items.length) return;
    const [prev, next] = orientation === 'vertical' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    let to: number | null = null;
    if (e.key === next) to = (at + 1) % items.length;
    else if (e.key === prev) to = (at - 1 + items.length) % items.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = items.length - 1;
    if (to === null) return;
    e.preventDefault();
    items[to].focus();
  }, [ref, selector, orientation]);

  return { onKeyDown, onFocus };
}
