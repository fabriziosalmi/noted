import {
  createContext, useCallback, useContext, useId, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { useI18n } from '../lib/i18n';
import { Modal } from './Modal';

export interface ConfirmOptions {
  /** Heading. Falls back to a localized "Are you sure?". */
  title?: string;
  /** Body text — the actual question. */
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
}

export interface PromptOptions {
  title?: string;
  /** Optional descriptive text above the input. */
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
type PromptFn = (opts: PromptOptions) => Promise<string | null>;

interface DialogApi {
  confirm: ConfirmFn;
  prompt: PromptFn;
}

const DialogContext = createContext<DialogApi | null>(null);

type Pending =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

const footerBtn =
  'px-3 py-1.5 text-sm rounded-lg transition-colors';
const cancelBtn =
  `${footerBtn} text-gray-700 dark:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-gray-700/60`;

/**
 * App-wide async confirm() / prompt() replacements. Swaps the native,
 * un-themeable, render-blocking browser dialogs for glass dialogs that match
 * the rest of the UI and are fully accessible (focus-trapped, Escape-cancellable).
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ message: '…', danger: true })) { … }
 *
 *   const prompt = usePrompt();
 *   const name = await prompt({ message: '…', defaultValue: 'x' });
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [pending, setPending] = useState<Pending | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const confirm = useCallback<ConfirmFn>(
    opts => new Promise<boolean>(resolve => setPending({ kind: 'confirm', opts, resolve })),
    [],
  );

  const prompt = useCallback<PromptFn>(
    opts =>
      new Promise<string | null>(resolve => {
        setPromptValue(opts.defaultValue ?? '');
        setPending({ kind: 'prompt', opts, resolve });
      }),
    [],
  );

  const resolveConfirm = useCallback((value: boolean) => {
    setPending(prev => {
      if (prev?.kind === 'confirm') prev.resolve(value);
      else if (prev?.kind === 'prompt') prev.resolve(null);
      return null;
    });
  }, []);

  const resolvePrompt = useCallback((value: string | null) => {
    setPending(prev => {
      if (prev?.kind === 'prompt') prev.resolve(value);
      return null;
    });
  }, []);

  const api = useMemo<DialogApi>(() => ({ confirm, prompt }), [confirm, prompt]);

  return (
    <DialogContext.Provider value={api}>
      {children}
      {pending && (
        <Modal
          id="app-dialog"
          onClose={() => (pending.kind === 'confirm' ? resolveConfirm(false) : resolvePrompt(null))}
          labelledBy={titleId}
          className="w-[420px] max-w-[90vw]"
        >
          <div className="px-5 py-4">
            <h2 id={titleId} className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              {pending.opts.title ?? t('confirmTitle')}
            </h2>
            {pending.opts.message && (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line">
                {pending.opts.message}
              </p>
            )}
            {pending.kind === 'prompt' && (
              <input
                ref={inputRef}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                aria-label={pending.opts.title ?? pending.opts.message ?? t('confirm')}
                value={promptValue}
                placeholder={pending.opts.placeholder}
                onChange={e => setPromptValue(e.target.value)}
                onKeyDown={e => {
                  if (e.nativeEvent.isComposing || e.repeat) return;
                  if (e.key === 'Enter') { e.preventDefault(); resolvePrompt(promptValue.trim() || null); }
                }}
                className="mt-3 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 focus:border-[var(--accent)] rounded-lg px-3 py-1.5 text-sm outline-none transition-colors"
              />
            )}
          </div>
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100/40 dark:border-gray-700/40 bg-gray-50/30 dark:bg-gray-900/20">
            <button
              type="button"
              onClick={() => (pending.kind === 'confirm' ? resolveConfirm(false) : resolvePrompt(null))}
              className={cancelBtn}
            >
              {pending.opts.cancelLabel ?? t('cancel')}
            </button>
            <button
              type="button"
              onClick={() =>
                pending.kind === 'confirm'
                  ? resolveConfirm(true)
                  : resolvePrompt(promptValue.trim() || null)
              }
              className={`${footerBtn} text-white ${
                pending.kind === 'confirm' && pending.opts.danger
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'btn-primary'
              }`}
            >
              {pending.opts.confirmLabel ?? t('confirm')}
            </button>
          </div>
        </Modal>
      )}
    </DialogContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): ConfirmFn {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx.confirm;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePrompt(): PromptFn {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('usePrompt must be used within a ConfirmProvider');
  return ctx.prompt;
}
