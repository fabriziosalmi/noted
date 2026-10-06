import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { inferSchema, type FieldInfo } from '../../shared/views/schema';

/** The vault's frontmatter fields and their types, recomputed only when the notes' fields change. */
export function useFieldSchema(): FieldInfo[] {
  const index = useStore(s => s.frontmatterIndex);
  return useMemo(() => inferSchema(index), [index]);
}
