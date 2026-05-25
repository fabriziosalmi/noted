import { useState, useEffect, useRef } from 'react';
import {
  X, Trash2, Plus,
  Users, Rocket, FlaskConical, BookOpen, Lightbulb, FileText,
} from 'lucide-react';
import { Modal } from './Modal';
import { BUILTIN_TEMPLATES, type NoteTemplate, type TemplateIconName } from '../lib/templates';
import { useI18n } from '../lib/i18n';

const TEMPLATE_ICON_MAP: Record<TemplateIconName, typeof Users> = {
  meeting:    Users,
  project:    Rocket,
  research:   FlaskConical,
  journal:    BookOpen,
  brainstorm: Lightbulb,
  custom:     FileText,
};

function TemplateIcon({ name }: { name: TemplateIconName }) {
  const Icon = TEMPLATE_ICON_MAP[name] ?? FileText;
  return <Icon size={16} strokeWidth={1.6} className="text-gray-500 dark:text-gray-400" />;
}

interface TemplatesModalProps {
  customTemplates: NoteTemplate[];
  activeNoteContent: string;
  activeNoteName: string | null;
  onApply: (template: NoteTemplate) => void;
  onSaveCurrent: (name: string, content: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function TemplatesModal({ customTemplates, activeNoteContent, activeNoteName, onApply, onSaveCurrent, onDelete, onClose }: TemplatesModalProps) {
  const { t } = useI18n();
  const [savingName, setSavingName] = useState('');
  const [showSave, setShowSave] = useState(false);
  const saveInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showSave) saveInputRef.current?.focus();
  }, [showSave]);

  const handleSave = () => {
    const name = savingName.trim() || (activeNoteName?.replace('.md', '') ?? 'Template');
    onSaveCurrent(name, activeNoteContent);
    setSavingName('');
    setShowSave(false);
  };

  const allTemplates = [...BUILTIN_TEMPLATES, ...customTemplates];

  return (
    <Modal id="templates" onClose={onClose} labelledBy="templates-title" className="w-96 max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100/40 dark:border-gray-700/40">
          <h2 id="templates-title" className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('templatesTitle')}</h2>
          <button type="button" onClick={onClose} aria-label={t('close')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {allTemplates.map(tmpl => (
            <div key={tmpl.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100/40 dark:border-gray-700/40 hover:bg-gray-50/40 dark:hover:bg-gray-800/30 group">
              <span className="shrink-0 w-7 h-7 rounded-md bg-gray-50/40 dark:bg-gray-900/30 border border-gray-100/40 dark:border-gray-700/40 flex items-center justify-center">
                <TemplateIcon name={tmpl.icon} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{tmpl.name}</p>
                {tmpl.id.startsWith('custom_') && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">{t('custom')}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => { onApply(tmpl); onClose(); }}
                  className="text-xs px-2 py-1 bg-[var(--accent-light)] text-[var(--accent)] rounded hover:bg-[var(--accent-mid)]"
                >
                  {t('use')}
                </button>
                {tmpl.id.startsWith('custom_') && (
                  <button type="button" onClick={() => onDelete(tmpl.id)} aria-label={t('deleteTemplate')} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 p-1">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {activeNoteName && (
          <div className="px-4 pb-4 border-t border-gray-100/40 dark:border-gray-700/40 pt-3">
            {showSave ? (
              <div className="flex gap-2">
                <input
                  ref={saveInputRef}
                  type="text"
                  value={savingName}
                  onChange={e => setSavingName(e.target.value)}
                  onKeyDown={e => {
                    if (e.nativeEvent.isComposing || e.repeat) return;
                    if (e.key === 'Enter') handleSave();
                    if (e.key === 'Escape') setShowSave(false);
                  }}
                  placeholder={activeNoteName.replace('.md', '')}
                  className="flex-1 text-sm bg-gray-50/40 dark:bg-gray-800/25 border border-gray-200/40 dark:border-gray-700/40 rounded px-2 py-1 outline-none focus:border-[var(--accent)] dark:text-gray-200"
                />
                <button type="button" onClick={handleSave} className="btn-primary text-xs px-3 py-1 rounded">{t('save')}</button>
                <button type="button" onClick={() => setShowSave(false)} aria-label={t('cancel')} className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700"><X size={13} /></button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowSave(true)}
                className="w-full flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400 hover:text-[var(--accent)] py-1"
              >
                <Plus size={13} />
                {t('saveCurrentNote')}
              </button>
            )}
          </div>
        )}
    </Modal>
  );
}
