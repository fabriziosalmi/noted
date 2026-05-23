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

function getContrastColor(hex: string): string {
  const color = hex.startsWith('#') ? hex.slice(1) : hex;
  if (color.length !== 6) return '#ffffff';
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return (yiq >= 170) ? '#111111' : '#ffffff';
}

export function useTheme() {
  const theme = useStore(s => s.settings.theme);
  const accentColor = useStore(s => s.settings.accentColor);

  // Apply accent color as CSS variable
  useEffect(() => {
    const accent = accentColor ?? '#6366f1';
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-contrast', getContrastColor(accent));
  }, [accentColor]);

  useEffect(() => {
    if (theme === 'sepia') { applySepia(); return; }
    if (theme === 'dark') { applyTheme(true); return; }
    if (theme === 'light') { applyTheme(false); return; }

    // auto — prefer Electron's nativeTheme for accuracy; fall back to CSS media query
    let active = true;
    let unsubscribeNative: (() => void) | undefined;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMqChange = (e: MediaQueryListEvent) => {
      if (active) applyTheme(e.matches);
    };

    applyTheme(mq.matches);
    mq.addEventListener('change', handleMqChange);

    if (window.electronAPI?.getNativeTheme) {
      void window.electronAPI.getNativeTheme().then(({ isDark }) => {
        if (active) applyTheme(isDark);
      });
      if (window.electronAPI.onNativeThemeUpdated) {
        unsubscribeNative = window.electronAPI.onNativeThemeUpdated((t) => {
          if (active) applyTheme(t === 'dark');
        });
      }
    }

    return () => {
      active = false;
      if (unsubscribeNative) unsubscribeNative();
      mq.removeEventListener('change', handleMqChange);
    };
  }, [theme]);
}
