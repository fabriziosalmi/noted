// Candidate pipelines. Each exposes roundTrip(md) -> md'.
//
//   remark          Markdown -> mdast -> Markdown (remark). No editor: the ceiling of "a remark/mdast
//                   bridge", since any bridge into ProseMirror can only lose more than this.
//   tiptap-stock    @tiptap/markdown with the extensions the app already uses, nothing custom.
//   tiptap-custom   the same plus ~150 lines of custom extensions (wikilinks, embeds, callouts,
//                   comments, raw HTML/definition blocks) registered through the extension's own API.
//
// Frontmatter is split off before the editor ever sees it and glued back after (see splitFrontmatter):
// whatever the pipeline, the YAML block is stored and restored as the exact bytes the user had.

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'DOMParser', 'MutationObserver', 'getComputedStyle']) {
  if (!(k in globalThis) || k === 'navigator') {
    try { Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true }); } catch { /* read-only global */ }
  }
}

const { Editor, Node, Mark, mergeAttributes } = await import('@tiptap/core');
const { default: StarterKit } = await import('@tiptap/starter-kit');
const { Table, TableRow, TableCell, TableHeader } = await import('@tiptap/extension-table');
const { default: Image } = await import('@tiptap/extension-image');
const { default: TaskList } = await import('@tiptap/extension-task-list');
const { default: TaskItem } = await import('@tiptap/extension-task-item');
const { default: Highlight } = await import('@tiptap/extension-highlight');
const { default: Link } = await import('@tiptap/extension-link');
const { Mathematics } = await import('@tiptap/extension-mathematics');
const { Markdown } = await import('@tiptap/markdown');
const { unified } = await import('unified');
const { default: remarkParse } = await import('remark-parse');
const { default: remarkGfm } = await import('remark-gfm');
const { default: remarkMath } = await import('remark-math');
const { default: remarkFrontmatter } = await import('remark-frontmatter');
const { default: remarkStringify } = await import('remark-stringify');

// ── frontmatter ────────────────────────────────────────────────────────────
const FM = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
export function splitFrontmatter(md) {
  const m = FM.exec(md);
  return m ? { fm: m[0], body: md.slice(m[0].length) } : { fm: '', body: md };
}
const join = (fm, body) => (fm ? fm.replace(/\n*$/, '\n') + (body ? '\n' + body : '') : body);

// ── remark ─────────────────────────────────────────────────────────────────
const remark = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkStringify, { bullet: '-', emphasis: '*', strong: '*', fences: true, listItemIndent: 'one', rule: '-', resourceLink: false });

export const remarkPipeline = {
  name: 'remark',
  roundTrip(md) {
    return String(remark.processSync(md)).replace(/\n$/, md.endsWith('\n') ? '\n' : '');
  },
};

// ── tiptap, stock ──────────────────────────────────────────────────────────
function appExtensions() {
  return [
    StarterKit.configure({ link: false }),
    Table, TableRow, TableCell, TableHeader,
    Image.configure({ inline: false }),
    Mathematics,
    TaskList, TaskItem.configure({ nested: true }),
    Highlight,
    Link.configure({ openOnClick: false }),
  ];
}

function makeEditor(extensions) {
  return new Editor({ extensions: [...extensions, Markdown], content: '' });
}

function tiptapRoundTrip(editor, md) {
  const { fm, body } = splitFrontmatter(md);
  const json = editor.markdown.parse(body);
  editor.commands.setContent(json);
  return join(fm, editor.getMarkdown());
}

const stockEditor = makeEditor(appExtensions());
export const tiptapStock = {
  name: 'tiptap-stock',
  roundTrip: (md) => tiptapRoundTrip(stockEditor, md),
};

