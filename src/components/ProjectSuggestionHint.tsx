import { FolderGit2, X } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import type { ProjectSuggestion } from '../lib/projectSuggestion';

/**
 * Capture-time nudge: when the title you're typing recurs across notes, offer
 * to group them into a #project/ so they stop living as separate notes.
 */
export function ProjectSuggestionHint({ suggestion, onAccept, onDismiss }: {
  suggestion: ProjectSuggestion;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const count = suggestion.matches.length + 1;
  return (
    <div
      className="mx-auto max-w-3xl mb-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs border"
      style={{ background: 'var(--accent-light)', borderColor: 'var(--accent)' } as React.CSSProperties}
    >
      <FolderGit2 size={13} style={{ color: 'var(--accent)' }} className="shrink-0" />
      <span className="flex-1 text-gray-700 dark:text-gray-200 min-w-0">
        {count} {t('projectHintNotes')} "{suggestion.label}" — {t('projectHintCta')}
      </span>
      <button
        type="button"
        onClick={onAccept}
        className="shrink-0 px-2 py-1 rounded font-medium text-white hover:opacity-90"
        style={{ background: 'var(--accent)' } as React.CSSProperties}
      >
        {t('projectHintGroup')} {suggestion.tag}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('close')}
        className="shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-0.5"
      >
        <X size={13} />
      </button>
    </div>
  );
}
