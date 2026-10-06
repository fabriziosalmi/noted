import { useState } from 'react';
import { ArrowLeft, Columns3, ListFilter, Settings2, Table2 } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { useViewRows } from '../hooks/useViewRows';
import { ViewTable } from './ViewTable';
import { ViewBoard } from './ViewBoard';
import { ViewSettings } from './ViewSettings';
import { ViewQueryEditor } from './ViewQueryEditor';
import type { View } from '../../shared/views/model';

/** A saved view in the main area: its name, how many notes it shows, its settings, and the table. */
export function ViewPage({ view, onOpenNote, onNotice }: {
  view: View;
  onOpenNote: (name: string) => void;
  onNotice?: (message: string, variant?: 'success' | 'error') => void;
}) {
  const { t } = useI18n();
  const rows = useViewRows(view);
  const [configuring, setConfiguring] = useState(false);
  const [querying, setQuerying] = useState(false);
  const active = view.filters.length + view.sort.length;
  const closeView = useStore(s => s.closeView);
  const updateView = useStore(s => s.updateView);

  return (
    <section aria-label={view.name} className="flex-1 flex flex-col overflow-hidden" data-testid="view-page">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <button type="button" onClick={closeView} aria-label={t('viewClose')} title={t('viewClose')} className="p-1 rounded text-gray-500 hover:text-[var(--accent)] hover:bg-gray-100 dark:hover:bg-gray-800">
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-lg font-semibold truncate">{view.name}</h1>
        <span className="text-xs text-gray-400" data-testid="view-count">{t('viewRowCount').replace('{n}', String(rows.length))}</span>
        <div role="group" aria-label={t('viewLayout')} className="ml-auto flex rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
          {([['table', Table2, 'viewLayoutTable'], ['board', Columns3, 'viewLayoutBoard']] as const).map(([layout, Icon, label]) => (
            <button
              key={layout}
              type="button"
              aria-pressed={view.layout === layout}
              aria-label={t(label)}
              title={t(label)}
              onClick={() => { if (view.layout !== layout) void updateView(view.id, { layout }); }}
              className={`px-2 py-1 ${view.layout === layout ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'text-gray-500 hover:text-[var(--accent)]'}`}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setQuerying(v => !v)}
          aria-pressed={querying}
          aria-label={t('viewFilterPanel')}
          title={t('viewFilterPanel')}
          className={`relative p-1 rounded ${querying ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'text-gray-500 hover:text-[var(--accent)] hover:bg-gray-100 dark:hover:bg-gray-800'}`}
        >
          <ListFilter size={16} />
          {active > 0 && <span data-testid="view-query-count" className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-[var(--accent)] text-white text-[9px] leading-[14px] text-center">{active}</span>}
        </button>
        <button
          type="button"
          onClick={() => setConfiguring(v => !v)}
          aria-pressed={configuring}
          aria-label={t('viewConfigure')}
          title={t('viewConfigure')}
          className={`p-1 rounded ${configuring ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'text-gray-500 hover:text-[var(--accent)] hover:bg-gray-100 dark:hover:bg-gray-800'}`}
        >
          <Settings2 size={16} />
        </button>
      </header>
      {querying && <ViewQueryEditor view={view} />}
      {configuring && <ViewSettings view={view} />}
      {view.layout === 'board'
        ? <ViewBoard view={view} onOpenNote={onOpenNote} onNotice={onNotice} />
        : <ViewTable view={view} onOpenNote={onOpenNote} onNotice={onNotice} />}
    </section>
  );
}
