import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { serializeMarkdownBody } from '../../shared/markdown/serializer';

/**
 * Turn the editor's selection into Markdown. A selection that only covers part of a block keeps that block's
 * type (a heading copied from its middle is still a heading), and an empty selection has nothing to copy.
 */
export function selectionToMarkdown(editor: Editor): string {
  const { doc, selection } = editor.state;
  if (selection.empty) return '';

  const blocks: PMNode[] = [];
  doc.forEach((node, offset) => {
    const start = offset;
    const end = offset + node.nodeSize;
    if (end <= selection.from || start >= selection.to) return;

    const contentStart = start + 1;
    const cutFrom = Math.max(selection.from, contentStart) - contentStart;
    const cutTo = Math.min(selection.to, end - 1) - contentStart;
    if (cutTo <= cutFrom) return;

    blocks.push(cutFrom === 0 && cutTo === node.content.size ? node : node.cut(cutFrom, cutTo));
  });

  if (blocks.length === 0) return '';
  return serializeMarkdownBody(doc.type.schema.nodes.doc.create(null, blocks));
}

/**
 * Copy the selection as Markdown. Returns false when there is nothing selected or the clipboard is unavailable,
 * so a caller can fall back to the editor's normal copy.
 */
export async function copySelectionAsMarkdown(editor: Editor): Promise<boolean> {
  const markdown = selectionToMarkdown(editor);
  if (!markdown) return false;
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;

  try {
    await navigator.clipboard.writeText(markdown);
    return true;
  } catch {
    return false;
  }
}
