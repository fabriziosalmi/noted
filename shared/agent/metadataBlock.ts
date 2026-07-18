// Locate and rewrite the visible `## Agent Metadata` JSON block inside a note.
// Notes are stored as sanitised HTML, so the metadata lands in a
// `<pre><code>…</code></pre>` block with HTML-escaped JSON (marked's default).
// Reading decodes those entities; writing re-encodes them so the file round-
// trips byte-compatibly with the MCP scaffold. Pure string work — no I/O.

import type { AgentMetadata, AgentEvent } from './types';

const CODE_BLOCK_RE = /(<pre>\s*<code[^>]*>)([\s\S]*?)(<\/code>\s*<\/pre>)/gi;

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
export function readAgentMetadata(html: string): AgentMetadata | null {
  CODE_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK_RE.exec(html)) !== null) {
    const parsed = tryParse(decodeEntities(match[2]));
    if (isAgentMetadata(parsed)) return parsed;
  }
  return null;
}

/**
 * Replace the note's agent metadata block with `meta`, preserving the
 * surrounding markup. Returns the updated HTML, or null when no agent block was
 * found (the caller treats that as "not an agent note").
 */
export function writeAgentMetadata(html: string, meta: AgentMetadata): string | null {
  let replaced = false;
  const out = html.replace(CODE_BLOCK_RE, (full, open: string, inner: string, close: string) => {
    if (replaced) return full;
    const parsed = tryParse(decodeEntities(inner));
    if (!isAgentMetadata(parsed)) return full;
    replaced = true;
    return open + encodeEntities(JSON.stringify(meta, null, 2)) + close;
  });
  return replaced ? out : null;
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
