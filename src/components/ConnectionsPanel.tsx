import { useMemo } from 'react';
import { FolderGit2, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useI18n } from '../lib/i18n';

function Chip({ name, onOpen }: { name: string; onOpen: (n: string) => void }) {
  const bare = name.replace(/\.md$/, '');
  return (
    <button
      type="button"
      onClick={() => onOpen(name.endsWith('.md') ? name : `${name}.md`)}
      title={bare}
      className="text-xs px-2.5 py-1 rounded-full transition-colors hover:opacity-80 truncate max-w-full"
      style={{ background: 'var(--accent-light)', color: 'var(--accent)' } as React.CSSProperties}
    >
      {bare}
    </button>
  );
}

function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider truncate">{label}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/**
 * Connections view (replaces the old global graph): shows, for the current
 * note, the notes it shares a #project/ tag with, plus its backlinks and
 * outgoing wikilinks — the "how do these notes connect" question answered as
 * readable, navigable lists instead of a hairball.
 */
export function ConnectionsPanel({ onOpenNote }: { onOpenNote: (name: string) => void }) {
  const { t } = useI18n();
  const activeNoteName = useStore(s => s.activeNoteName);
  const noteLinksIndex = useStore(s => s.noteLinksIndex);
  const tagIndex = useStore(s => s.tagIndex);

  const { outgoing, backlinks, projectTags, projectSiblings } = useMemo(() => {
    if (!activeNoteName) {
      return { outgoing: [] as string[], backlinks: [] as string[], projectTags: [] as string[], projectSiblings: [] as string[] };
    }
    const bare = activeNoteName.replace(/\.md$/, '');
    const outgoing = [...new Set(noteLinksIndex[activeNoteName] ?? [])];
    const backlinks = Object.entries(noteLinksIndex)
      .filter(([name, links]) => name !== activeNoteName && links.some(l => l === activeNoteName || l === bare))
      .map(([name]) => name);
    const projectTags = Object.keys(tagIndex)
      .filter(tag => tag.startsWith('#project/') && tagIndex[tag].includes(activeNoteName));
    const sib = new Set<string>();
    for (const tag of projectTags) for (const n of tagIndex[tag]) if (n !== activeNoteName) sib.add(n);
    return { outgoing, backlinks, projectTags, projectSiblings: [...sib] };
  }, [activeNoteName, noteLinksIndex, tagIndex]);

  if (!activeNoteName) {
    return <div className="p-4 text-sm text-gray-400 dark:text-gray-500">{t('connNoActive')}</div>;
  }

  const nothing = !projectTags.length && !backlinks.length && !outgoing.length;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {projectTags.length > 0 && (
        <Section
          icon={<FolderGit2 size={12} className="text-[var(--accent)] shrink-0" />}
          label={`${t('connProject')} · ${projectTags.map(pt => pt.replace('#project/', '')).join(', ')}`}
        >
          {projectSiblings.length
            ? projectSiblings.map(n => <Chip key={n} name={n} onOpen={onOpenNote} />)
            : <span className="text-xs text-gray-400 dark:text-gray-600">{t('connProjectAlone')}</span>}
        </Section>
      )}

      {backlinks.length > 0 && (
        <Section icon={<ArrowDownLeft size={12} className="text-gray-400 shrink-0" />} label={t('connBacklinks')}>
          {backlinks.map(n => <Chip key={n} name={n} onOpen={onOpenNote} />)}
        </Section>
      )}

      {outgoing.length > 0 && (
        <Section icon={<ArrowUpRight size={12} className="text-gray-400 shrink-0" />} label={t('connOutgoing')}>
          {outgoing.map(n => <Chip key={n} name={n} onOpen={onOpenNote} />)}
        </Section>
      )}

      {nothing && (
        <div className="text-sm text-gray-400 dark:text-gray-500 leading-relaxed">
          {t('connEmpty')}
        </div>
      )}
    </div>
  );
}
