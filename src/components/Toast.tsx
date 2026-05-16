import { useEffect } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';

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
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(message.id), 3000);
    return () => clearTimeout(timer);
  }, [message.id, onDismiss]);

  const isSuccess = message.variant === 'success';
  return (
    <div
      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm text-white ${
        isSuccess ? 'bg-emerald-600' : 'bg-red-600'
      }`}
    >
      {isSuccess ? <CheckCircle size={15} /> : <XCircle size={15} />}
      <span>{message.text}</span>
    </div>
  );
}

interface ToastStackProps {
  messages: ToastMessage[];
  onDismiss: (id: number) => void;
}

export function ToastStack({ messages, onDismiss }: ToastStackProps) {
  if (messages.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-[100]">
      {messages.map(m => (
        <ToastItem key={m.id} message={m} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
