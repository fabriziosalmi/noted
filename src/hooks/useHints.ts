import { useStore } from '../store/useStore';

const HINTS_KEY = 'noted-hints';
const MAX_SHOWS = 3;

function getCounts(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(HINTS_KEY) ?? '{}'); }
  catch { return {}; }
}

export function useHints() {
  const showHints = useStore(s => s.settings.showHints !== false);

  const shouldShow = (key: string): boolean => {
    if (!showHints) return false;
    const counts = getCounts();
    return (counts[key] ?? 0) < MAX_SHOWS;
  };

  const markSeen = (key: string): void => {
    const counts = getCounts();
    counts[key] = (counts[key] ?? 0) + 1;
    localStorage.setItem(HINTS_KEY, JSON.stringify(counts));
  };

  const resetAll = (): void => {
    localStorage.removeItem(HINTS_KEY);
  };

  return { shouldShow, markSeen, resetAll };
}
