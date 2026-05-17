import { useEffect } from 'react';
import { useStore } from '../store/useStore';

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('sepia', false);
}

function applySepia() {
  document.documentElement.classList.remove('dark');
  document.documentElement.classList.add('sepia');
}

export function useTheme() {
  const theme = useStore(s => s.settings.theme);
  const accentColor = useStore(s => s.settings.accentColor);

  // Apply accent color as CSS variable
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accentColor ?? '#6366f1');
    // Derive a lighter tint for backgrounds (20% opacity via CSS is enough)
  }, [accentColor]);

  useEffect(() => {
    if (theme === 'sepia') { applySepia(); return; }
    if (theme === 'dark') { applyTheme(true); return; }
    if (theme === 'light') { applyTheme(false); return; }

    // auto — prefer Electron's nativeTheme for accuracy; fall back to CSS media query
    if (window.electronAPI?.getNativeTheme) {
      void window.electronAPI.getNativeTheme().then(({ isDark }) => applyTheme(isDark));
      window.electronAPI.onNativeThemeUpdated?.((t) => applyTheme(t === 'dark'));
      return;
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (e: MediaQueryList | MediaQueryListEvent) => applyTheme(e.matches);
    apply(mq);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}
