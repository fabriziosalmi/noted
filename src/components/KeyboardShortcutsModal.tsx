import { useEffect } from 'react';
import { X } from 'lucide-react';

interface ShortcutRow {
  keys: string[];
  description: string;
}

const SECTIONS: { title: string; rows: ShortcutRow[] }[] = [
  {
    title: 'Generale',
    rows: [
      { keys: ['⌘', 'S'], description: 'Salva immediatamente' },
      { keys: ['⌘', 'F'], description: 'Cerca nel documento' },
      { keys: ['?'], description: 'Mostra questa finestra' },
    ],
  },
  {
    title: 'Formattazione',
    rows: [
      { keys: ['⌘', 'B'], description: 'Grassetto' },
      { keys: ['⌘', 'I'], description: 'Corsivo' },
      { keys: ['⌘', 'Alt', '1'], description: 'Titolo 1' },
      { keys: ['⌘', 'Alt', '2'], description: 'Titolo 2' },
      { keys: ['⌘', 'Alt', '3'], description: 'Titolo 3' },
      { keys: ['⌘', '`'], description: 'Codice inline' },
    ],
  },
  {
    title: 'Note',
    rows: [
      { keys: ['Doppio clic'], description: 'Rinomina nota' },
    ],
  },
];

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

export function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
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
        className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Scorciatoie da tastiera</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1 rounded" aria-label="Chiudi">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {SECTIONS.map(section => (
            <div key={section.title}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{section.title}</p>
              <div className="space-y-1.5">
                {section.rows.map(row => (
                  <div key={row.description} className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">{row.description}</span>
                    <div className="flex items-center gap-1">
                      {row.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="px-1.5 py-0.5 text-xs font-mono bg-gray-100 border border-gray-300 rounded text-gray-700"
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
