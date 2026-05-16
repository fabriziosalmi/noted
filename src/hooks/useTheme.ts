import { useEffect } from 'react';
import { useStore } from '../store/useStore';

export function useTheme() {
  const theme = useStore(s => s.settings.theme);

  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'dark') {
      root.classList.add('dark');
      return;
    }

    if (theme === 'light') {
      root.classList.remove('dark');
      return;
    }

    // auto — follow system preference
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (e: MediaQueryList | MediaQueryListEvent) => {
      e.matches ? root.classList.add('dark') : root.classList.remove('dark');
    };
    apply(mq);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}
