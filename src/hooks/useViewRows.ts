import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { runView, type ViewRow } from '../../shared/views/query';
import type { View } from '../../shared/views/model';

/** A view's rows, recomputed only when the view, the notes, or their fields or tags change. */
export function useViewRows(view: View): ViewRow[] {
  const notes = useStore(s => s.notes);
  const frontmatter = useStore(s => s.frontmatterIndex);
  const tags = useStore(s => s.tagIndex);
  return useMemo(
    () => runView(view, { notes: notes.map(n => ({ name: n.name, mtimeMs: n.stats.mtimeMs })), frontmatter, tags }),
    [view, notes, frontmatter, tags],
  );
}
