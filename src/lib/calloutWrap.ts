import type { Editor } from '@tiptap/core';

export type CalloutKind = string;

export interface CalloutWrapResult {
  action: 'wrapped' | 'switched' | 'lifted';
}

/**
 * Toggles a callout around the block at the selection: wraps it in a callout of `kind`, switches the kind
 * when it already sits in a callout of another kind, and lifts it back out when the kind is the same.
 */
export function toggleWrapCallout(editor: Editor, kind: CalloutKind): CalloutWrapResult | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== 'callout') continue;
    if (String(node.attrs.kind).toLowerCase() === kind.toLowerCase()) {
      return editor.chain().focus().lift('callout').run() ? { action: 'lifted' } : null;
    }
    return editor.chain().focus().updateAttributes('callout', { kind }).run() ? { action: 'switched' } : null;
  }
  return editor.chain().focus().wrapIn('callout', { kind }).run() ? { action: 'wrapped' } : null;
}
