import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderGit2, ArrowDownLeft, ArrowUpRight, Link2 } from 'lucide-react';
import { backlinksOf } from '../lib/backlinks';
import { useStore } from '../store/useStore';
import { useI18n } from '../lib/i18n';
import { getElectronApi } from '../lib/electronApi';
import type { UnlinkedMention } from '../types';

const MENTIONS_DEBOUNCE_MS = 400;

/** Notes that write this note's name as plain text without linking to it, and the one-click way to link them. */
function useUnlinkedMentions(noteName: string | null, backlinkCount: number) {
  const syncDir = useStore(s => s.settings.syncDirectory) || undefined;
  const [items, setItems] = useState<UnlinkedMention[]>([]);
  const token = useRef(0);

  // Again when the note changes, and when what links to it does (a link made here, or elsewhere).
  useEffect(() => {
    const mine = ++token.current;
    setItems([]);
    const api = getElectronApi();
    if (!noteName || !api?.unlinkedMentions) return;
    const timer = setTimeout(() => {
      void api.unlinkedMentions(noteName, syncDir).then(res => {
        if (mine === token.current && res.success) setItems(res.data?.items ?? []);
      }).catch(() => undefined);
    }, MENTIONS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [noteName, syncDir, backlinkCount]);

  const link = useCallback(async (source: string): Promise<boolean> => {
    const api = getElectronApi();
    if (!noteName || !api?.linkMention) return false;
    const res = await api.linkMention(source, noteName, syncDir);
    if (!res.success) return false;
    // The note links to this one now, so it is a backlink and no longer an unlinked mention, whatever else it says.
    setItems(prev => prev.filter(i => i.name !== source));
    return true;
  }, [noteName, syncDir]);

  return { items, link };
}

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
  const noteAliasesIndex = useStore(s => s.noteAliasesIndex);
  const tagIndex = useStore(s => s.tagIndex);

  const { outgoing, backlinks, projectTags, projectSiblings } = useMemo(() => {
    if (!activeNoteName) {
      return { outgoing: [] as string[], backlinks: [] as string[], projectTags: [] as string[], projectSiblings: [] as string[] };
    }
    const outgoing = [...new Set(noteLinksIndex[activeNoteName] ?? [])];
    const backlinks = backlinksOf(noteLinksIndex, activeNoteName, noteAliasesIndex);
    const projectTags = Object.keys(tagIndex)
      .filter(tag => tag.startsWith('#project/') && tagIndex[tag].includes(activeNoteName));
    const sib = new Set<string>();
    for (const tag of projectTags) for (const n of tagIndex[tag]) if (n !== activeNoteName) sib.add(n);
    return { outgoing, backlinks, projectTags, projectSiblings: [...sib] };
  }, [activeNoteName, noteLinksIndex, noteAliasesIndex, tagIndex]);

  const mentions = useUnlinkedMentions(activeNoteName, backlinks.length);

  if (!activeNoteName) {
    return <div className="p-4 text-sm text-gray-400 dark:text-gray-500">{t('connNoActive')}</div>;
  }

  const nothing = !projectTags.length && !backlinks.length && !outgoing.length && mentions.items.length === 0;

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

      {mentions.items.length > 0 && (
        <div className="mb-5" data-testid="unlinked-mentions">
          <div className="flex items-center gap-1.5 mb-2">
            <Link2 size={12} className="text-gray-400 shrink-0" />
            <span className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider truncate">{t('connMentions')}</span>
          </div>
          <ul className="space-y-2">
            {mentions.items.map(item => (
              <li key={item.name} className="text-xs" data-mention={item.name}>
                <div className="flex items-center gap-2">
                  <Chip name={item.name} onOpen={onOpenNote} />
                  {item.count > 1 && <span className="text-[10px] text-gray-400">{t('connMentionCount').replace('{n}', String(item.count))}</span>}
                  <button
                    type="button"
                    onClick={() => { void mentions.link(item.name); }}
                    aria-label={`${t('connMentionLink')}: ${item.name.replace(/\.md$/, '')}`}
                    className="ml-auto shrink-0 px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-[var(--accent)] hover:border-[var(--accent)]"
                  >
                    {t('connMentionLink')}
                  </button>
                </div>
                <p className="mt-1 text-gray-500 dark:text-gray-400 leading-snug">
                  {item.snippet.before}<mark className="bg-transparent text-[var(--accent)] font-medium">{item.snippet.match}</mark>{item.snippet.after}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {nothing && (
        <div className="text-sm text-gray-400 dark:text-gray-500 leading-relaxed">
          {t('connEmpty')}
        </div>
      )}
    </div>
  );
}
