import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentPanel } from './AgentPanel';
import type { NoteFile } from '../store/useStore';

const notes: NoteFile[] = [
  { name: 'noted/task-T001-schema.md', path: '/tmp/task.md', stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } },
  { name: 'noted/runs-WF001.md', path: '/tmp/runs.md', stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } },
];

function workflowHtml() {
  return `
    <h1>WF001 Agent Runtime</h1>
    <h2>Agent Metadata</h2>
    <pre><code class="language-json">{
      "notedAgent": true,
      "schemaVersion": 1,
      "type": "workflow",
      "id": "WF001",
      "status": "draft",
      "approvalMode": "plan",
      "files": {
        "runs": "noted/runs-WF001.md",
        "reviews": "noted/reviews-WF001.md",
        "output": "noted/output-WF001.md"
      },
      "tasks": [
        {
          "id": "T001",
          "title": "Schema",
          "parentId": null,
          "dependsOn": [],
          "file": "noted/task-T001-schema.md",
          "status": "todo"
        },
        {
          "id": "T001.1",
          "title": "Events",
          "parentId": "T001",
          "dependsOn": ["T001"],
          "file": "noted/task-T001.1-events.md",
          "status": "review"
        }
      ]
    }</code></pre>
    <h2>Event TaskStatusChanged</h2>
    <pre><code class="language-json">{
      "type": "TaskStatusChanged",
      "actor": "codex",
      "at": "2026-05-25T10:30:00.000Z",
      "status": "review",
      "summary": "Ready for review"
    }</code></pre>
  `;
}

describe('AgentPanel', () => {
  it('renders workflow tree and opens existing task notes', () => {
    const onOpenNote = vi.fn(async (_name: string) => undefined);

    render(
      <AgentPanel
        activeNoteName="noted/wf-WF001-agent-runtime.md"
        activeNoteContent={workflowHtml()}
        notes={notes}
        onOpenNote={onOpenNote}
      />,
    );

    expect(screen.getByText('WF001')).toBeInTheDocument();
    expect(screen.getByText('T001 Schema')).toBeInTheDocument();
    expect(screen.getByText('T001.1 Events')).toBeInTheDocument();
    expect(screen.getByText('Ready for review')).toBeInTheDocument();

    fireEvent.click(screen.getByText('T001 Schema'));
    expect(onOpenNote).toHaveBeenCalledWith('noted/task-T001-schema.md');
  });

  it('shows empty state for normal notes', () => {
    render(
      <AgentPanel
        activeNoteName="plain.md"
        activeNoteContent="<p>Hello</p>"
        notes={[]}
        onOpenNote={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByText('Open an agent workflow note to inspect its tree.')).toBeInTheDocument();
  });
});