// ── tiptap, with custom extensions ─────────────────────────────────────────
// Obsidian wikilink / embed: [[target#heading|alias]] and ![[target|size]].
const WIKI = /^(!?)\[\[([^\]|#^]+?)(?:#(\^?[^\]|]+))?(?:\|([^\]]+))?\]\]/;
const Wikilink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() { return { target: { default: '' }, heading: { default: null }, alias: { default: null }, embed: { default: false } }; },
  parseHTML() { return [{ tag: 'span[data-wikilink]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-wikilink': HTMLAttributes.target }), HTMLAttributes.alias || HTMLAttributes.target]; },
  markdownTokenizer: {
    name: 'wikilink',
    level: 'inline',
    start: (src) => { const i = src.search(/!?\[\[/); return i; },
    tokenize: (src) => {
      const m = WIKI.exec(src);
      return m ? { type: 'wikilink', raw: m[0], embed: !!m[1], target: m[2], heading: m[3] ?? null, alias: m[4] ?? null } : undefined;
    },
  },
  parseMarkdown: (token, h) => h.createNode('wikilink', { target: token.target, heading: token.heading, alias: token.alias, embed: token.embed }),
  renderMarkdown: (node) => {
    const a = node.attrs;
    return `${a.embed ? '!' : ''}[[${a.target}${a.heading ? '#' + a.heading : ''}${a.alias ? '|' + a.alias : ''}]]`;
  },
});

// Obsidian comment: %%text%%
const Comment = Node.create({
  name: 'obsidianComment',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() { return { text: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-comment]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', { 'data-comment': HTMLAttributes.text }]; },
  markdownTokenizer: {
    name: 'obsidianComment',
    level: 'inline',
    start: (src) => src.indexOf('%%'),
    tokenize: (src) => { const m = /^%%([^%]+?)%%/.exec(src); return m ? { type: 'obsidianComment', raw: m[0], text: m[1] } : undefined; },
  },
  parseMarkdown: (token, h) => h.createNode('obsidianComment', { text: token.text }),
  renderMarkdown: (node) => `%%${node.attrs.text}%%`,
});

// Raw blocks: anything the schema has no node for (HTML blocks, link reference definitions,
// footnote definitions) is kept as its original text and written back untouched.
const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  addAttributes() { return { raw: { default: '' } }; },
  parseHTML() { return [{ tag: 'pre[data-raw]' }]; },
  renderHTML({ HTMLAttributes }) { return ['pre', { 'data-raw': '1' }, HTMLAttributes.raw]; },
  markdownTokenName: 'html',
  parseMarkdown: (token, h) => h.createNode('rawBlock', { raw: String(token.raw).replace(/\n+$/, '') }),
  renderMarkdown: (node) => node.attrs.raw,
});
const RawDef = RawBlock.extend({
  name: 'rawDef',
  markdownTokenName: 'def',
  parseMarkdown: (token, h) => h.createNode('rawDef', { raw: String(token.raw).replace(/\n+$/, '') }),
});

// Callout: a blockquote whose first line is "[!type]± title".
const CALLOUT = /^\[!([A-Za-z-]+)\]([+-]?)[ \t]*([^\n]*)\n?/;
const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() { return { kind: { default: 'note' }, fold: { default: '' }, title: { default: '' } }; },
  parseHTML() { return [{ tag: 'div[data-callout]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes({ 'data-callout': HTMLAttributes.kind }), 0]; },
  markdownTokenName: 'blockquote',
  parseMarkdown: (token, h) => {
    const first = token.tokens?.[0];
    const text = first?.type === 'paragraph' ? first.text ?? first.raw : '';
    const m = CALLOUT.exec(text);
    if (!m) return { type: 'blockquote', content: h.parseChildren(token.tokens ?? []) };
    const rest = text.slice(m[0].length);
    const content = [];
    if (rest.trim()) content.push({ type: 'paragraph', content: h.parseInline(first.tokens ? stripLeadingLine(first.tokens) : [{ type: 'text', raw: rest, text: rest }]) });
    content.push(...h.parseChildren((token.tokens ?? []).slice(1)));
    return { type: 'callout', attrs: { kind: m[1], fold: m[2], title: m[3] }, content: content.length ? content : [{ type: 'paragraph' }] };
  },
  renderMarkdown: (node, h) => {
    const a = node.attrs;
    const head = `[!${a.kind}]${a.fold}${a.title ? ' ' + a.title : ''}`;
    const body = h.renderChildren(node.content ?? [], '\n\n');
    return [head, ...body.split('\n')].map((l) => (l ? `> ${l}` : '>')).join('\n');
  },
});
function stripLeadingLine(tokens) {
  // drop the "[!kind] title" line (and the break after it) from the first paragraph's inline tokens
  const out = [];
  let dropping = true;
  for (const t of tokens) {
    if (dropping) {
      if (t.type === 'br' || (t.type === 'text' && /\n/.test(t.raw ?? ''))) {
        dropping = false;
        const after = (t.raw ?? '').split('\n').slice(1).join('\n');
        if (after) out.push({ ...t, raw: after, text: after });
      }
      continue;
    }
    out.push(t);
  }
  return out;
}

const customEditor = makeEditor([...appExtensions(), Wikilink, Comment, RawBlock, RawDef, Callout]);
export { customEditor };
export const tiptapCustom = {
  name: 'tiptap-custom',
  roundTrip: (md) => tiptapRoundTrip(customEditor, md),
};

// ── helpers for the report ─────────────────────────────────────────────────
/** mdast of a document with positions stripped: "do these mean the same thing?" */
export function meaning(md) {
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm).use(remarkMath).parse(md);
  return JSON.stringify(tree, (k, v) => (k === 'position' ? undefined : v));
}

export const PIPELINES = [remarkPipeline, tiptapStock, tiptapCustom];
