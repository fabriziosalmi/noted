import { useState, useEffect, useRef } from 'react';
import { useHints } from '../hooks/useHints';

interface HintProps {
  hintKey: string;
  text: string;
  children: React.ReactNode;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

const PLACEMENT_CLASSES: Record<string, string> = {
  top:    'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left:   'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right:  'left-full top-1/2 -translate-y-1/2 ml-1.5',
};

const ARROW_CLASSES: Record<string, string> = {
  top:    'top-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent border-t-gray-800',
  bottom: 'bottom-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-t-transparent border-b-gray-800',
  left:   'left-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-r-transparent border-l-gray-800',
  right:  'right-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-l-transparent border-r-gray-800',
};

export function Hint({ hintKey, text, children, placement = 'top', delay = 600 }: HintProps) {
  const { shouldShow, markSeen } = useHints();
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownRef = useRef(false);

  useEffect(() => {
    if (!shouldShow(hintKey) || shownRef.current) return;
    timerRef.current = setTimeout(() => {
      setVisible(true);
      shownRef.current = true;
      markSeen(hintKey);
      setTimeout(() => setVisible(false), 3500);
    }, delay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative inline-flex">
      {children}
      {visible && (
        <div className={`absolute z-[200] pointer-events-none ${PLACEMENT_CLASSES[placement]}`}>
          <div className="px-2 py-1 text-[11px] bg-gray-800 text-white rounded shadow-xl whitespace-nowrap leading-tight">
            {text}
          </div>
          <div className={`absolute w-0 h-0 border-[4px] ${ARROW_CLASSES[placement]}`} />
        </div>
      )}
    </div>
  );
}
