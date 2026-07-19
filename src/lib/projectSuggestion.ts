import { slugifyTitle } from './noteTitle';

export interface ProjectSuggestion {
  slug: string; // project slug, e.g. 'aurora'
  label: string; // display label, e.g. 'Aurora'
  tag: string; // '#project/aurora'
  /** Other notes that already belong to (or match) this project. */
  matches: string[];
}

/** Lowercased, filesystem-safe stem of a note name, with any " N" collision
 *  suffix removed so "Aurora" and "Aurora 2" fold to the same project. */
function baseStem(noteName: string): string {
  return slugifyTitle(noteName.replace(/\.md$/, '').replace(/^.*\//, ''))
    .toLowerCase()
    .replace(/\s+\d+$/, '');
}

/**
 * Suggest grouping the current note into a project when its title recurs:
 * either an existing #project/<slug> tag already groups other notes, or other
 * notes share the same title stem (the "I keep writing the same project name
 * but the notes stay separate" case). Returns null when there's nothing to
 * group or the note is already in the project.
 */
export function suggestProject(
  title: string,
  opts: {
    activeNoteName: string | null;
    tagIndex: Record<string, string[]>;
    noteNames: string[];
  },
): ProjectSuggestion | null {
  const label = title.trim();
  if (label.length < 3) return null;
  const slug = slugifyTitle(label).toLowerCase().replace(/\s+\d+$/, '');
  if (!slug) return null;
  const tag = `#project/${slug}`;

  // Already grouped into this project → nothing to suggest.
  if (opts.activeNoteName && (opts.tagIndex[tag] ?? []).includes(opts.activeNoteName)) return null;

  // (a) An existing project with this slug (other notes already carry the tag).
  const tagged = (opts.tagIndex[tag] ?? []).filter(n => n !== opts.activeNoteName);

  // (b) Other notes whose title/name stem equals this project slug.
  const sameNamed = opts.noteNames.filter(
    n => n !== opts.activeNoteName && baseStem(n) === slug,
  );

  const matches = [...new Set([...tagged, ...sameNamed])];
  if (matches.length === 0) return null;

  return { slug, label, tag, matches };
}
