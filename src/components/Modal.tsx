import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../lib/i18n';
import { useModalStack } from '../hooks/useModalStack';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ModalProps {
  /** Stable id used for Escape-stack ordering. */
  id: string;
  onClose: () => void;
  /** id of the heading element that names the dialog (preferred). */
  labelledBy?: string;
  /** Accessible name when there is no visible heading to point at. */
  ariaLabel?: string;
  /** Extra classes for the panel (sizing: e.g. `w-[520px]`). */
  className?: string;
  /** Allow closing by clicking the backdrop. Default true. */
  dismissOnBackdrop?: boolean;
  /**
   * Render an opaque panel instead of the translucent glass one. Use for
   * dialogs whose readability suffers when the note behind them shows through
   * (e.g. Settings, with its dense forms).
   */
  solid?: boolean;
  children: ReactNode;
}

/**
 * Accessible modal primitive for the whole app. Provides:
 *  - `role="dialog"` + `aria-modal` + accessible name
 *  - focus trap + focus return (useFocusTrap)
 *  - Escape-to-close with correct stacking (useModalStack)
 *  - backdrop click-to-dismiss, glass styling and the shared open animation
 *
 * Callers supply only the inner content (header + body + footer); the backdrop,
 * portal, panel chrome and a11y wiring live here so every dialog behaves
 * identically.
 */
export function Modal({
  id,
  onClose,
  labelledBy,
  ariaLabel,
  className = '',
  dismissOnBackdrop = true,
  solid = false,
  children,
}: ModalProps) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);

  useModalStack(id, true, onClose);
  useFocusTrap(panelRef, true);

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center z-50">
      <button
        type="button"
        aria-label={t('close')}
        className="absolute inset-0 modal-backdrop-animate"
        onMouseDown={e => {
          if (!dismissOnBackdrop) return;
          if (e.button !== 0) return;
          if (e.target !== e.currentTarget) return;
          onClose();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : ariaLabel}
        tabIndex={-1}
        className={`relative z-10 ${solid ? 'solid-modal' : 'glass-modal'} rounded-xl shadow-2xl flex flex-col overflow-hidden modal-content-animate outline-none ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
