export type AgentNodeStatus =
  | 'draft'
  | 'awaiting_plan_approval'
  | 'ready'
  | 'todo'
  | 'claimed'
  | 'running'
  | 'review'
  | 'verified'
  | 'done'
  | 'blocked'
  | 'failed'
  | 'stale'
  | 'empty'
  | 'pending'
  | string;

export type AgentNoteType = 'workflow' | 'task' | 'runs' | 'reviews' | 'output' | string;

export interface AgentTaskNode {
  id: string;
  title: string;
  parentId: string | null;
  dependsOn: string[];
  file?: string;
  status: AgentNodeStatus;
}

export interface AgentMetadata {
  notedAgent: true;
  schemaVersion: number;
  type: AgentNoteType;
  id?: string;
  workflowId?: string;
  title?: string;
  status?: AgentNodeStatus;
  approvalMode?: string;
  parentId?: string | null;
  dependsOn?: string[];
  owner?: string | null;
  files?: {
    runs?: string;
    reviews?: string;
    output?: string;
  };
  tasks?: AgentTaskNode[];
}

export interface AgentEvent {
  type: string;
  actor: string;
  at: string;
  nodeId?: string;
  status?: string;
  summary?: string;
  details?: Record<string, unknown>;
}

export interface AgentNoteInfo {
  metadata: AgentMetadata | null;
  events: AgentEvent[];
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function extractJsonCodeBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const codeBlockPattern = /<pre><code(?:\s+class="[^"]*")?>([\s\S]*?)<\/code><\/pre>/gi;
  let match: RegExpExecArray | null;
  while ((match = codeBlockPattern.exec(html)) !== null) {
    const raw = decodeHtmlEntities(match[1].trim());
    if (!raw.startsWith('{')) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Ignore non-agent JSON snippets in regular notes.
    }
  }
  return blocks;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isAgentMetadata(value: unknown): value is AgentMetadata {
  return isRecord(value) && value.notedAgent === true && typeof value.type === 'string';
}

function isAgentEvent(value: unknown): value is AgentEvent {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    typeof value.actor === 'string' &&
    typeof value.at === 'string' &&
    value.notedAgent !== true
  );
}

export function parseAgentNote(html: string): AgentNoteInfo {
  const blocks = extractJsonCodeBlocks(html);
  const metadata = blocks.find(isAgentMetadata) ?? null;
  const events = blocks.filter(isAgentEvent);
  return { metadata, events };
}

export function buildAgentTaskTree(tasks: AgentTaskNode[]) {
  const roots: AgentTaskNode[] = [];
  const children = new Map<string, AgentTaskNode[]>();

  for (const task of tasks) {
    if (task.parentId) {
      const bucket = children.get(task.parentId) ?? [];
      bucket.push(task);
      children.set(task.parentId, bucket);
    } else {
      roots.push(task);
    }
  }

  return { roots, children };
}

