import { useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { cellFor, cellText, editorText, parseCellInput } from '../lib/viewCells';
import type { FieldValue } from '../../shared/vault/fields';
import type { FieldType } from '../../shared/views/schema';

const INPUT_TYPE: Partial<Record<FieldType, string>> = { number: 'number', date: 'date' };

/**
 * One cell of a view: shows a property's value, and edits it in place. A checkbox toggles with a click; anything else opens
 * an editor on double-click or Enter (Enter or leaving it keeps the change, Escape drops it). It never writes by itself:
 * what was typed goes to `onCommit`, which decides how it reaches the note.
 */
export function ViewCell({ field, value, type, options, onCommit }: {
  field: string;
  value: FieldValue | undefined;
  type: FieldType;
  /** Values the field already has, suggested while typing. */
  options: string[];
  onCommit: (value: FieldValue | undefined) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const finished = useRef(false);
  const cell = cellFor(value, type);

  const finish = (text: string | null) => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    if (text === null) return;
    const next = parseCellInput(text, type);
    if (JSON.stringify(next) !== JSON.stringify(value ?? undefined)) onCommit(next);
  };
  const start = () => { finished.current = false; setEditing(true); };

  if (cell.kind === 'check') {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={cell.checked}
        aria-label={field}
        data-field={field}
        onClick={() => onCommit(!cell.checked)}
        className={`inline-flex w-4 h-4 items-center justify-center rounded border ${cell.checked ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : 'border-gray-300 dark:border-gray-600'}`}
      >
        {cell.checked && <Check size={11} aria-hidden="true" />}
      </button>
    );
  }

  if (editing) {
    const asText = typeof value === 'string' && type === 'number'; // a word in a number column is edited as the word it is
    return (
      <>
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          aria-label={field}
          type={asText ? 'text' : (INPUT_TYPE[type] ?? 'text')}
          list={options.length > 0 ? `opts-${field}` : undefined}
          defaultValue={editorText(value)}
          onBlur={e => finish(e.target.value)}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') { e.preventDefault(); finish(e.currentTarget.value); }
            if (e.key === 'Escape') { e.preventDefault(); finish(null); }
          }}
          className="w-full min-w-[6rem] bg-white dark:bg-gray-800 border border-[var(--accent)] rounded px-1.5 py-0.5 text-sm outline-none"
        />
        {options.length > 0 && <datalist id={`opts-${field}`}>{options.map(o => <option key={o} value={o} />)}</datalist>}
      </>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-field={field}
      title={t('viewEditHint')}
      onDoubleClick={start}
      onKeyDown={e => { if ((e.key === 'Enter' || e.key === 'F2') && !e.nativeEvent.isComposing) { e.preventDefault(); start(); } }}
      className="min-h-[1.5rem] cursor-text rounded focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]"
    >
      {cell.kind === 'text' && cell.text}
      {cell.kind === 'chips' && (
        <span className="inline-flex flex-wrap gap-1" title={cellText(cell)}>
          {cell.items.map(item => (
            <span key={item} className="px-1.5 py-0.5 rounded-full text-xs bg-[var(--accent-light)] text-[var(--accent)]">{item}</span>
          ))}
        </span>
      )}
    </div>
  );
}
