import { useState, useEffect, useCallback } from 'react';
import { X, RotateCcw, Clock } from 'lucide-react';
import { useModalStack } from '../hooks/useModalStack';
import { useI18n } from '../lib/i18n';

interface Snapshot { name: string; ts: string }

interface NoteHistoryModalProps {
  fileName: string;
  syncDir?: string | null;
  onRestore: (content: string) => void;
  onClose: () => void;
}

export function NoteHistoryModal({ fileName, syncDir, onRestore, onClose }: NoteHistoryModalProps) {
  useModalStack('history', true, onClose);
  const { t } = useI18n();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [selected, setSelected] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(!!window.electronAPI);

  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.getNoteHistory(fileName, syncDir ?? undefined).then(res => {
      if (res.success && res.data) setSnapshots(res.data);
      setLoading(false);
    });
  }, [fileName, syncDir]);

  const loadPreview = useCallback(async (snap: Snapshot) => {
    setSelected(snap);
    if (!window.electronAPI) return;
    const res = await window.electronAPI.readNoteSnapshot(fileName, snap.name, syncDir ?? undefined);
    if (res.success && res.data) setPreview(res.data);
  }, [fileName, syncDir]);

  const handleRestore = useCallback(() => {
    if (preview) { onRestore(preview); onClose(); }
  }, [preview, onRestore, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[700px] max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Clock size={15} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('historyTitle')} — {fileName.replace('.md', '')}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={16} /></button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Snapshot list */}
          <div className="w-48 border-r border-gray-100 dark:border-gray-700 overflow-y-auto shrink-0">
            {loading && <p className="text-xs text-gray-400 p-4">{t('loading')}</p>}
            {!loading && snapshots.length === 0 && (
              <p className="text-xs text-gray-400 p-4">{t('noVersions')}</p>
            )}
            {snapshots.map(snap => (
              <button
                key={snap.name}
                onClick={() => void loadPreview(snap)}
                className={`w-full text-left px-3 py-2 text-xs border-b border-gray-50 dark:border-gray-700/50 transition-colors ${selected?.name === snap.name ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-600 dark:text-gray-400'}`}
              >
                {snap.ts}
              </button>
            ))}
          </div>

          {/* Preview */}
          <div className="flex-1 overflow-y-auto p-4">
            {preview ? (
              <div className="prose prose-sm dark:prose-invert max-w-none text-xs" dangerouslySetInnerHTML={{ __html: preview }} />
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-8 text-center">{t('selectVersion')}</p>
            )}
          </div>
        </div>

        {selected && preview && (
          <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end">
            <button
              onClick={handleRestore}
              className="flex items-center gap-2 text-sm px-4 py-1.5 text-white rounded-lg hover:opacity-90 transition-opacity"
              style={{ background: 'var(--accent)' } as React.CSSProperties}
            >
              <RotateCcw size={13} />
              {t('restoreVersion')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
