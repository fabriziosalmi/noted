import { useCallback, useRef } from 'react';
import type { KeyboardEvent } from 'react';

/**
 * Pure roving-focus index math for a horizontal tablist (WAI-ARIA APG).
 * Returns the destination index, or -1 when the key is not a navigation key.
 */
export function nextTabIndex(key: string, current: number, count: number): number {
  if (count <= 0) return -1;
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return -1;
  }
}

/**
 * Headless helper that turns a set of plain buttons + a single rendered panel
 * into a WAI-ARIA compliant tab widget: `role="tablist"` with roving tabindex,
 * arrow-key / Home / End navigation that moves both selection and focus, and a
 * single shared `role="tabpanel"` (both call sites render only the active panel,
 * so one panel labelled by the active tab avoids dangling `aria-controls`).
 */
export function useTablist<T extends string>(
  tabs: readonly T[],
  active: T,
  setActive: (t: T) => void,
  idPrefix: string,
) {
  const refs = useRef(new Map<T, HTMLButtonElement | null>());

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      const next = nextTabIndex(e.key, tabs.indexOf(active), tabs.length);
      if (next < 0) return;
      e.preventDefault();
      const nextTab = tabs[next];
      setActive(nextTab);
      refs.current.get(nextTab)?.focus();
    },
    [tabs, active, setActive],
  );

  const getTabProps = (tab: T) => ({
    role: 'tab' as const,
    id: `${idPrefix}-tab-${tab}`,
    'aria-selected': active === tab,
    'aria-controls': `${idPrefix}-panel`,
    tabIndex: active === tab ? 0 : -1,
    ref: (el: HTMLButtonElement | null) => {
      refs.current.set(tab, el);
    },
    onKeyDown,
  });

  const tablistProps = {
    role: 'tablist' as const,
    'aria-orientation': 'horizontal' as const,
  };

  const panelProps = {
    role: 'tabpanel' as const,
    id: `${idPrefix}-panel`,
    'aria-labelledby': `${idPrefix}-tab-${active}`,
    tabIndex: 0,
  };

  return { tablistProps, getTabProps, panelProps };
}
