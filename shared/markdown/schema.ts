// The document model for Markdown notes: the ProseMirror schema the codec parses into and
// serializes from (ADR 0001). It is the editor's schema without any UI: no node views, no
// placeholders, no plugins, so it also builds in Node (MCP server, importers) without a DOM.
//
// The editor composes these same extensions with its UI ones; the codec tests fail if a node or mark
// is added here without a Markdown parser and serializer entry.
import { getSchema, Mark, Node, mergeAttributes, type AnyExtension } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { BulletList, OrderedList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { Mathematics } from '@tiptap/extension-mathematics';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Highlight } from '@tiptap/extension-highlight';
import { Link } from '@tiptap/extension-link';

/** Tight (no blank lines between items) or loose is a property of a list, so the document carries it. */
const tightAttribute = { tight: { default: true, rendered: false } };

/** Column alignment of a GFM table, kept on its cells. */
const alignAttribute = { align: { default: null, rendered: false } };

/**
 * `[[target#heading|alias]]`, `![[embed|size]]`: the text stays literal in the document (so Markdown,
 * the index and the editor all see the same characters) and carries this mark with the note name.
 */
export const WikilinkMark = Mark.create({
  name: 'wikilink',
  priority: 1000,
  keepOnSplit: false,
  inclusive: false,
  addAttributes() {
    return { target: { default: null }, embed: { default: false, rendered: false } };
  },
  parseHTML() {
    return [{ tag: 'span[data-wikilink]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-wikilink': HTMLAttributes.target, class: 'wikilink' }), 0];
  },
});

/** `%%a comment%%` (Obsidian): kept literally, shown muted by the editor. */
export const CommentMark = Mark.create({
  name: 'obsidianComment',
  keepOnSplit: false,
  inclusive: false,
  parseHTML() {
    return [{ tag: 'span[data-obsidian-comment]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-obsidian-comment': '' }), 0];
  },
});

/** Markdown the schema has no node for (HTML blocks, footnote and link definitions): stored and written back verbatim. */
export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { raw: { default: '', rendered: false } };
  },
  parseHTML() {
    return [{ tag: 'pre[data-raw-block]' }];
  },
  renderHTML({ node }) {
    return ['pre', { 'data-raw-block': '' }, String(node.attrs.raw)];
  },
});

/** The inline counterpart: inline HTML (`<kbd>`), footnote references, images that share a line with text. */
export const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { raw: { default: '', rendered: false } };
  },
  parseHTML() {
    return [{ tag: 'span[data-raw-inline]' }];
  },
  renderHTML({ node }) {
    return ['span', { 'data-raw-inline': '' }, String(node.attrs.raw)];
  },
});

/** Obsidian callout: `> [!kind]± title` followed by the quoted body. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      kind: { default: 'note' },
      fold: { default: '' },
      title: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': HTMLAttributes.kind }), 0];
  },
});

/** The extensions that define what a note can contain. */
export function documentExtensions(): AnyExtension[] {
  return [
    // StarterKit supplies document, paragraph, text, heading, blockquote, codeBlock, hardBreak,
    // horizontalRule, listItem and the bold/italic/strike/code/underline marks; lists and link are ours.
    StarterKit.configure({ bulletList: false, orderedList: false, link: false }),
    BulletList.extend({ addAttributes() { return { ...this.parent?.(), ...tightAttribute }; } }),
    OrderedList.extend({ addAttributes() { return { ...this.parent?.(), ...tightAttribute }; } }),
    TaskList.extend({ addAttributes() { return { ...this.parent?.(), ...tightAttribute }; } }),
    TaskItem.configure({ nested: true }),
    Table,
    TableRow,
    TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...alignAttribute }; } }),
    TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...alignAttribute }; } }),
    Image.configure({ inline: false, allowBase64: true }),
    Mathematics,
    Highlight,
    Link.configure({ openOnClick: false }),
    WikilinkMark,
    CommentMark,
    RawBlock,
    RawInline,
    Callout,
  ];
}

let cached: Schema | null = null;

/** The schema built from {@link documentExtensions}, created once. */
export function documentSchema(): Schema {
  cached ??= getSchema(documentExtensions());
  return cached;
}
