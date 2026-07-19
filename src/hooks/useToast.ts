import { useState } from 'react';
import type { ToastMessage, ToastVariant } from '../components/Toast';

let _nextId = 1;

export function useToast() {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const toast = (text: string, variant: ToastVariant = 'success') => {
    const id = _nextId++;
    setMessages(prev => [...prev, { id, text, variant }]);
  };

  const dismiss = (id: number) => setMessages(prev => prev.filter(m => m.id !== id));

  return { messages, toast, dismiss };
}
