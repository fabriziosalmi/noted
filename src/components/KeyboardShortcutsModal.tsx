import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/i18n';
import { Modal } from './Modal';
import { useStore } from '../store/useStore';
import { modKey, shiftKey } from '../lib/platform';

interface ShortcutRow {
  keys: string[];
  descriptionKey: TranslationKey;
}

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

export function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
  const { t } = useI18n();
  const updateSettings = useStore(s => s.updateSettings);
  // Opening the shortcuts reference completes the onboarding "shortcuts" step.
  useEffect(() => { updateSettings({ shortcutsSeen: true }); }, [updateSettings]);

  const SECTIONS: { titleKey: TranslationKey; rows: ShortcutRow[] }[] = [
    {
      titleKey: 'sectionGeneral',
      rows: [
        { keys: [modKey, 'P'], descriptionKey: 'shortcutQuickOpen' },
        { keys: [modKey, shiftKey, 'F'], descriptionKey: 'shortcutSearchAll' },
        { keys: [modKey, 'S'], descriptionKey: 'shortcutSave' },
        { keys: [modKey, 'F'], descriptionKey: 'shortcutFind' },
        { keys: [modKey, '\\'], descriptionKey: 'shortcutFocusMode' },
        { keys: [modKey, 'Z'], descriptionKey: 'shortcutUndo' },
        { keys: [modKey, shiftKey, 'Z'], descriptionKey: 'shortcutRedo' },
        { keys: ['?'], descriptionKey: 'shortcutShowShortcuts' },
      ],
    },
    {
      titleKey: 'sectionAi',
      rows: [
        { keys: ['/'], descriptionKey: 'shortcutSlash' },
        { keys: [modKey, 'L'], descriptionKey: 'shortcutGhostManual' },
        { keys: ['Tab'], descriptionKey: 'shortcutTab' },
        { keys: ['Esc'], descriptionKey: 'shortcutEsc' },
      ],
    },
    {
      titleKey: 'sectionFormatting',
      rows: [
        { keys: [modKey, 'B'], descriptionKey: 'shortcutBold' },
        { keys: [modKey, 'I'], descriptionKey: 'shortcutItalic' },
        { keys: [modKey, 'Alt', '1'], descriptionKey: 'shortcutH1' },
        { keys: [modKey, 'Alt', '2'], descriptionKey: 'shortcutH2' },
        { keys: [modKey, 'Alt', '3'], descriptionKey: 'shortcutH3' },
        { keys: [modKey, 'E'], descriptionKey: 'shortcutCode' },
      ],
    },
    {
      titleKey: 'sectionNotes',
      rows: [
        { keys: [modKey, 'N'], descriptionKey: 'shortcutNewNote' },
        { keys: [modKey, shiftKey, 'Space'], descriptionKey: 'shortcutQuickCapture' },
        { keys: [t('gestureDoubleClick')], descriptionKey: 'shortcutRename' },
      ],
    },
  ];

  return (
    <Modal id="shortcuts" onClose={onClose} labelledBy="shortcuts-title" className="w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100/40 dark:border-gray-700/40">
          <h2 id="shortcuts-title" className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('keyboardShortcuts')}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1 rounded" aria-label={t('close')}>
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {SECTIONS.map(section => (
            <div key={section.titleKey}>
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">{t(section.titleKey)}</p>
              <div className="space-y-1.5">
                {section.rows.map(row => (
                  <div key={row.descriptionKey} className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-300">{t(row.descriptionKey)}</span>
                    <div className="flex items-center gap-1">
                      {row.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="px-1.5 py-0.5 text-xs font-mono bg-gray-100/40 dark:bg-gray-800/30 border border-gray-200/40 dark:border-gray-700/40 rounded text-gray-700 dark:text-gray-300"
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
    </Modal>
  );
}
