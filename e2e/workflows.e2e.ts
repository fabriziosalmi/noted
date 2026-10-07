import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';

// The workflows board (#88): a workflow's tasks by state with what waits for what, and the approval of a gate from the page,
// written into the notes the way the MCP tools write it.
const at = '2026-10-01T10:00:00.000Z';
const block = (meta: object) => `## Agent Metadata\n\n\`\`\`json\n${JSON.stringify(meta, null, 2)}\n\`\`\`\n`;
const readMeta = (file: string) => {
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(/```json\n([\s\S]*?)\n```/.exec(text)![1]);
};

test('workflows: the board shows the tasks and what they wait for, and a gate is approved from the page into the notes', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  fs.mkdirSync(path.join(noted.vault, 'agents'));
  const tasks = [
    { id: 'T1', title: 'Write the draft', parentId: null, dependsOn: [], file: 'agents/task-T1.md', status: 'review' },
    { id: 'T2', title: 'Publish it', parentId: null, dependsOn: ['T1'], file: 'agents/task-T2.md', status: 'todo' },
  ];
  fs.writeFileSync(path.join(noted.vault, 'agents', 'wf-WF1-demo.md'), `# WF1 Demo\n\n${block({ notedAgent: true, schemaVersion: 1, type: 'workflow', id: 'WF1', title: 'Demo', status: 'running', approvalMode: 'review', createdAt: at, updatedAt: at, tasks })}`);
  for (const t of tasks) {
    fs.writeFileSync(path.join(noted.vault, t.file), `# ${t.title}\n\n${block({ notedAgent: true, schemaVersion: 1, type: 'task', id: t.id, workflowId: 'WF1', parentId: null, dependsOn: t.dependsOn, status: t.status, owner: null, createdAt: at, updatedAt: at })}`);
  }
  fs.writeFileSync(path.join(noted.vault, 'Journal.md'), '# Journal\n\nnothing here\n');
  const { win, vault } = await noted.relaunch();

  await win.getByTestId('views-section').getByRole('button', { name: 'Workflows', exact: true }).click({ timeout: 15_000 });
  const page = win.getByTestId('workflows-page');
  await expect(win.getByTestId('workflow-status')).toHaveText('running', { timeout: 15_000 });
  await expect(page.locator('[data-column="review"] [data-task="T1"]')).toBeVisible();
  await expect(page.locator('[data-column="todo"] [data-task="T2"]')).toBeVisible();
  await expect(page.locator('[data-task="T2"] [data-dependency="T1"]')).toHaveAttribute('data-met', 'false');

  // Approve the task in review: it is verified in its note, mirrored in the workflow note, and what waited for it is free
  await page.getByRole('button', { name: 'Approve: T1' }).click();
  await expect(page.locator('[data-column="verified"] [data-task="T1"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-task="T2"] [data-dependency="T1"]')).toHaveAttribute('data-met', 'true');
  expect(readMeta(path.join(vault, 'agents', 'task-T1.md')).status).toBe('verified');
  expect(readMeta(path.join(vault, 'agents', 'wf-WF1-demo.md')).tasks[0].status).toBe('verified');
  expect(fs.readFileSync(path.join(vault, 'agents', 'task-T1.md'), 'utf8')).toContain('GateApproved');
  expect(fs.readFileSync(path.join(vault, 'Journal.md'), 'utf8')).toBe('# Journal\n\nnothing here\n');

  // A task note opens from its card
  await page.locator('[data-task="T2"]').getByRole('button', { name: 'Publish it' }).click();
  await expect(win.getByTestId('workflows-page')).toHaveCount(0);
});
