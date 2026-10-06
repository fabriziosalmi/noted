import { useMemo } from 'react';
import { backlinksOf } from '../lib/backlinks';
import { useStore } from '../store/useStore';
import type { AppDerivedStateArgs, AppDerivedStateResult } from './contracts';

export function useAppDerivedState({
  notes,
  noteLinksIndex,
  tagIndex,
  activeNoteName,
  activeTagFilter,
  settings,
}: AppDerivedStateArgs): AppDerivedStateResult {
  const noteAliasesIndex = useStore(s => s.noteAliasesIndex);
  const allTags = useMemo(() => Object.keys(tagIndex), [tagIndex]);

  const filteredNotes = useMemo(() => (
    activeTagFilter
      ? notes.filter((n) => (tagIndex[activeTagFilter] ?? []).includes(n.name))
      : notes
  ), [activeTagFilter, notes, tagIndex]);

  const backlinks = useMemo(
    () => (activeNoteName ? backlinksOf(noteLinksIndex, activeNoteName, noteAliasesIndex) : []),
    [activeNoteName, noteLinksIndex, noteAliasesIndex],
  );

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
