import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../lib/i18n';

interface ShortcutRow {
  keys: string[];
  descriptionKey: string;
}

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

export function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
  const { t } = useI18n();

  const SECTIONS: { titleKey: string; rows: ShortcutRow[] }[] = [
    {
      titleKey: 'sectionGeneral',
      rows: [
        { keys: ['⌘', 'P'], descriptionKey: 'shortcutQuickOpen' },
        { keys: ['⌘', 'S'], descriptionKey: 'shortcutSave' },
        { keys: ['⌘', 'F'], descriptionKey: 'shortcutFind' },
        { keys: ['⌘', '⇧', 'F'], descriptionKey: 'shortcutFocusMode' },
        { keys: ['?'], descriptionKey: 'shortcutShowShortcuts' },
      ],
    },
    {
      titleKey: 'sectionAi',
      rows: [
        { keys: ['/'], descriptionKey: 'shortcutSlash' },
        { keys: ['Tab'], descriptionKey: 'shortcutTab' },
        { keys: ['Esc'], descriptionKey: 'shortcutEsc' },
      ],
    },
    {
      titleKey: 'sectionFormatting',
      rows: [
        { keys: ['⌘', 'B'], descriptionKey: 'shortcutBold' },
        { keys: ['⌘', 'I'], descriptionKey: 'shortcutItalic' },
        { keys: ['⌘', 'Alt', '1'], descriptionKey: 'shortcutH1' },
        { keys: ['⌘', 'Alt', '2'], descriptionKey: 'shortcutH2' },
        { keys: ['⌘', 'Alt', '3'], descriptionKey: 'shortcutH3' },
        { keys: ['⌘', '`'], descriptionKey: 'shortcutCode' },
      ],
    },
    {
      titleKey: 'sectionNotes',
      rows: [
        { keys: ['Doppio clic'], descriptionKey: 'shortcutRename' },
      ],
    },
  ];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('keyboardShortcuts')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1 rounded" aria-label={t('close')}>
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {SECTIONS.map(section => (
            <div key={section.titleKey}>
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">{t(section.titleKey as any)}</p>
              <div className="space-y-1.5">
                {section.rows.map(row => (
                  <div key={row.descriptionKey} className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-300">{t(row.descriptionKey as any)}</span>
                    <div className="flex items-center gap-1">
                      {row.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="px-1.5 py-0.5 text-xs font-mono bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
