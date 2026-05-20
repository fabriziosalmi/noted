import { useEffect, useState } from 'react';
import type { NoteChunk } from '../lib/noteSearch';
import type { NoteChunksArgs } from './contracts';

export function useNoteChunks({ rightOpen, notes, syncDirectory, ragMaxNotes = 100 }: NoteChunksArgs): NoteChunk[] {
  const [noteChunks, setNoteChunks] = useState<NoteChunk[]>([]);

  useEffect(() => {
    if (!rightOpen || !window.electronAPI || notes.length === 0) return;
    let cancelled = false;
    const syncDir = syncDirectory || undefined;

    (async () => {
      const safeLimit = Math.max(10, Math.min(500, ragMaxNotes));
      const capped = notes.slice(0, safeLimit);
      const BATCH = 10;
      const chunks: NoteChunk[] = [];

      for (let i = 0; i < capped.length; i += BATCH) {
        if (cancelled) return;
        const batch = capped.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map((note) => window.electronAPI.readNote(note.name, syncDir))
        );
        if (cancelled) return;

        for (let j = 0; j < batch.length; j++) {
          const res = results[j];
          if (res?.success && res.data) {
            const text = (res.data as string).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            chunks.push({ name: batch[j].name, text });
          }
        }
      }

      if (!cancelled) setNoteChunks(chunks);
    })();

    return () => {
      cancelled = true;
    };
  }, [rightOpen, notes, syncDirectory, ragMaxNotes]);

  return noteChunks;
}
