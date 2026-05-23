import { X, ShieldAlert, FolderOpen, Lightbulb, ArrowRight, Pencil, Heading, GitMerge } from 'lucide-react';
import { useModalStack } from '../hooks/useModalStack';
import type { Suggestion, SuggestionSeverity, SuggestionKind, SuggestionActionKind } from '../lib/noteAdvisor';
import { useI18n } from '../lib/i18n';

interface NoteAdvisorProps {
  suggestions: Suggestion[];
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
  onClose: () => void;
  onAction: (s: Suggestion) => void;
}

function severityDot(severity: SuggestionSeverity) {
  const colors: Record<SuggestionSeverity, string> = {
    high: 'bg-red-500',
    medium: 'bg-amber-400',
    low: 'bg-blue-400',
  };
  return <span className={`w-2 h-2 rounded-full shrink-0 ${colors[severity]}`} />;
}

function kindIcon(kind: SuggestionKind) {
  if (kind.startsWith('secret')) return <ShieldAlert size={14} className="text-red-400 shrink-0" />;
  return <FolderOpen size={14} className="text-blue-400 shrink-0" />;
}

function actionIcon(action: SuggestionActionKind) {
  if (action === 'rename') return <Pencil size={12} />;
  if (action === 'addHeadings') return <Heading size={12} />;
  if (action === 'merge') return <GitMerge size={12} />;
  return <ArrowRight size={12} />;
}

// Resolve {key} placeholders in an i18n template, with the special convention
// that any param whose key ends in "Key" is itself an i18n key (re-translated).
function interpolate(
  template: string,
  params: Record<string, string | number> | undefined,
  t: (k: string) => string,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    // Look up either the direct param name, or `${name}Key` for nested lookup.
    if (name in params) {
      const v = params[name];
      return String(v);
    }
    const keyName = `${name}Key`;
    if (keyName in params) {
      return t(String(params[keyName]));
    }
    return `{${name}}`;
  });
}

export function NoteAdvisorPanel({ suggestions, onDismiss, onDismissAll, onClose, onAction }: NoteAdvisorProps) {
  const { t: tStrict } = useI18n();
  useModalStack('advisor', true, onClose);
  // Suggestion keys are built dynamically; cast to a string-keyed function for
  // the runtime lookups while keeping the typed `tStrict` for static keys.
  const t = tStrict as unknown as (k: string) => string;

  function severityLabel(severity: SuggestionSeverity) {
    if (severity === 'high') return <span className="text-[10px] font-semibold text-red-500 uppercase">{t('highPriority')}</span>;
    if (severity === 'medium') return <span className="text-[10px] font-semibold text-amber-500 uppercase">{t('medium')}</span>;
    return <span className="text-[10px] font-semibold text-blue-400 uppercase">{t('suggestion')}</span>;
  }

  function actionLabel(action: SuggestionActionKind): string {
    switch (action) {
      case 'rename': return t('advActionRename');
      case 'addHeadings': return t('advActionAddHeadings');
      case 'openFirst': return t('advActionOpenFirst');
      case 'merge': return t('advActionMerge');
      default: return t('advActionOpen');
    }
  }

  return (
    <div className="fixed right-4 bottom-14 z-40 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[70vh]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <Lightbulb size={14} className="text-amber-500" />
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('noteAdvisor')}</span>
          {suggestions.length > 0 && (
            <span className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full font-medium">
              {suggestions.length}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-0.5 rounded"
          aria-label={t('closeAdvisor')}
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Lightbulb size={28} className="text-gray-200 dark:text-gray-700 mb-2" />
            <p className="text-sm text-gray-400 dark:text-gray-500">{t('noSuggestions')}</p>
            <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">{t('notesInOrder')}</p>
          </div>
        ) : (
          suggestions.map(s => {
            const title = interpolate(t(s.titleKey), s.titleParams, t);
            const detail = interpolate(t(s.detailKey), s.detailParams, t);
            return (
              <div
                key={s.id}
                className="group bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg p-3"
              >
                <div className="flex items-start gap-2">
                  {kindIcon(s.kind)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      {severityDot(s.severity)}
                      {severityLabel(s.severity)}
                    </div>
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">{title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{detail}</p>
                    {s.relatedNotes && s.relatedNotes.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {[s.noteName, ...s.relatedNotes].map(n => (
                          <span key={n} className="text-[10px] bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">
                            {n.replace('.md', '')}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => onAction(s)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] bg-[var(--accent-light)] hover:bg-[var(--accent-mid)] px-2 py-1 rounded transition-colors"
                      >
                        {actionIcon(s.action)}
                        {actionLabel(s.action)}
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => onDismiss(s.id)}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-500 dark:hover:text-gray-300 shrink-0 p-0.5 rounded transition-opacity"
                    aria-label={t('dismissSuggestion')}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {suggestions.length > 1 && (
        <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <button
            onClick={onDismissAll}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 w-full text-center"
          >
            {t('dismissAll')}
          </button>
        </div>
      )}
    </div>
  );
}

interface NoteAdvisorBadgeProps {
  count: number;
  onClick: () => void;
}

export function NoteAdvisorBadge({ count, onClick }: NoteAdvisorBadgeProps) {
  const { t } = useI18n();
  return (
    <button
      onClick={onClick}
      className="relative p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 hover:text-amber-500 dark:hover:text-amber-400 transition-colors"
      title={t('noteAdvisor')}
      aria-label={`${t('noteAdvisor')}${count > 0 ? ` — ${count}` : ''}`}
    >
      <Lightbulb size={16} />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-amber-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}
