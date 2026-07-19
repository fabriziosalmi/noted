import { useMemo } from 'react';
import type { AppDerivedStateArgs, AppDerivedStateResult } from './contracts';

export function useAppDerivedState({
  notes,
  noteLinksIndex,
  tagIndex,
  activeNoteName,
  activeTagFilter,
  settings,
}: AppDerivedStateArgs): AppDerivedStateResult {
  const allTags = useMemo(() => Object.keys(tagIndex), [tagIndex]);

  const filteredNotes = useMemo(() => (
    activeTagFilter
      ? notes.filter((n) => (tagIndex[activeTagFilter] ?? []).includes(n.name))
      : notes
  ), [activeTagFilter, notes, tagIndex]);

  const backlinks = useMemo(() => (
    activeNoteName
      ? Object.entries(noteLinksIndex)
          .filter(([noteName, links]) => noteName !== activeNoteName && links.some((l) => {
            const normalized = l.endsWith('.md') ? l : `${l}.md`;
            return normalized === activeNoteName || l === activeNoteName.replace('.md', '');
          }))
          .map(([noteName]) => noteName)
      : []
  ), [activeNoteName, noteLinksIndex]);

  const allNoteNames = useMemo(
    () => notes.map((n) => n.name.replace('.md', '')),
    [notes],
  );

  const fontClass = `editor-font-${settings.editorFont ?? 'system'}`;
  const sizeClass = `editor-size-${settings.editorFontSize ?? 'md'}`;
  const focusClass = settings.focusMode ? 'focus-mode' : '';
  const typewriterClass = settings.typewriterMode ? 'typewriter-mode' : '';

  return {
    allTags,
    filteredNotes,
    backlinks,
    allNoteNames,
    fontClass,
    sizeClass,
    focusClass,
    typewriterClass,
  };
}
