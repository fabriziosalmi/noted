import type { ReactNode } from 'react';

interface TooltipProps {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
}

export function Tooltip({ label, children, side = 'bottom' }: TooltipProps) {
  return (
    <div className="relative group/tt inline-flex">
      {children}
      <span
        role="tooltip"
        className={`
          absolute left-1/2 -translate-x-1/2 z-50 whitespace-nowrap
          px-2 py-1 text-[11px] font-medium rounded
          text-white bg-gray-800 dark:bg-gray-700
          pointer-events-none select-none
          opacity-0 group-hover/tt:opacity-100
          transition-opacity duration-150
          ${side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}
        `}
        style={{ transitionDelay: '200ms' }}
      >
        {label}
      </span>
    </div>
  );
}
