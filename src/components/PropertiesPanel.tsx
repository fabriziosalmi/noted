import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { useFieldSchema } from '../hooks/useFieldSchema';
import { flushPendingSaves } from '../lib/pendingSave';
import { initialValue, propertyType } from '../lib/viewCells';
import { ViewCell } from './ViewCell';
import type { FieldValue } from '../../shared/vault/fields';
import type { FieldType } from '../../shared/views/schema';

const TYPES: FieldType[] = ['text', 'number', 'date', 'checkbox', 'list', 'link'];
const TYPE_LABEL: Record<string, TranslationKey> = {
  text: 'propTypeText', number: 'propTypeNumber', date: 'propTypeDate', checkbox: 'propTypeCheckbox', list: 'propTypeList', link: 'propTypeLink',
};
/** A datalist of every note would be as long as the vault: this many are suggested. */
const MAX_LINK_SUGGESTIONS = 200;

/**
 * The open note's properties, edited in place: each one in the editor for its type, a button to remove it, and a form to add
 * one (its name suggested from the properties the vault already uses). It writes through the same path as a view's cells, so
 * the note's own text is kept except for that property.
 */
export function PropertiesPanel({ noteName, onNotice }: {
  noteName: string | null;
  onNotice?: (message: string, variant?: 'success' | 'error') => void;
}) {
  const { t } = useI18n();
  const schema = useFieldSchema();
  const fields = useStore(s => (noteName ? s.frontmatterIndex[noteName] : undefined));
  const notes = useStore(s => s.notes);
  const setProperty = useStore(s => s.setNoteProperty);
  const [name, setName] = useState('');
  const [type, setType] = useState<FieldType>('text');
  const [chosen, setChosen] = useState<Record<string, FieldType>>({});

  const linkOptions = useMemo(() => notes.slice(0, MAX_LINK_SUGGESTIONS).map(n => `[[${n.name.replace(/\.md$/i, '')}]]`), [notes]);

  if (!noteName) return <div className="p-4 text-sm text-gray-400 dark:text-gray-500">{t('propsNoNote')}</div>;

  const entries = Object.entries(fields ?? {});
  const vaultType = (key: string): FieldType | undefined => schema.find(f => f.name === key)?.type;
  const optionsFor = (key: string, effective: FieldType): string[] => {
    if (effective === 'link') return linkOptions;
    return schema.find(f => f.name === key)?.options.map(o => o.value) ?? [];
  };

  const write = async (key: string, value: FieldValue | undefined) => {
    // What is typed in the editor but not yet saved goes first, so the file the property is written into is the current one.
    await flushPendingSaves().catch(() => undefined);
    const result = await setProperty(noteName, key, value);
    if (result.ok) return;
    onNotice?.(result.conflict ? t('viewEditConflict') : t('viewEditFailed').replace('{error}', result.error), 'error');
  };

  const add = () => {
    const key = name.trim();
    if (!key || (fields && key in fields)) return;
    setChosen(c => ({ ...c, [key]: type }));
    setName('');
    void write(key, initialValue(type));
  };

  const known = schema.map(f => f.name).filter(n => !(fields && n in fields));

  return (
    <div className="flex-1 overflow-y-auto p-4 text-sm" data-testid="properties-panel">
      {entries.length === 0 && <p className="text-gray-400 dark:text-gray-500 mb-4">{t('propsEmpty')}</p>}
      <dl className="space-y-3">
        {entries.map(([key, value]) => {
          const effective = propertyType(value, vaultType(key), chosen[key]);
          return (
            <div key={key} data-property={key} className="group">
              <dt className="flex items-center text-xs font-medium text-gray-500 dark:text-gray-400">
                <span className="truncate">{key}</span>
                <button
                  type="button"
                  onClick={() => { void write(key, undefined); }}
                  aria-label={t('propsRemove').replace('{name}', key)}
                  className="ml-auto p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-400 hover:text-red-500"
                >
                  <X size={12} />
                </button>
              </dt>
              <dd className="mt-0.5">
                <ViewCell field={key} value={value} type={effective} options={optionsFor(key, effective)} onCommit={v => { void write(key, v); }} />
              </dd>
            </div>
          );
        })}
      </dl>

      <form className="mt-5 flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); add(); }}>
        <input
          aria-label={t('propsKey')}
          list="props-known"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('propsKey')}
          className="flex-1 min-w-[7rem] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
        />
        <datalist id="props-known">{known.map(k => <option key={k} value={k} />)}</datalist>
        <select
          aria-label={t('propsType')}
          value={type}
          onChange={e => setType(e.target.value as FieldType)}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-1 py-1 text-xs"
        >
          {TYPES.map(ty => <option key={ty} value={ty}>{t(TYPE_LABEL[ty])}</option>)}
        </select>
        <button type="submit" aria-label={t('propsAdd')} title={t('propsAdd')} className="p-1 rounded text-[var(--accent)] hover:bg-[var(--accent-light)]"><Plus size={14} /></button>
      </form>
    </div>
  );
}
