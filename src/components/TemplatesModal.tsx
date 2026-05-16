import { useState } from 'react';
import { X, Trash2, Plus } from 'lucide-react';
import { BUILTIN_TEMPLATES, type NoteTemplate } from '../lib/templates';

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
  const [savingName, setSavingName] = useState('');
  const [showSave, setShowSave] = useState(false);

  const handleSave = () => {
    const name = savingName.trim() || (activeNoteName?.replace('.md', '') ?? 'Template');
    onSaveCurrent(name, activeNoteContent);
    setSavingName('');
    setShowSave(false);
  };

  const allTemplates = [...BUILTIN_TEMPLATES, ...customTemplates];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-96 max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Template</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {allTemplates.map(t => (
            <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 group">
              <span className="text-xl shrink-0">{t.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{t.name}</p>
                {t.id.startsWith('custom_') && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">Personalizzato</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => { onApply(t); onClose(); }}
                  className="text-xs px-2 py-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
                >
                  Usa
                </button>
                {t.id.startsWith('custom_') && (
                  <button onClick={() => onDelete(t.id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 p-1">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {activeNoteName && (
          <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3">
            {showSave ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  type="text"
                  value={savingName}
                  onChange={e => setSavingName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setShowSave(false); }}
                  placeholder={activeNoteName.replace('.md', '')}
                  className="flex-1 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 outline-none focus:border-indigo-400 dark:text-gray-200"
                />
                <button onClick={handleSave} className="text-xs px-3 py-1 bg-indigo-500 text-white rounded hover:bg-indigo-600">Salva</button>
                <button onClick={() => setShowSave(false)} className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700"><X size={13} /></button>
              </div>
            ) : (
              <button
                onClick={() => setShowSave(true)}
                className="w-full flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 py-1"
              >
                <Plus size={13} />
                Salva nota corrente come template
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
