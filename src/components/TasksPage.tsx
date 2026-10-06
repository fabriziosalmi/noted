import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { getElectronApi } from '../lib/electronApi';
import { dueFilter, localDay, type DuePreset, type NoteTask, type TaskFilter } from '../../shared/tasks/query';

const REFRESH_MS = 300;
const control = 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-xs outline-none focus:border-[var(--accent)]';

/**
 * The tasks of the whole vault (`- [ ]` items of Markdown notes), soonest due first: filter by status, due date, folder and tag,
 * tick one off right here (it changes in its note), or open its note.
 */
export function TasksPage({ onOpenNote, onNotice }: {
  onOpenNote: (name: string) => void;
  onNotice?: (message: string, variant?: 'success' | 'error') => void;
}) {
  const { t } = useI18n();
  const closeTasks = useStore(s => s.closeTasks);
  const seq = useStore(s => s.vaultIndexSync?.seq ?? 0);
  const folders = useStore(s => s.noteFolders);
  const tagIndex = useStore(s => s.tagIndex);
  const syncDir = useStore(s => s.settings.syncDirectory) || undefined;
  const [status, setStatus] = useState<'open' | 'done' | 'all'>('open');
  const [due, setDue] = useState<DuePreset>('any');
  const [folder, setFolder] = useState('');
  const [tag, setTag] = useState('');
  const [text, setText] = useState('');
  const [tasks, setTasks] = useState<NoteTask[]>([]);
  const [total, setTotal] = useState(0);
  const [markdown, setMarkdown] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const request = useRef(0);
  const today = localDay(new Date());

  const filter = useMemo<TaskFilter>(() => ({
    status, folder: folder.trim() || undefined, tag: tag.trim() || undefined, text: text.trim() || undefined, ...dueFilter(due, today),
  }), [status, due, folder, tag, text, today]);

  // Again whenever the filter changes, and when the notes do (a short wait, so typing does not ask for every letter).
  useEffect(() => {
    const mine = ++request.current;
    const api = getElectronApi();
    if (!api?.listTasks) return;
    const timer = setTimeout(() => {
      void api.listTasks(filter, syncDir).then(res => {
        if (mine !== request.current || !res.success || !res.data) return;
        setTasks(res.data.tasks);
        setTotal(res.data.total);
        setMarkdown(res.data.format === 'markdown');
        setLoaded(true);
      }).catch(() => undefined);
    }, REFRESH_MS);
    return () => clearTimeout(timer);
  }, [filter, syncDir, seq]);

  const toggle = async (task: NoteTask) => {
    const api = getElectronApi();
    if (!api?.toggleTask) return;
    const key = `${task.note}:${task.line}`;
    // Shown at once; the list is read again from the notes either way.
    setTasks(list => list.map(x => (`${x.note}:${x.line}` === key ? { ...x, done: !x.done } : x)));
    const res = await api.toggleTask(task.note, task.line, task.text, !task.done, syncDir).catch(() => null);
    if (!res?.success) {
      onNotice?.(t('tasksToggleFailed').replace('{error}', res?.error ?? 'failed'), 'error');
      request.current++; // drop any answer that is still on its way, then ask again
      const again = await api.listTasks(filter, syncDir).catch(() => null);
      if (again?.success && again.data) { setTasks(again.data.tasks); setTotal(again.data.total); }
    }
  };

  const dueBadge = (task: NoteTask) => {
    if (!task.due) return null;
    const late = !task.done && task.due < today;
    return (
      <span className={`shrink-0 text-xs tabular-nums ${late ? 'text-red-500 font-medium' : 'text-gray-500'}`} data-due={task.due}>
        {task.due}{late ? ` · ${t('tasksOverdue')}` : ''}
      </span>
    );
  };

  return (
    <section aria-label={t('tasksTitle')} className="flex-1 flex flex-col overflow-hidden" data-testid="tasks-page">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <button type="button" onClick={closeTasks} aria-label={t('viewClose')} title={t('viewClose')} className="p-1 rounded text-gray-500 hover:text-[var(--accent)] hover:bg-gray-100 dark:hover:bg-gray-800">
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-lg font-semibold">{t('tasksTitle')}</h1>
        <span className="text-xs text-gray-400" data-testid="tasks-count">{t('tasksCount').replace('{n}', String(total))}</span>
      </header>

      <div className="px-4 py-2 flex flex-wrap items-center gap-2 border-b border-gray-200 dark:border-gray-700 text-xs" data-testid="tasks-filters">
        <select aria-label={t('tasksStatus')} value={status} onChange={e => setStatus(e.target.value as typeof status)} className={control}>
          <option value="open">{t('tasksStatusOpen')}</option>
          <option value="done">{t('tasksStatusDone')}</option>
          <option value="all">{t('tasksStatusAll')}</option>
        </select>
        <select aria-label={t('tasksDue')} value={due} onChange={e => setDue(e.target.value as DuePreset)} className={control}>
          <option value="any">{t('tasksDueAny')}</option>
          <option value="overdue">{t('tasksDueOverdue')}</option>
          <option value="today">{t('tasksDueToday')}</option>
          <option value="week">{t('tasksDueWeek')}</option>
          <option value="none">{t('tasksDueNone')}</option>
        </select>
        <input aria-label={t('tasksFolder')} list="tasks-folders" value={folder} onChange={e => setFolder(e.target.value)} placeholder={t('tasksFolder')} className={`${control} w-32`} />
        <datalist id="tasks-folders">{folders.map(f => <option key={f.name} value={f.name} />)}</datalist>
        <input aria-label={t('tasksTag')} list="tasks-tags" value={tag} onChange={e => setTag(e.target.value)} placeholder={t('tasksTag')} className={`${control} w-28`} />
        <datalist id="tasks-tags">{Object.keys(tagIndex).map(tg => <option key={tg} value={tg} />)}</datalist>
        <input aria-label={t('tasksSearch')} type="search" value={text} onChange={e => setText(e.target.value)} placeholder={t('tasksSearch')} className={`${control} flex-1 min-w-[8rem]`} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {!markdown && <p className="p-6 text-sm text-gray-500">{t('tasksNeedsMarkdown')}</p>}
        {markdown && loaded && tasks.length === 0 && <p className="p-6 text-sm text-gray-400" role="status">{t('tasksEmpty')}</p>}
        <ul>
          {tasks.map(task => (
            <li key={`${task.note}:${task.line}`} data-task={`${task.note}:${task.line}`} className="flex items-start gap-3 px-4 py-2 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40" style={{ paddingLeft: 16 + task.depth * 16 }}>
              <button
                type="button"
                role="checkbox"
                aria-checked={task.done}
                aria-label={task.text}
                onClick={() => { void toggle(task); }}
                className={`mt-0.5 shrink-0 inline-flex w-4 h-4 items-center justify-center rounded border ${task.done ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : 'border-gray-300 dark:border-gray-600'}`}
              >
                {task.done && <Check size={11} aria-hidden="true" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className={`text-sm ${task.done ? 'line-through text-gray-400' : ''}`}>{task.text}</div>
                <button type="button" onClick={() => onOpenNote(task.note)} className="text-xs text-[var(--accent)] hover:underline truncate max-w-full">
                  {task.note.replace(/\.md$/i, '')}
                </button>
              </div>
              {dueBadge(task)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
