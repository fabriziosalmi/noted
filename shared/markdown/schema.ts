// The document model for Markdown notes: the ProseMirror schema the codec parses into and
// serializes from (ADR 0001). It is the editor's schema without any UI: no node views, no
// placeholders, no plugins, so it also builds in Node (MCP server, importers) without a DOM.
//
// The editor composes these same extensions with its UI ones; the codec tests fail if a node or mark
// is added here without a Markdown parser and serializer entry.
import { getSchema, Mark, Node, mergeAttributes, type AnyExtension } from '@tiptap/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { StarterKit } from '@tiptap/starter-kit';
import { CodeBlock } from '@tiptap/extension-code-block';
import { BulletList, OrderedList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Image } from '@tiptap/extension-image';
import { Mathematics } from '@tiptap/extension-mathematics';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Highlight } from '@tiptap/extension-highlight';
import { Link } from '@tiptap/extension-link';

/**
 * Tight (no blank lines between items) or loose is a property of a list, so the document carries it. It is
 * written into the HTML too (`data-tight`): the editor is fed HTML, and a loose list must stay loose through it.
 */
const tightAttribute = {
  tight: {
    default: true,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-tight') !== 'false',
    renderHTML: (attrs: Record<string, unknown>) => (attrs.tight === false ? { 'data-tight': 'false' } : {}),
  },
};

/** Column alignment of a GFM table, kept on its cells (and in the HTML as `data-align`). */
const alignAttribute = {
  align: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-align') || null,
    renderHTML: (attrs: Record<string, unknown>) => (attrs.align ? { 'data-align': String(attrs.align) } : {}),
  },
};

/**
 * A fenced code block keeps its whole info string (```` ```python {1,3} title="a.py" ````), not just the language.
 * The class on <code> carries the first word, which is what highlighting needs; the rest rides in `data-info`.
 * Works on any code-block extension, so the editor's highlighting version keeps the same shape.
 */
export function withCodeInfo<T extends AnyExtension>(extension: T): T {
  return (extension as unknown as { extend(config: object): T }).extend({
    addAttributes(this: { parent?: () => Record<string, object> }) {
      return {
        ...this.parent?.(),
        language: {
          default: null,
          rendered: false,
          parseHTML: (el: HTMLElement) => {
            const code = el.firstElementChild;
            const info = code?.getAttribute('data-info');
            if (info) return info;
            const fromClass = [...(code?.classList ?? [])].find((c) => c.startsWith('language-'));
            return fromClass ? fromClass.slice('language-'.length) : null;
          },
        },
      };
    },
    renderHTML(this: { options: { HTMLAttributes: object; languageClassPrefix: string } }, { node, HTMLAttributes }: { node: PMNode; HTMLAttributes: object }) {
      const info = (node.attrs.language as string | null) ?? '';
      const first = info.split(/\s+/)[0];
      return [
        'pre',
        mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
        ['code', { class: first ? `${this.options.languageClassPrefix}${first}` : null, 'data-info': info !== first ? info : null }, 0],
      ];
    },
  });
}

/**
 * `[[target#heading|alias]]`, `![[embed|size]]`: the text stays literal in the document (so Markdown,
 * the index and the editor all see the same characters) and carries this mark with the note name.
 */
export const WikilinkMark = Mark.create({
  name: 'wikilink',
  // Innermost of the text marks, so a link inside bold or italic is written once inside it ("**[[a]]b**"),
  // not by closing and reopening the bold around it ("**[[a]]****b**" reads back as asterisks).
  priority: 1,
  keepOnSplit: false,
  inclusive: false,
  addAttributes() {
    return {
      target: { default: null },
      embed: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-embed') === 'true',
        renderHTML: (attrs: Record<string, unknown>) => (attrs.embed ? { 'data-embed': 'true' } : {}),
      },
    };
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
    return { raw: { default: '', rendered: false, parseHTML: (el: HTMLElement) => el.textContent ?? '' } };
  },
  parseHTML() {
    // before the generic <pre> rule of code blocks
    return [{ tag: 'pre[data-raw-block]', priority: 100 }];
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
    return { raw: { default: '', rendered: false, parseHTML: (el: HTMLElement) => el.textContent ?? '' } };
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
    const data = (attr: string, fallback: string) => ({
      default: fallback,
      parseHTML: (el: HTMLElement) => el.getAttribute(`data-${attr}`) ?? fallback,
      renderHTML: (attrs: Record<string, unknown>) => (attrs[attr] ? { [`data-${attr}`]: String(attrs[attr]) } : {}),
    });
    return { kind: data('kind', 'note'), fold: data('fold', ''), title: data('title', '') };
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const kind = String(node.attrs.kind);
    const label = String(node.attrs.title || kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase());
    // data-callout selects the style, data-label is its heading; neither is read back
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': kind.toLowerCase(), 'data-label': label }), 0];
  },
});

/**
 * Versions of a few extensions with editor-only behaviour (a node view, a click handler, a translated
 * tooltip). They must define the same node or mark, with the same attributes; a test compares schemas.
 */
export interface DocumentExtensionOverrides {
  codeBlock?: AnyExtension;
  link?: AnyExtension;
  table?: AnyExtension;
  wikilink?: AnyExtension;
}

/** The extensions that define what a note can contain. */
export function documentExtensions(overrides: DocumentExtensionOverrides = {}): AnyExtension[] {
  return [
    // StarterKit supplies document, paragraph, text, heading, blockquote, codeBlock, hardBreak,
    // horizontalRule, listItem and the bold/italic/strike/code/underline marks; lists and link are ours.
    StarterKit.configure({ bulletList: false, orderedList: false, link: false, codeBlock: false }),
    overrides.codeBlock ?? withCodeInfo(CodeBlock),
    BulletList.extend({ addAttributes() { return { ...this.parent?.(), ...tightAttribute }; } }),
    OrderedList.extend({ addAttributes() { return { ...this.parent?.(), ...tightAttribute }; } }),
    TaskList.extend({ addAttributes() { return { ...this.parent?.(), ...tightAttribute }; } }),
    TaskItem.configure({ nested: true }),
    overrides.table ?? Table,
    TableRow,
    TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...alignAttribute }; } }),
    TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...alignAttribute }; } }),
    Image.configure({ inline: false, allowBase64: true }),
    Mathematics,
    Highlight,
    overrides.link ?? Link.configure({ openOnClick: false }),
    overrides.wikilink ?? WikilinkMark,
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
