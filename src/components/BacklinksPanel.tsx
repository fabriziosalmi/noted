import { Link2 } from 'lucide-react';
import { useI18n } from '../lib/i18n';

interface BacklinksPanelProps {
  activeNoteName: string;
  backlinks: string[]; // note names that link to active note
  onSelectNote: (name: string) => void;
}

export function BacklinksPanel({ activeNoteName, backlinks, onSelectNote }: BacklinksPanelProps) {
  const { t } = useI18n();
  if (backlinks.length === 0) return null;
  const baseName = activeNoteName.replace(/\.md$/, '');

  return (
    <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
      <div className="flex items-center gap-1.5 mb-2">
        <Link2 size={12} className="text-gray-400 dark:text-gray-500" />
        <span className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
          {t('backlinksLabel')} — {backlinks.length} {t(backlinks.length !== 1 ? 'backlinksHeader_other' : 'backlinksHeader_one')} "{baseName}"
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {backlinks.map(name => (
          <button
            key={name}
            onClick={() => onSelectNote(name)}
            className="text-xs px-2.5 py-1 rounded-full transition-colors hover:opacity-80"
            style={{ background: 'var(--accent-light)', color: 'var(--accent)' } as React.CSSProperties}
          >
            [[{name.replace(/\.md$/, '')}]]
          </button>
        ))}
      </div>
    </div>
  );
}
