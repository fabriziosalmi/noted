import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TasksPage } from './TasksPage';
import { useStore } from '../store/useStore';
import { localDay, addDays, type NoteTask } from '../../shared/tasks/query';

const original = window.electronAPI;
const today = localDay(new Date());
const task = (note: string, line: number, over: Partial<NoteTask> = {}): NoteTask => ({ note, line, done: false, text: `task ${line}`, tags: [], depth: 0, noteTags: [], ...over });
let listTasks: ReturnType<typeof vi.fn>;
let toggleTask: ReturnType<typeof vi.fn>;
const notice = vi.fn();

const answer = (tasks: NoteTask[], format: 'markdown' | 'html' = 'markdown') => ({ success: true, data: { tasks, total: tasks.length, format } });

beforeEach(() => {
  listTasks = vi.fn().mockResolvedValue(answer([
    task('Work/plan.md', 3, { text: 'draft the plan', due: addDays(today, -2) }),
    task('Home/chores.md', 1, { text: 'buy milk', due: addDays(today, 3) }),
    task('Home/chores.md', 2, { text: 'tidy up', depth: 1 }),
    task('Work/plan.md', 4, { text: 'outline', done: true }),
  ]));
  toggleTask = vi.fn().mockResolvedValue({ success: true, data: { changed: true } });
  window.electronAPI = { ...original, listTasks, toggleTask } as unknown as typeof window.electronAPI;
  useStore.setState({ settings: { ...useStore.getState().settings, language: 'en' }, vaultIndexSync: { vault: '/v', seq: 1 }, noteFolders: [], tagIndex: {}, tasksOpen: true });
});
afterEach(() => { window.electronAPI = original; notice.mockClear(); });

const page = () => render(<TasksPage onOpenNote={open} onNotice={notice} />);
const open = vi.fn();
const lastFilter = () => listTasks.mock.calls.at(-1)![0] as Record<string, unknown>;

describe('TasksPage', () => {
  it('lists the tasks with their note and due date, overdue ones marked, and counts them', async () => {
    page();
    await screen.findByText('draft the plan');
    expect(screen.getByTestId('tasks-count')).toHaveTextContent('4 tasks');
    expect(within(document.querySelector('[data-task="Work/plan.md:3"]') as HTMLElement).getByText(new RegExp(`${addDays(today, -2)} · overdue`))).toBeInTheDocument();
    expect(document.querySelector('[data-task="Home/chores.md:1"] [data-due]')).toHaveTextContent(addDays(today, 3));
    expect(document.querySelector('[data-task="Home/chores.md:1"] [data-due]')).not.toHaveTextContent('overdue');
    expect(screen.getByRole('checkbox', { name: 'outline' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'buy milk' })).not.toBeChecked();
  });

  it('asks for open tasks first, and for what the filters say', async () => {
    page();
    await waitFor(() => expect(listTasks).toHaveBeenCalled());
    expect(lastFilter()).toMatchObject({ status: 'open' });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } });
    await waitFor(() => expect(lastFilter()).toMatchObject({ status: 'all' }));
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: 'week' } });
    await waitFor(() => expect(lastFilter()).toMatchObject({ dueFrom: today, dueTo: addDays(today, 6) }));
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: 'overdue' } });
    await waitFor(() => expect(lastFilter()).toMatchObject({ overdue: true }));
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: 'Work' } });
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: '#urgent' } });
    fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: 'milk' } });
    await waitFor(() => expect(lastFilter()).toMatchObject({ folder: 'Work', tag: '#urgent', text: 'milk' }));
  });

  it('ticking a task changes it in its note, by line and text, and shows it at once', async () => {
    page();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'buy milk' }));
    expect(screen.getByRole('checkbox', { name: 'buy milk' })).toBeChecked();
    await waitFor(() => expect(toggleTask).toHaveBeenCalledWith('Home/chores.md', 1, 'buy milk', true, undefined));
    fireEvent.click(screen.getByRole('checkbox', { name: 'outline' }));
    await waitFor(() => expect(toggleTask).toHaveBeenLastCalledWith('Work/plan.md', 4, 'outline', false, undefined));
  });

  it('says so, and shows the list as the notes have it, when a task could not be changed', async () => {
    toggleTask.mockResolvedValueOnce({ success: false, error: 'that task changed since it was listed' });
    page();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'buy milk' }));
    await waitFor(() => expect(notice).toHaveBeenCalledWith('Could not change the task: that task changed since it was listed', 'error'));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'buy milk' })).not.toBeChecked());
  });

  it('a note name opens the note', async () => {
    page();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Work/plan' }))[0]);
    expect(open).toHaveBeenCalledWith('Work/plan.md');
  });

  it('says so when nothing matches, and when the vault is not Markdown', async () => {
    listTasks.mockResolvedValue(answer([]));
    const { unmount } = page();
    expect(await screen.findByText('No tasks match.')).toBeInTheDocument();
    unmount();
    listTasks.mockResolvedValue(answer([], 'html'));
    page();
    expect(await screen.findByText(/read from Markdown notes/)).toBeInTheDocument();
  });

  it('asks again when the notes change', async () => {
    page();
    await waitFor(() => expect(listTasks).toHaveBeenCalledTimes(1));
    useStore.setState({ vaultIndexSync: { vault: '/v', seq: 2 } });
    await waitFor(() => expect(listTasks).toHaveBeenCalledTimes(2));
  });
});
