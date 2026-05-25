import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
}

/**
 * Single tooltip primitive for the whole app. Rendered through a portal with
 * `position: fixed`, so it is never clipped by `overflow:hidden`/scroll
 * ancestors (toolbars, the virtualized sidebar, modal bodies). Shows on hover
 * *and* keyboard focus for a11y; the appear delay is killed automatically by
 * the global `prefers-reduced-motion` rule. Replaces the native `title=`
 * attribute on icon-only controls.
 */
export function Tooltip({ label, children, side = 'bottom' }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  const show = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = triggerRef.current?.firstElementChild ?? triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setCoords({ x: r.left + r.width / 2, y: side === 'top' ? r.top : r.bottom });
    }, 200);
  }, [side]);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setCoords(null);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <span
      ref={triggerRef}
      className="inline-flex"
      onPointerEnter={show}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {coords &&
        createPortal(
          <span
            role="tooltip"
            className="fixed z-[9999] whitespace-nowrap px-2 py-1 text-[11px] font-medium rounded text-white bg-gray-800 dark:bg-gray-700 shadow-md pointer-events-none select-none"
            style={{
              left: coords.x,
              top: coords.y,
              transform: side === 'top'
                ? 'translate(-50%, calc(-100% - 6px))'
                : 'translate(-50%, 6px)',
            }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
