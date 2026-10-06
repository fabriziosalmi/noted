import { Plus, X } from 'lucide-react';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { useFieldSchema } from '../hooks/useFieldSchema';
import { opsFor, newFilter, retarget, takesValue, operandFrom } from '../../shared/views/ops';
import { MAX_FILTERS, MAX_SORTS, type FilterOp, type View, type ViewFilter, type ViewSort } from '../../shared/views/model';
import { MODIFIED_FIELD, NAME_FIELD } from '../../shared/views/query';
import type { FieldInfo, FieldType } from '../../shared/views/schema';

const control = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-xs outline-none focus:border-[var(--accent)]';

const INPUT_TYPE: Partial<Record<FieldType, string>> = { number: 'number', date: 'date' };

/** The same filter with another test: the value stays when the new test still takes one. */
function withOp(filter: ViewFilter, op: FilterOp): ViewFilter {
  return takesValue(op) && filter.value !== undefined ? { field: filter.field, op, value: filter.value } : { field: filter.field, op };
}

/** What a filter can be asked about: the note's own name, and the frontmatter fields. */
function filterFields(schema: readonly FieldInfo[]): { name: string; type: FieldType }[] {
  return [{ name: NAME_FIELD, type: 'text' }, ...schema.map(f => ({ name: f.name, type: f.type }))];
}

/** What it can be sorted by: the same, and the modified time. */
function sortFields(schema: readonly FieldInfo[]): string[] {
  return [NAME_FIELD, ...schema.map(f => f.name), MODIFIED_FIELD];
}

/** The filters and the sort of a view, as rows to edit. Every change is saved into the view at once. */
export function ViewQueryEditor({ view }: { view: View }) {
  const { t } = useI18n();
  const schema = useFieldSchema();
  const updateView = useStore(s => s.updateView);
  const fields = filterFields(schema);
  const typeOf = (name: string): FieldType => fields.find(f => f.name === name)?.type ?? 'text';
  const fieldLabel = (name: string): string => {
    if (name === NAME_FIELD) return t('viewNameColumn');
    return name === MODIFIED_FIELD ? t('viewModifiedColumn') : name;
  };

  const setFilters = (filters: ViewFilter[]) => { void updateView(view.id, { filters }); };
  const setFilter = (i: number, next: ViewFilter) => setFilters(view.filters.map((f, k) => (k === i ? next : f)));
  const setSort = (sort: ViewSort[]) => { void updateView(view.id, { sort }); };

  const optionsOf = (field: string): string[] => schema.find(f => f.name === field)?.options.map(o => o.value) ?? [];

  return (
    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 space-y-4 text-xs" data-testid="view-query">
      <section aria-label={t('viewFilter')} className="space-y-2">
        <h2 className="font-semibold text-gray-500 uppercase tracking-wider">{t('viewFilter')}</h2>
        {view.filters.length === 0 && <p className="text-gray-400">{t('viewNoFilters')}</p>}
        {view.filters.map((filter, i) => {
          const type = typeOf(filter.field);
          const choices = type === 'select' ? optionsOf(filter.field) : [];
          return (
            <div key={i} className="flex flex-wrap items-center gap-2" data-filter={i}>
              <select aria-label={t('viewField')} value={filter.field} onChange={e => setFilter(i, retarget(filter, e.target.value, typeOf(e.target.value)))} className={control}>
                {!fields.some(f => f.name === filter.field) && <option value={filter.field}>{filter.field}</option>}
                {fields.map(f => <option key={f.name} value={f.name}>{fieldLabel(f.name)}</option>)}
              </select>
              <select aria-label={t('viewFilter')} value={filter.op} onChange={e => setFilter(i, withOp(filter, e.target.value as FilterOp))} className={control}>
                {opsFor(type).map(op => <option key={op} value={op}>{t(`filterOp_${op}` as TranslationKey)}</option>)}
              </select>
              {takesValue(filter.op) && (choices.length > 0 ? (
                <select aria-label={t('viewValue')} value={String(filter.value ?? '')} onChange={e => setFilter(i, { ...filter, value: operandFrom(type, e.target.value) })} className={control}>
                  <option value="" />
                  {choices.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <input
                  aria-label={t('viewValue')}
                  type={INPUT_TYPE[type] ?? 'text'}
                  value={String(filter.value ?? '')}
                  onChange={e => setFilter(i, { ...filter, value: operandFrom(type, e.target.value) })}
                  className={control}
                />
              ))}
              <button type="button" onClick={() => setFilters(view.filters.filter((_, k) => k !== i))} aria-label={t('viewRemove')} title={t('viewRemove')} className="p-1 text-gray-400 hover:text-red-500">
                <X size={12} />
              </button>
            </div>
          );
        })}
        {view.filters.length < MAX_FILTERS && (
          <button type="button" onClick={() => setFilters([...view.filters, newFilter(fields[1]?.name ?? NAME_FIELD, fields[1]?.type ?? 'text')])} className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline">
            <Plus size={12} /> {t('viewAddFilter')}
          </button>
        )}
      </section>

      <section aria-label={t('viewSort')} className="space-y-2">
        <h2 className="font-semibold text-gray-500 uppercase tracking-wider">{t('viewSort')}</h2>
        {view.sort.length === 0 && <p className="text-gray-400">{t('viewNoSort')}</p>}
        {view.sort.map((key, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2" data-sort={i}>
            <span className="text-gray-400 w-12">{i === 0 ? t('viewSort') : t('viewThenBy')}</span>
            <select aria-label={t('viewField')} value={key.field} onChange={e => setSort(view.sort.map((s, k) => (k === i ? { ...s, field: e.target.value } : s)))} className={control}>
              {!sortFields(schema).includes(key.field) && <option value={key.field}>{key.field}</option>}
              {sortFields(schema).map(name => <option key={name} value={name}>{fieldLabel(name)}</option>)}
            </select>
            <select aria-label={t('viewSort')} value={key.dir} onChange={e => setSort(view.sort.map((s, k) => (k === i ? { ...s, dir: e.target.value as ViewSort['dir'] } : s)))} className={control}>
              <option value="asc">{t('viewAscending')}</option>
              <option value="desc">{t('viewDescending')}</option>
            </select>
            <button type="button" onClick={() => setSort(view.sort.filter((_, k) => k !== i))} aria-label={t('viewRemove')} title={t('viewRemove')} className="p-1 text-gray-400 hover:text-red-500">
              <X size={12} />
            </button>
          </div>
        ))}
        {view.sort.length < MAX_SORTS && (
          <button type="button" onClick={() => setSort([...view.sort, { field: sortFields(schema).find(f => !view.sort.some(s => s.field === f)) ?? NAME_FIELD, dir: 'asc' }])} className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline">
            <Plus size={12} /> {t('viewAddSort')}
          </button>
        )}
      </section>
    </div>
  );
}
