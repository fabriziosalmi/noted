import { useEffect, useState } from 'react';
import { getElectronApi } from '../lib/electronApi';
import { Bot, CheckSquare, ChevronDown, HeartPulse, Kanban, ChevronRight, Copy, Pencil, Plus, Table2, Trash2 } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { useConfirm, usePrompt } from './ConfirmProvider';
import { Tooltip } from './Tooltip';
import { isWorkflowNoteName } from '../lib/workflowBoard';

const OPEN_KEY = 'noted-views-section-open';
const readOpen = (): boolean => {
  try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; }
};

/** The vault's saved views, above the notes: open one, make a new one, rename, duplicate or delete. */
export function ViewsSection() {
  const { t } = useI18n();
  const views = useStore(s => s.views);
  const activeViewId = useStore(s => s.activeViewId);
  const tasksOpen = useStore(s => s.tasksOpen);
  const activityOpen = useStore(s => s.activityOpen);
  const workflowsOpen = useStore(s => s.workflowsOpen);
  const healthOpen = useStore(s => s.healthOpen);
  // Offered once the vault holds a workflow note (named wf-<id>-<title>.md by the tool that makes them).
  const hasWorkflows = useStore(s => s.notes.some(n => isWorkflowNoteName(n.name)));
  const syncDir = useStore(s => s.settings.syncDirectory) || undefined;
  const [agentsActive, setAgentsActive] = useState(false);

  // The Agent activity page is offered once an assistant has changed something in this vault.
  useEffect(() => {
    const ask = () => { void getElectronApi()?.journalList?.(syncDir).then(res => { if (res.success && res.data) setAgentsActive(res.data.total > 0); }).catch(() => undefined); };
    ask();
    window.addEventListener('focus', ask);
    return () => window.removeEventListener('focus', ask);
  }, [syncDir]);
  const [open, setOpen] = useState(readOpen);
  const confirm = useConfirm();
  const prompt = usePrompt();

  const toggle = () => {
    setOpen(v => {
      try { localStorage.setItem(OPEN_KEY, v ? '0' : '1'); } catch { /* the section just opens again next time */ }
      return !v;
    });
  };

  const create = async () => {
    const name = await prompt({ title: t('viewNew'), message: t('viewNamePrompt'), defaultValue: t('viewNewDefault') });
    if (!name?.trim()) return;
    const view = await useStore.getState().createView(name);
    if (view) {
      setOpen(true);
      useStore.getState().openView(view.id);
    }
  };

  const rename = async (id: string, current: string) => {
    const name = await prompt({ title: t('viewRename'), message: t('viewNamePrompt'), defaultValue: current });
    if (name?.trim() && name.trim() !== current) await useStore.getState().updateView(id, { name: name.trim() });
  };

  const duplicate = async (id: string, current: string) => {
    const copy = await useStore.getState().duplicateView(id, t('viewCopyName').replace('{name}', current));
    if (copy) useStore.getState().openView(copy.id);
  };

  const remove = async (id: string, name: string) => {
    const ok = await confirm({ message: t('viewDeleteConfirm').replace('{name}', name), danger: true, confirmLabel: t('viewDelete') });
    if (ok) await useStore.getState().deleteView(id);
  };

  return (
    <div className="px-2 pb-2" data-testid="views-section">
      <button
        type="button"
        onClick={() => useStore.getState().openTasks()}
        aria-current={tasksOpen ? 'page' : undefined}
        className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-sm text-left ${tasksOpen ? 'bg-[var(--accent-light)] text-[var(--accent)] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/40'}`}
      >
        <CheckSquare size={13} className="shrink-0 text-gray-400" aria-hidden="true" />
        {t('tasksTitle')}
      </button>
      {agentsActive && (
        <button
          type="button"
          onClick={() => useStore.getState().openActivity()}
          aria-current={activityOpen ? 'page' : undefined}
          className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-sm text-left ${activityOpen ? 'bg-[var(--accent-light)] text-[var(--accent)] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/40'}`}
        >
          <Bot size={13} className="shrink-0 text-gray-400" aria-hidden="true" />
          {t('activityTitle')}
        </button>
      )}
      {hasWorkflows && (
        <button
          type="button"
          onClick={() => useStore.getState().openWorkflows()}
          aria-current={workflowsOpen ? 'page' : undefined}
          className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-sm text-left ${workflowsOpen ? 'bg-[var(--accent-light)] text-[var(--accent)] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/40'}`}
        >
          <Kanban size={13} className="shrink-0 text-gray-400" aria-hidden="true" />
          {t('workflowsTitle')}
        </button>
      )}
      <button
        type="button"
        onClick={() => useStore.getState().openHealth()}
        aria-current={healthOpen ? 'page' : undefined}
        className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-sm text-left ${healthOpen ? 'bg-[var(--accent-light)] text-[var(--accent)] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/40'}`}
      >
        <HeartPulse size={13} className="shrink-0 text-gray-400" aria-hidden="true" />
        {t('healthTitle')}
      </button>
      <div className="flex items-center justify-between px-1 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
        <button type="button" onClick={toggle} aria-expanded={open} className="flex items-center gap-1 py-1 hover:text-gray-800 dark:hover:text-gray-200">
          {open ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
          {t('viewsSection')}
        </button>
        <Tooltip label={t('viewNew')}>
          <button type="button" onClick={() => { void create(); }} aria-label={t('viewNew')} className="p-1 hover:text-gray-800 dark:hover:text-gray-200">
            <Plus size={13} />
          </button>
        </Tooltip>
      </div>
      {open && views.length > 0 && (
        <ul className="mt-0.5 space-y-0.5">
          {views.map(view => (
            <li key={view.id} data-view={view.id} className="group flex items-center">
              <button
                type="button"
                onClick={() => useStore.getState().openView(view.id)}
                aria-current={activeViewId === view.id ? 'page' : undefined}
                className={`flex-1 min-w-0 flex items-center gap-2 px-2 py-1 rounded-md text-sm text-left ${activeViewId === view.id ? 'bg-[var(--accent-light)] text-[var(--accent)] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/40'}`}
              >
                <Table2 size={13} className="shrink-0 text-gray-400" aria-hidden="true" />
                <span className="truncate">{view.name}</span>
              </button>
              <span className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <button type="button" onClick={() => { void rename(view.id, view.name); }} aria-label={`${t('viewRename')}: ${view.name}`} className="p-1 text-gray-400 hover:text-[var(--accent)]"><Pencil size={11} /></button>
                <button type="button" onClick={() => { void duplicate(view.id, view.name); }} aria-label={`${t('viewDuplicate')}: ${view.name}`} className="p-1 text-gray-400 hover:text-[var(--accent)]"><Copy size={11} /></button>
                <button type="button" onClick={() => { void remove(view.id, view.name); }} aria-label={`${t('viewDelete')}: ${view.name}`} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={11} /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
