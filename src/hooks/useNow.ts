import { useEffect, useState } from 'react';

/**
 * The current time as React state, refreshed on an interval and whenever `bump`
 * changes (e.g. a sync just finished). Lets relative times ("5 minutes ago")
 * stay fresh without calling Date.now() during render.
 */
export function useNow(intervalMs = 30_000, bump?: unknown): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  // `bump` is a refresh trigger, not a value we read.
  useEffect(() => { setNow(Date.now()); }, [bump]);
  return now;
}
