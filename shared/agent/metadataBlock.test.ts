import { describe, it, expect } from 'vitest';
import { readAgentMetadata, writeAgentMetadata, renderEventBlockHtml, applyEngineResultToHtml } from './metadataBlock';
import type { AgentMetadata, AgentEvent } from './types';

// Marked HTML-escapes code-block content; the metadata block ships as escaped
// JSON inside <pre><code>. Build one the same way to exercise the round-trip.
function encode(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const meta: AgentMetadata = {
  notedAgent: true,
  schemaVersion: 1,
  type: 'workflow',
  id: 'WF001',
  status: 'draft',
  approvalMode: 'plan',
  updatedAt: '2026-07-19T11:00:00.000Z',
};

const note = (m: AgentMetadata): string =>
  `<h1>WF001</h1><p>goal &amp; scope</p>` +
  `<h2>Agent Metadata</h2><pre><code class="language-json">${encode(JSON.stringify(m, null, 2))}</code></pre>`;

describe('metadataBlock', () => {
  it('reads the agent metadata block, decoding entities', () => {
    const parsed = readAgentMetadata(note(meta));
    expect(parsed).toMatchObject({ notedAgent: true, id: 'WF001', status: 'draft', approvalMode: 'plan' });
  });

  it('returns null when there is no agent block', () => {
    expect(readAgentMetadata('<p>just a note</p>')).toBeNull();
    expect(readAgentMetadata('<pre><code>{"foo":1}</code></pre>')).toBeNull();
  });

  it('rewrites status in place and round-trips', () => {
    const updated = writeAgentMetadata(note(meta), { ...meta, status: 'ready', updatedAt: 'X' });
    expect(updated).not.toBeNull();
    // Surrounding markup is preserved.
    expect(updated).toContain('<h1>WF001</h1>');
    expect(updated).toContain('<h2>Agent Metadata</h2>');
    // Re-reading yields the new values.
    const reparsed = readAgentMetadata(updated!);
    expect(reparsed).toMatchObject({ status: 'ready', updatedAt: 'X', id: 'WF001' });
  });

  it('preserves JSON containing HTML-significant characters', () => {
    const withAngle: AgentMetadata = { ...meta, title: 'a < b & c > d' };
    const updated = writeAgentMetadata(note(meta), withAngle)!;
    // Angle brackets must be encoded so the note stays valid HTML.
    expect(updated).toContain('a &lt; b &amp; c &gt; d');
    expect(readAgentMetadata(updated)).toMatchObject({ title: 'a < b & c > d' });
  });

  it('returns null when asked to write into a non-agent note', () => {
    expect(writeAgentMetadata('<p>no block here</p>', meta)).toBeNull();
  });

  it('renders an event block and applies an engine result end to end', () => {
    const event: AgentEvent = { type: 'GateApproved', actor: 'user', at: '2026-07-19T12:00:00.000Z', status: 'ready' };
    expect(renderEventBlockHtml(event)).toContain('<h2>Event GateApproved</h2>');

    const result = { metadata: { ...meta, status: 'ready' as const }, event };
    const out = applyEngineResultToHtml(note(meta), result)!;
    expect(out).toContain('<h2>Event GateApproved</h2>');
    expect(readAgentMetadata(out)).toMatchObject({ status: 'ready' });
    expect(applyEngineResultToHtml('<p>plain</p>', result)).toBeNull();
  });
});
