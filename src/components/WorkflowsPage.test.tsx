import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorkflowsPage } from './WorkflowsPage';
import { ConfirmProvider } from './ConfirmProvider';
import { useStore } from '../store/useStore';
import { readAgentMetadata, type AgentMetadata } from '../../shared/agent';

const original = window.electronAPI;
const encode = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const note = (m: AgentMetadata) => `<h1>${m.id}</h1><h2>Agent Metadata</h2><pre><code class="language-json">${encode(JSON.stringify(m, null, 2))}</code></pre>`;
const base = { notedAgent: true as const, schemaVersion: 1, updatedAt: '2026-10-01T10:00:00.000Z' };
const WF = 'agents/wf-WF1-demo.md';
const workflow = (over: Partial<AgentMetadata> = {}): AgentMetadata => ({
  ...base, type: 'workflow', id: 'WF1', title: 'Demo', status: 'running', approvalMode: 'review',
  tasks: [
    { id: 'T1', title: 'Write the draft', parentId: null, dependsOn: [], file: 'agents/task-T1.md', status: 'review' },
    { id: 'T2', title: 'Publish it', parentId: null, dependsOn: ['T1'], file: 'agents/task-T2.md', status: 'todo' },
    { id: 'T3', title: 'Announce', parentId: null, dependsOn: ['T2', 'T0'], file: 'agents/task-T3.md', status: 'todo' },
  ],
  ...over,
});
let files: Record<string, string>;
let saveNote: ReturnType<typeof vi.fn>;
const notice = vi.fn();
const noteFile = (name: string) => ({ name, path: name, stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } });

beforeEach(() => {
  files = {
    [WF]: note(workflow()),
    'agents/task-T1.md': note({ ...base, type: 'task', id: 'T1', workflowId: 'WF1', status: 'review', dependsOn: [] }),
  };
  saveNote = vi.fn(async (name: string, html: string) => { files[name] = html; return { success: true }; });
  window.electronAPI = {
    ...original,
    readNote: vi.fn(async (name: string) => (name in files ? { success: true, data: files[name] } : { success: false, error: 'missing' })),
    saveNote,
    getNotesTree: vi.fn().mockResolvedValue({ success: true, data: { rootNotes: [], folders: [] } }),
  } as unknown as typeof window.electronAPI;
  useStore.setState({ settings: { ...useStore.getState().settings, language: 'en' }, notes: [noteFile(WF), noteFile('agents/task-T1.md'), noteFile('plain.md')], workflowsOpen: true });
});
afterEach(() => { window.electronAPI = original; notice.mockClear(); });

const page = () => render(<ConfirmProvider><WorkflowsPage onOpenNote={vi.fn()} onNotice={notice} /></ConfirmProvider>);
const col = (s: string) => document.querySelector(`[data-column="${s}"]`) as HTMLElement;
const cards = (s: string) => [...col(s).querySelectorAll('[data-task]')].map(c => c.getAttribute('data-task'));

describe('WorkflowsPage', () => {
  it('shows the tasks by state, with what each one waits for', async () => {
    page();
    await screen.findByTestId('workflow-status');
    expect(screen.getByTestId('workflow-status')).toHaveTextContent('running');
    expect(cards('todo')).toEqual(['T2', 'T3']);
    expect(cards('review')).toEqual(['T1']);
    expect(cards('done')).toEqual([]);
    const t3 = document.querySelector('[data-task="T3"]') as HTMLElement;
    expect(t3.querySelector('[data-dependency="T2"]')).toHaveAttribute('data-met', 'false');
    expect(t3.querySelector('[data-dependency="T0"]')).toHaveAttribute('title', 'This task is not in the workflow');
    expect(document.querySelector('[data-task="T2"]')).toHaveTextContent('Holds back: T3');
  });

  it('says so when the vault has no workflow', async () => {
    useStore.setState({ notes: [noteFile('plain.md')] });
    page();
    expect(await screen.findByTestId('workflows-empty')).toBeInTheDocument();
  });

  it('approves a task in review: it moves to Verified, in its note and in the workflow note', async () => {
    page();
    const t1 = await waitFor(() => { const el = document.querySelector('[data-task="T1"]'); expect(el).not.toBeNull(); return el as HTMLElement; });
    fireEvent.click(within(t1).getByRole('button', { name: 'Approve: T1' }));
    await waitFor(() => expect(readAgentMetadata(files['agents/task-T1.md'])!.status).toBe('verified'));
    expect(readAgentMetadata(files[WF])!.tasks![0].status).toBe('verified');
    await waitFor(() => expect(notice).toHaveBeenCalledWith('Approved', 'success'));
    await waitFor(() => expect(cards('verified')).toEqual(['T1']));
    expect(document.querySelector('[data-task="T2"] [data-dependency="T1"]')).toHaveAttribute('data-met', 'true');
  });

  it('rejects with a reason that is recorded', async () => {
    page();
    const t1 = await waitFor(() => { const el = document.querySelector('[data-task="T1"]'); expect(el).not.toBeNull(); return el as HTMLElement; });
    fireEvent.click(within(t1).getByRole('button', { name: 'Reject: T1' }));
    const input = await screen.findByDisplayValue('Not accepted');
    fireEvent.change(input, { target: { value: 'missing the intro' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(readAgentMetadata(files['agents/task-T1.md'])!.status).toBe('blocked'));
    expect(files['agents/task-T1.md']).toContain('missing the intro');
    await waitFor(() => expect(cards('blocked')).toEqual(['T1']));
  });

  it('writes nothing when the rejection is cancelled', async () => {
    page();
    const t1 = await waitFor(() => { const el = document.querySelector('[data-task="T1"]'); expect(el).not.toBeNull(); return el as HTMLElement; });
    fireEvent.click(within(t1).getByRole('button', { name: 'Reject: T1' }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    await new Promise(r => setTimeout(r, 20));
    expect(saveNote).not.toHaveBeenCalled();
  });

  it('refuses a decision on a task that moved since the board was loaded, and refreshes', async () => {
    page();
    const t1 = await waitFor(() => { const el = document.querySelector('[data-task="T1"]'); expect(el).not.toBeNull(); return el as HTMLElement; });
    files['agents/task-T1.md'] = note({ ...base, type: 'task', id: 'T1', workflowId: 'WF1', status: 'verified', dependsOn: [] }); // an assistant moved it
    fireEvent.click(within(t1).getByRole('button', { name: 'Approve: T1' }));
    await waitFor(() => expect(notice).toHaveBeenCalledWith(expect.stringContaining('nothing was written'), 'error'));
    expect(saveNote).not.toHaveBeenCalled();
  });

  it('decides the workflow own gate, and shows a loop of dependencies', async () => {
    files[WF] = note(workflow({
      status: 'awaiting_plan_approval',
      tasks: [
        { id: 'A', title: 'a', parentId: null, dependsOn: ['B'], file: 'agents/task-A.md', status: 'todo' },
        { id: 'B', title: 'b', parentId: null, dependsOn: ['A'], file: 'agents/task-B.md', status: 'todo' },
      ],
    }));
    page();
    const gate = await screen.findByTestId('workflow-gate');
    expect(gate).toHaveTextContent('Waiting for you to approve the plan');
    expect(screen.getByTestId('workflow-cycle')).toHaveTextContent('A, B');
    fireEvent.click(within(gate).getByRole('button', { name: /^Approve/ }));
    await waitFor(() => expect(readAgentMetadata(files[WF])!.status).toBe('ready'));
    await waitFor(() => expect(screen.queryByTestId('workflow-gate')).toBeNull());
  });
});
