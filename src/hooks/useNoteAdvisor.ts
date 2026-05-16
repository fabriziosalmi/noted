import { useState, useEffect, useCallback, useMemo } from 'react';
import { runAdvisor, type Suggestion, type NoteInput } from '../lib/noteAdvisor';
import type { NoteFile } from '../store/useStore';

const DISMISSED_KEY = 'noted-advisor-dismissed';

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch { /* quota */ }
}

function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

interface UseNoteAdvisorOptions {
  activeNoteName: string | null;
  activeNoteContent: string;     // HTML
  notes: NoteFile[];
}

export function useNoteAdvisor({ activeNoteName, activeNoteContent, notes }: UseNoteAdvisorOptions) {
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  const [rawSuggestions, setRawSuggestions] = useState<Suggestion[]>([]);

  // Build NoteInput for the active note
  const activeInput = useMemo<NoteInput | null>(() => {
    if (!activeNoteName) return null;
    const file = notes.find(n => n.name === activeNoteName);
    return {
      name: activeNoteName,
      text: htmlToText(activeNoteContent),
      html: activeNoteContent,
      mtimeMs: file?.stats.mtimeMs ?? Date.now(),
    };
  }, [activeNoteName, activeNoteContent, notes]);

  // Build NoteInput[] for all notes — content only available for active note.
  // Cross-note analysis (stale, duplicate-topic) uses names + mtimeMs only.
  const allInputs = useMemo<NoteInput[]>(() => {
    return notes.map(n => ({
      name: n.name,
      text: n.name === activeNoteName ? htmlToText(activeNoteContent) : '',
      html: n.name === activeNoteName ? activeNoteContent : '',
      mtimeMs: n.stats.mtimeMs,
    }));
  }, [notes, activeNoteName, activeNoteContent]);

  // Re-run analysis when active note content changes (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      setRawSuggestions(runAdvisor(activeInput, allInputs));
    }, 1500);
    return () => clearTimeout(timer);
  }, [activeInput, allInputs]);

  const suggestions = useMemo(
    () => rawSuggestions.filter(s => !dismissed.has(s.id)),
    [rawSuggestions, dismissed]
  );

  const dismiss = useCallback((id: string) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      saveDismissed(next);
      return next;
    });
  }, []);

  const dismissAll = useCallback(() => {
    setDismissed(prev => {
      const next = new Set(prev);
      rawSuggestions.forEach(s => next.add(s.id));
      saveDismissed(next);
      return next;
    });
  }, [rawSuggestions]);

  return { suggestions, dismiss, dismissAll };
}
