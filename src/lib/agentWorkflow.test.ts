import { describe, expect, it } from 'vitest';
import { buildAgentTaskTree, parseAgentNote } from './agentWorkflow';

describe('agentWorkflow', () => {
  it('parses agent metadata and events from rendered note HTML', () => {
    const html = [
      '<h2>Agent Metadata</h2>',
      '<pre><code class="language-json">{',
      '  &quot;notedAgent&quot;: true,',
      '  &quot;schemaVersion&quot;: 1,',
      '  &quot;type&quot;: &quot;workflow&quot;,',
      '  &quot;id&quot;: &quot;WF001&quot;,',
      '  &quot;tasks&quot;: []',
      '}</code></pre>',
      '<h2>Event TaskStatusChanged</h2>',
      '<pre><code class="language-json">{',
      '  &quot;type&quot;: &quot;TaskStatusChanged&quot;,',
      '  &quot;actor&quot;: &quot;codex&quot;,',
      '  &quot;at&quot;: &quot;2026-05-25T10:30:00.000Z&quot;,',
      '  &quot;status&quot;: &quot;review&quot;',
      '}</code></pre>',
    ].join('\n');

    const parsed = parseAgentNote(html);
    expect(parsed.metadata?.type).toBe('workflow');
    expect(parsed.metadata?.id).toBe('WF001');
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].status).toBe('review');
  });

  it('builds a task tree from parentId links', () => {
    const tree = buildAgentTaskTree([
      { id: 'T001', title: 'Parent', parentId: null, dependsOn: [], status: 'todo' },
      { id: 'T001.1', title: 'Child', parentId: 'T001', dependsOn: [], status: 'done' },
    ]);

    expect(tree.roots.map(t => t.id)).toEqual(['T001']);
    expect(tree.children.get('T001')?.map(t => t.id)).toEqual(['T001.1']);
  });
});

