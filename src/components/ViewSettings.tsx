import { useI18n } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { useFieldSchema } from '../hooks/useFieldSchema';
import { MODIFIED_FIELD } from '../../shared/views/query';
import { groupableFields } from '../../shared/views/board';
import type { View, ViewSource } from '../../shared/views/model';

const inputClass = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-xs outline-none focus:border-[var(--accent)]';

/** Where a view's notes come from, and which fields are its columns. */
export function ViewSettings({ view }: { view: View }) {
  const { t } = useI18n();
  const schema = useFieldSchema();
  const updateView = useStore(s => s.updateView);
  const folders = useStore(s => s.noteFolders);
  const tagIndex = useStore(s => s.tagIndex);

  const kind = view.source.kind;
  const setSource = (source: ViewSource) => { void updateView(view.id, { source }); };
  const toggleColumn = (field: string) => {
    const columns = view.columns.includes(field) ? view.columns.filter(c => c !== field) : [...view.columns, field];
    void updateView(view.id, { columns });
  };
  const fields = [...schema.map(f => f.name), MODIFIED_FIELD];

  return (
    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex flex-wrap gap-x-8 gap-y-3 text-xs" data-testid="view-settings">
      <div className="flex items-center gap-2">
        <label htmlFor={`src-${view.id}`} className="text-gray-500">{t('viewSource')}</label>
        <select
          id={`src-${view.id}`}
          value={kind}
          onChange={e => {
            const next = e.target.value;
            if (next === 'folder') setSource({ kind: 'folder', folder: folders[0]?.name ?? 'Folder' });
            else if (next === 'tag') setSource({ kind: 'tag', tag: Object.keys(tagIndex)[0] ?? '#tag' });
            else setSource({ kind: 'all' });
          }}
          className={inputClass}
        >
          <option value="all">{t('viewSourceAll')}</option>
          <option value="folder">{t('viewSourceFolder')}</option>
          <option value="tag">{t('viewSourceTag')}</option>
        </select>
        {view.source.kind === 'folder' && (
          <>
            <input
              aria-label={t('viewSourceFolder')}
              list={`folders-${view.id}`}
              defaultValue={view.source.folder}
              key={view.source.folder}
              placeholder={t('viewFolderPlaceholder')}
              onBlur={e => { if (e.target.value.trim()) setSource({ kind: 'folder', folder: e.target.value.trim() }); }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              className={inputClass}
            />
            <datalist id={`folders-${view.id}`}>{folders.map(f => <option key={f.name} value={f.name} />)}</datalist>
          </>
        )}
        {view.source.kind === 'tag' && (
          <>
            <input
              aria-label={t('viewSourceTag')}
              list={`tags-${view.id}`}
              defaultValue={view.source.tag}
              key={view.source.tag}
              placeholder={t('viewTagPlaceholder')}
              onBlur={e => { if (e.target.value.trim()) setSource({ kind: 'tag', tag: e.target.value.trim() }); }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              className={inputClass}
            />
            <datalist id={`tags-${view.id}`}>{Object.keys(tagIndex).map(tag => <option key={tag} value={tag} />)}</datalist>
          </>
        )}
      </div>
      {view.layout === 'board' && (
        <div className="flex items-center gap-2">
          <label htmlFor={`groupby-${view.id}`} className="text-gray-500">{t('viewGroupBy')}</label>
          <select
            id={`groupby-${view.id}`}
            value={view.groupBy ?? ''}
            onChange={e => { void updateView(view.id, { groupBy: e.target.value || undefined, boardColumns: [] }); }}
            className={inputClass}
          >
            <option value="" />
            {groupableFields(schema).map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
      )}
      <fieldset className="flex flex-wrap items-center gap-1.5 min-w-0">
        <legend className="sr-only">{t('viewColumns')}</legend>
        <span className="text-gray-500 mr-1" aria-hidden="true">{t('viewColumns')}</span>
        {fields.map(field => {
          const on = view.columns.includes(field);
          return (
            <label key={field} className={`cursor-pointer px-2 py-0.5 rounded-full border ${on ? 'bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent)]' : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-[var(--accent)]'}`}>
              <input type="checkbox" checked={on} onChange={() => toggleColumn(field)} className="sr-only" />
              {field === MODIFIED_FIELD ? t('viewModifiedColumn') : field}
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
