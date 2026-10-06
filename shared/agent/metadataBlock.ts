// Locate and rewrite the visible `## Agent Metadata` JSON block inside a note.
// A note stored as HTML holds the metadata in a `<pre><code>…</code></pre>` block with HTML-escaped JSON
// (marked's default); reading decodes those entities, writing re-encodes them so the file round-trips
// byte-compatibly with the MCP scaffold. A note stored as Markdown (ADR 0001) holds it in a fenced
// code block, as written. Either way: pure string work, no I/O.

import type { AgentMetadata, AgentEvent } from './types';

const CODE_BLOCK_RE = /(<pre[^>]*>\s*<code[^>]*>)([\s\S]*?)(<\/code>\s*<\/pre>)/gi;
// A fenced block: opening fence (3+ backticks or tildes, optional info), the text, a closing fence at least as long.
const FENCED_RE = /^( {0,3})(`{3,}|~{3,})[^\n`]*\n([\s\S]*?)\n {0,3}\2[`~]*[ \t]*$/gm;

/** A fence longer than any run of backticks in the text, so the text cannot close it. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function encodeEntities(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isAgentMetadata(value: unknown): value is AgentMetadata {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).notedAgent === true &&
    typeof (value as Record<string, unknown>).type === 'string'
  );
}

function tryParse(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** Parse the note's agent metadata block, or null if none is present. */
export function readAgentMetadata(text: string): AgentMetadata | null {
  CODE_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK_RE.exec(text)) !== null) {
    const parsed = tryParse(decodeEntities(match[2]));
    if (isAgentMetadata(parsed)) return parsed;
  }
  FENCED_RE.lastIndex = 0;
  while ((match = FENCED_RE.exec(text)) !== null) {
    const parsed = tryParse(match[3]);
    if (isAgentMetadata(parsed)) return parsed;
  }
  return null;
}

/**
 * Replace the note's agent metadata block with `meta`, preserving the
 * surrounding markup. Returns the updated HTML, or null when no agent block was
 * found (the caller treats that as "not an agent note").
 */
export function writeAgentMetadata(text: string, meta: AgentMetadata): string | null {
  let replaced = false;
  const out = text.replace(CODE_BLOCK_RE, (full, open: string, inner: string, close: string) => {
    if (replaced) return full;
    const parsed = tryParse(decodeEntities(inner));
    if (!isAgentMetadata(parsed)) return full;
    replaced = true;
    return open + encodeEntities(JSON.stringify(meta, null, 2)) + close;
  });
  if (replaced) return out;
  const json = JSON.stringify(meta, null, 2);
  const fenced = text.replace(FENCED_RE, (full, indent: string, _fence: string, inner: string) => {
    if (replaced) return full;
    const parsed = tryParse(inner);
    if (!isAgentMetadata(parsed)) return full;
    replaced = true;
    const fence = fenceFor(json);
    return `${indent}${fence}json\n${json}\n${indent}${fence}`;
  });
  return replaced ? fenced : null;
}

/** The same event block as Markdown, for a note stored as Markdown. */
export function renderEventBlockMarkdown(event: AgentEvent): string {
  const json = JSON.stringify(event, null, 2);
  const fence = fenceFor(json);
  return `---\n\n## Event ${event.type}\n\n${fence}json\n${json}\n${fence}\n`;
}

/** Append-only event block, matching the MCP `## Event` format as HTML. */
export function renderEventBlockHtml(event: AgentEvent): string {
  const json = encodeEntities(JSON.stringify(event, null, 2));
  return `<hr><h2>Event ${encodeEntities(event.type)}</h2><pre><code class="language-json">${json}</code></pre>`;
}

/**
 * Apply an engine result to a note's HTML: rewrite the metadata block and
 * append the event. Returns the new HTML, or null when the note has no agent
 * block. Pure — the renderer uses this to persist an in-app agent action, so it
 * stays byte-consistent with the MCP tools.
 */
export function applyEngineResultToHtml(
  html: string,
  result: { metadata: AgentMetadata; event: AgentEvent },
): string | null {
  const rewritten = writeAgentMetadata(html, result.metadata);
  if (rewritten === null) return null;
  return rewritten + renderEventBlockHtml(result.event);
}
