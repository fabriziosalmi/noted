import { useMemo } from 'react';
import { ArrowDown, ArrowUp, Check } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { useViewRows } from '../hooks/useViewRows';
import { useFieldSchema } from '../hooks/useFieldSchema';
import { cellFor, cellText } from '../lib/viewCells';
import { MODIFIED_FIELD, NAME_FIELD, cycleSort, valueOf } from '../../shared/views/query';
import type { View } from '../../shared/views/model';

/** With no columns chosen yet, a view shows the fields most notes have. */
const DEFAULT_COLUMNS = 6;

/**
 * A view as a table: one row per note, the note's name first (it opens the note), then the chosen frontmatter fields.
 * Read-only here; clicking a header sorts.
 */
export function ViewTable({ view, onOpenNote }: { view: View; onOpenNote: (name: string) => void }) {
  const { t } = useI18n();
  const rows = useViewRows(view);
  const schema = useFieldSchema();
  const updateView = useStore(s => s.updateView);
  const indexed = useStore(s => s.vaultIndexSync !== null);

  const columns = useMemo(
    () => (view.columns.length > 0 ? view.columns : schema.slice(0, DEFAULT_COLUMNS).map(f => f.name)),
    [view.columns, schema],
  );
  const typeOf = useMemo(() => new Map(schema.map(f => [f.name, f.type] as const)), [schema]);

  const label = (field: string): string => {
    if (field === NAME_FIELD) return t('viewNameColumn');
    return field === MODIFIED_FIELD ? t('viewModifiedColumn') : field;
  };
  const sortOf = (field: string) => view.sort.find(s => s.field === field)?.dir;
  const ariaSort = (field: string): 'ascending' | 'descending' | 'none' => {
    const dir = sortOf(field);
    if (!dir) return 'none';
    return dir === 'asc' ? 'ascending' : 'descending';
  };

  if (!indexed) {
    return <div className="p-6 text-sm text-gray-400 dark:text-gray-500" role="status">{t('viewLoading')}</div>;
  }

  const headers = [NAME_FIELD, ...columns];
  return (
    <div className="flex-1 overflow-auto" data-testid="view-table">
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 bg-[var(--bg-primary,white)] dark:bg-gray-900 z-10">
          <tr>
            {headers.map(field => {
              const dir = sortOf(field);
              return (
                <th key={field} scope="col" aria-sort={ariaSort(field)} className="text-left font-medium text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 px-3 py-2 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => { void updateView(view.id, { sort: cycleSort(view.sort, field) }); }}
                    aria-label={t('viewSortBy').replace('{field}', label(field))}
                    className="inline-flex items-center gap-1 hover:text-[var(--accent)]"
                  >
                    {label(field)}
                    {dir === 'asc' && <ArrowUp size={12} aria-hidden="true" />}
                    {dir === 'desc' && <ArrowDown size={12} aria-hidden="true" />}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.name} data-row={row.name} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40">
              <th scope="row" className="text-left font-medium px-3 py-1.5 max-w-xs truncate">
                <button type="button" onClick={() => onOpenNote(row.name)} title={row.folder ? `${row.folder}/${row.title}` : row.title} className="text-[var(--accent)] hover:underline truncate max-w-full">
                  {row.title}
                </button>
              </th>
              {columns.map(field => {
                if (field === MODIFIED_FIELD) {
                  return <td key={field} className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{new Date(row.modified).toLocaleDateString()}</td>;
                }
                const cell = cellFor(valueOf(row, field), typeOf.get(field) ?? 'text');
                return (
                  <td key={field} data-field={field} className={`px-3 py-1.5 ${cell.kind === 'text' && cell.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                    {cell.kind === 'text' && cell.text}
                    {cell.kind === 'check' && (
                      <span role="img" aria-label={cell.checked ? '✓' : ''} className={`inline-flex w-4 h-4 items-center justify-center rounded border ${cell.checked ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : 'border-gray-300 dark:border-gray-600'}`}>
                        {cell.checked && <Check size={11} aria-hidden="true" />}
                      </span>
                    )}
                    {cell.kind === 'chips' && (
                      <span className="inline-flex flex-wrap gap-1" title={cellText(cell)}>
                        {cell.items.map(item => (
                          <span key={item} className="px-1.5 py-0.5 rounded-full text-xs bg-[var(--accent-light)] text-[var(--accent)]">{item}</span>
                        ))}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="p-6 text-sm text-gray-400 dark:text-gray-500" role="status">{t('viewNoRows')}</div>}
    </div>
  );
}
