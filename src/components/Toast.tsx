import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, X } from 'lucide-react';
import { useI18n } from '../lib/i18n';

export type ToastVariant = 'success' | 'error';

export interface ToastMessage {
  id: number;
  text: string;
  variant: ToastVariant;
}

interface ToastItemProps {
  message: ToastMessage;
  onDismiss: (id: number) => void;
}

function ToastItem({ message, onDismiss }: ToastItemProps) {
  const { t } = useI18n();
  const isSuccess = message.variant === 'success';
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    // Errors linger (and can be read); success is brief. Hovering pauses both.
    const timer = setTimeout(() => onDismiss(message.id), isSuccess ? 4000 : 10000);
    return () => clearTimeout(timer);
  }, [message.id, onDismiss, isSuccess, paused]);

  return (
    <div
      role={isSuccess ? 'status' : 'alert'}
      aria-live={isSuccess ? 'polite' : 'assertive'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`toast-item flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm text-white ${
        isSuccess ? 'bg-emerald-600' : 'bg-red-600'
      }`}
    >
      {isSuccess ? <CheckCircle size={15} className="shrink-0" /> : <XCircle size={15} className="shrink-0" />}
      <span className="flex-1">{message.text}</span>
      <button
        type="button"
        onClick={() => onDismiss(message.id)}
        aria-label={t('close')}
        className="shrink-0 -mr-1 p-0.5 rounded hover:bg-white/20 transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}

interface ToastStackProps {
  messages: ToastMessage[];
  onDismiss: (id: number) => void;
}

export function ToastStack({ messages, onDismiss }: ToastStackProps) {
  const { t } = useI18n();
  if (messages.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-[100]" aria-label={t('notificationsRegion')}>
      {messages.map(m => (
        <ToastItem key={m.id} message={m} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
