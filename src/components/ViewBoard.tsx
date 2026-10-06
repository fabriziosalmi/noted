import { useState } from 'react';
import { ChevronLeft, ChevronRight, Pin, Plus, X } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { useViewRows } from '../hooks/useViewRows';
import { useFieldSchema } from '../hooks/useFieldSchema';
import { buildBoard, canMoveCards, groupableFields, movedColumn, valueForColumn, withColumn, type BoardColumn } from '../../shared/views/board';
import { MAX_BOARD_COLUMNS, type View } from '../../shared/views/model';
import { cellFor, cellText } from '../lib/viewCells';
import { createNoteInView } from '../lib/viewNewNote';
import type { FieldType } from '../../shared/views/schema';

const CARD_FIELDS = 3;
const DRAG_TYPE = 'application/x-noted-card';

/**
 * A view as a board: a column for each value of the group field, a card for each note. A card opens its note; dropping it on
 * another column (or picking the column from its menu, which also works from the keyboard) rewrites the property in the note.
 */
export function ViewBoard({ view, onOpenNote, onNotice }: {
  view: View;
  onOpenNote: (name: string) => void;
  onNotice?: (message: string, variant?: 'success' | 'error') => void;
}) {
  const { t } = useI18n();
  const rows = useViewRows(view);
  const schema = useFieldSchema();
  const updateView = useStore(s => s.updateView);
  const setProperty = useStore(s => s.setNoteProperty);
  const indexed = useStore(s => s.vaultIndexSync !== null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [newColumn, setNewColumn] = useState('');

  if (!indexed) return <div className="p-6 text-sm text-gray-400" role="status">{t('viewLoading')}</div>;

  const field = view.groupBy;
  if (!field) {
    return (
      <div className="p-6 text-sm text-gray-500 flex items-center gap-3" data-testid="view-board-choose">
        <label htmlFor={`group-${view.id}`}>{t('viewBoardChoose')}</label>
        <select
          id={`group-${view.id}`}
          value=""
          onChange={e => { if (e.target.value) void updateView(view.id, { groupBy: e.target.value }); }}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-xs"
        >
          <option value="" />
          {groupableFields(schema).map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
    );
  }

  const type: FieldType = schema.find(f => f.name === field)?.type ?? 'text';
  const movable = canMoveCards(type);
  const columns = buildBoard(rows, view);
  const labelOf = (value: string | null): string => value ?? t('viewNoValue');
  const pinned = view.boardColumns ?? [];
  const setPinned = (boardColumns: string[]) => { void updateView(view.id, { boardColumns }); };

  const move = async (name: string, from: string | null, to: string | null) => {
    if (!movable || from === to) return;
    // Moving a card keeps the board as it is: a column that this move leaves empty must not vanish from under the user.
    const shown = columns.flatMap(c => (c.value === null ? [] : [c.value]));
    if (shown.some(v => !pinned.includes(v))) setPinned([...pinned, ...shown.filter(v => !pinned.includes(v))]);
    const result = await setProperty(name, field, valueForColumn(to, type));
    if (result.ok) return;
    onNotice?.(result.conflict ? t('viewEditConflict') : t('viewEditFailed').replace('{error}', result.error), 'error');
  };

  const fieldsOnCard = view.columns.filter(c => c !== field && !c.startsWith('$')).slice(0, CARD_FIELDS);

  const renderColumn = (column: BoardColumn) => {
    const key = column.value === null ? 'none:' : `value:${column.value}`;
    const pinnedIndex = column.value === null ? -1 : pinned.indexOf(column.value);
    return (
      <section
        key={key}
        aria-label={labelOf(column.value)}
        data-column={column.value ?? ''}
        onDragOver={e => { if (movable && e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setDragOver(key); } }}
        onDragLeave={() => setDragOver(current => (current === key ? null : current))}
        onDrop={e => {
          setDragOver(null);
          const raw = e.dataTransfer.getData(DRAG_TYPE);
          if (!raw) return;
          e.preventDefault();
          try {
            const card = JSON.parse(raw) as { name: string; from: string | null };
            void move(card.name, card.from, column.value);
          } catch { /* not one of ours */ }
        }}
        className={`w-64 shrink-0 flex flex-col rounded-lg border ${dragOver === key ? 'border-[var(--accent)] bg-[var(--accent-light)]' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40'}`}
      >
        <header className="flex items-center gap-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          <span className={`truncate ${column.value === null ? 'italic font-normal' : ''}`}>{labelOf(column.value)}</span>
          <span className="text-gray-400 font-normal" data-testid="column-count">{column.rows.length}</span>
          <span className="ml-auto flex items-center">
            {column.pinned && (
              <>
                <button type="button" disabled={pinnedIndex === 0} onClick={() => setPinned(movedColumn(pinned, pinnedIndex, -1))} aria-label={`${t('viewColumnLeft')}: ${labelOf(column.value)}`} className="p-0.5 disabled:opacity-30 hover:text-[var(--accent)]"><ChevronLeft size={12} /></button>
                <button type="button" disabled={pinnedIndex === pinned.length - 1} onClick={() => setPinned(movedColumn(pinned, pinnedIndex, 1))} aria-label={`${t('viewColumnRight')}: ${labelOf(column.value)}`} className="p-0.5 disabled:opacity-30 hover:text-[var(--accent)]"><ChevronRight size={12} /></button>
                {column.rows.length === 0 && (
                  <button type="button" onClick={() => setPinned(pinned.filter(v => v !== column.value))} aria-label={`${t('viewColumnRemove')}: ${labelOf(column.value)}`} className="p-0.5 hover:text-red-500"><X size={12} /></button>
                )}
              </>
            )}
            {!column.pinned && column.value !== null && (
              <button type="button" onClick={() => setPinned(withColumn(pinned, column.value as string, MAX_BOARD_COLUMNS))} aria-label={`${t('viewColumnKeep')}: ${column.value}`} title={t('viewColumnKeep')} className="p-0.5 hover:text-[var(--accent)]"><Pin size={12} /></button>
            )}
          </span>
        </header>
        <ul className="flex-1 overflow-y-auto px-2 pb-2 space-y-2 min-h-[2rem]">
          {column.rows.map(row => (
            <li
              key={row.name}
              data-card={row.name}
              draggable={movable}
              onDragStart={e => { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ name: row.name, from: column.value })); e.dataTransfer.effectAllowed = 'move'; }}
              className="group rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2.5 py-2 text-sm shadow-sm"
            >
              <button type="button" onClick={() => onOpenNote(row.name)} className="text-left font-medium text-[var(--accent)] hover:underline w-full truncate" title={row.folder ? `${row.folder}/${row.title}` : row.title}>
                {row.title}
              </button>
              {fieldsOnCard.map(name => {
                const cell = cellFor(row.fields[name], schema.find(f => f.name === name)?.type ?? 'text');
                const text = cellText(cell);
                return text ? <div key={name} className="text-xs text-gray-500 truncate"><span className="text-gray-400">{name}: </span>{text}</div> : null;
              })}
              {movable && (
                <select
                  aria-label={t('viewCardMove').replace('{name}', row.title)}
                  value={column.value ?? ''}
                  onChange={e => { void move(row.name, column.value, e.target.value === '' ? null : e.target.value); }}
                  className="mt-1 w-full opacity-0 group-hover:opacity-100 focus:opacity-100 bg-transparent border border-gray-200 dark:border-gray-700 rounded text-xs px-1 py-0.5"
                >
                  {columns.filter(c => c.value !== null).map(c => <option key={c.value} value={c.value as string}>{c.value}</option>)}
                  <option value="">{t('viewNoValue')}</option>
                  {column.value !== null && !columns.some(c => c.value === column.value) && <option value={column.value}>{column.value}</option>}
                </select>
              )}
            </li>
          ))}
        </ul>
        {movable && (
          <button
            type="button"
            onClick={() => { createNoteInView(view, () => type, column.value).catch((err: unknown) => onNotice?.((err as Error).message, 'error')); }}
            aria-label={`${t('viewAddCard')}: ${labelOf(column.value)}`}
            className="mx-2 mb-2 inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-500 hover:text-[var(--accent)] hover:bg-[var(--accent-light)]"
          >
            <Plus size={12} aria-hidden="true" /> {t('viewAddCard')}
          </button>
        )}
      </section>
    );
  };

  return (
    <div className="flex-1 overflow-auto p-4" data-testid="view-board">
      {!movable && <p className="mb-3 text-xs text-gray-400">{t('viewListNoMove')}</p>}
      <div className="flex gap-3 items-start">
        {columns.map(renderColumn)}
        <form
          className="w-56 shrink-0 flex items-center gap-1"
          onSubmit={e => { e.preventDefault(); setPinned(withColumn(pinned, newColumn, MAX_BOARD_COLUMNS)); setNewColumn(''); }}
        >
          <input
            aria-label={t('viewColumnName')}
            value={newColumn}
            onChange={e => setNewColumn(e.target.value)}
            placeholder={t('viewColumnName')}
            className="flex-1 min-w-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
          />
          <button type="submit" aria-label={t('viewAddColumn')} title={t('viewAddColumn')} className="p-1 rounded text-gray-500 hover:text-[var(--accent)]"><Plus size={14} /></button>
        </form>
      </div>
    </div>
  );
}
