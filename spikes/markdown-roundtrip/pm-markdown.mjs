// Candidate: prosemirror-markdown (markdown-it parser + the ProseMirror team's serializer) over
// the app's own TipTap schema, with custom rules for the Obsidian-style extensions. The editor
// keeps working on the same ProseMirror document; only the text <-> document step is replaced.
import { JSDOM } from 'jsdom';
import MarkdownIt from 'markdown-it';
import { MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown';
import { splitFrontmatter } from './pipelines.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document']) if (!(k in globalThis)) globalThis[k] = dom.window[k];

const { Editor, Node } = await import('@tiptap/core');
const { default: StarterKit } = await import('@tiptap/starter-kit');
const { Table, TableRow, TableCell, TableHeader } = await import('@tiptap/extension-table');
const { default: Image } = await import('@tiptap/extension-image');
const { default: TaskList } = await import('@tiptap/extension-task-list');
const { default: TaskItem } = await import('@tiptap/extension-task-item');
const { default: Highlight } = await import('@tiptap/extension-highlight');
const { default: Link } = await import('@tiptap/extension-link');
const { Mathematics } = await import('@tiptap/extension-mathematics');

// ── extra schema pieces ────────────────────────────────────────────────────
const inlineAtom = (name, attrs) => Node.create({
  name, group: 'inline', inline: true, atom: true,
  addAttributes: () => Object.fromEntries(Object.keys(attrs).map((k) => [k, { default: attrs[k] }])),
  parseHTML: () => [{ tag: `span[data-${name}]` }],
  renderHTML: () => ['span', { [`data-${name}`]: '' }],
});
const Wikilink = inlineAtom('wikilink', { target: '', heading: null, alias: null, embed: false });
const Comment = inlineAtom('obsidianComment', { text: '' });
const RawInline = inlineAtom('rawInline', { raw: '' });
const RawBlock = Node.create({
  name: 'rawBlock', group: 'block', atom: true,
  addAttributes: () => ({ raw: { default: '' } }),
  parseHTML: () => [{ tag: 'pre[data-raw]' }],
  renderHTML: () => ['pre', { 'data-raw': '' }],
});
const Callout = Node.create({
  name: 'callout', group: 'block', content: 'block+', defining: true,
  addAttributes: () => ({ kind: { default: 'note' }, fold: { default: '' }, title: { default: '' } }),
  parseHTML: () => [{ tag: 'div[data-callout]' }],
  renderHTML: () => ['div', { 'data-callout': '' }, 0],
});

// tight/loose is a property of a list, so the document has to carry it.
const tightAttr = { tight: { default: true } };
const { BulletList } = await import('@tiptap/extension-list');
const { OrderedList } = await import('@tiptap/extension-list');
const ed = new Editor({
  extensions: [
    StarterKit.configure({ link: false, bulletList: false, orderedList: false }),
    BulletList.extend({ addAttributes() { return { ...this.parent?.(), ...tightAttr }; } }),
    OrderedList.extend({ addAttributes() { return { ...this.parent?.(), ...tightAttr }; } }),
    Table, TableRow,
    TableCell.extend({ addAttributes() { return { ...this.parent?.(), align: { default: null } }; } }),
    TableHeader.extend({ addAttributes() { return { ...this.parent?.(), align: { default: null } }; } }),
    Image.configure({ inline: false }),
    Mathematics,
    TaskList.extend({ addAttributes() { return { ...this.parent?.(), ...tightAttr }; } }),
    TaskItem.configure({ nested: true }),
    Highlight, Link.configure({ openOnClick: false }),
    Wikilink, Comment, RawInline, RawBlock, Callout,
  ],
  content: '',
});
const schema = ed.schema;

// ── markdown-it with the extensions ────────────────────────────────────────
const md = new MarkdownIt('commonmark', { html: true }).enable(['table', 'strikethrough']);

// [[target#heading|alias]] and ![[target|size]]
md.inline.ruler.before('image', 'wikilink', (state, silent) => {
  const src = state.src, pos = state.pos;
  const embed = src[pos] === '!';
  const start = embed ? pos + 1 : pos;
  if (src.slice(start, start + 2) !== '[[') return false;
  const end = src.indexOf(']]', start + 2);
  if (end === -1) return false;
  const inner = src.slice(start + 2, end);
  if (!inner || /[\n\]]/.test(inner)) return false;
  if (!silent) {
    const m = /^([^#|^]+?)(?:#(\^?[^|]+))?(?:\|(.+))?$/.exec(inner);
    if (!m) return false;
    const t = state.push('wikilink', '', 0);
    t.meta = { target: m[1], heading: m[2] ?? null, alias: m[3] ?? null, embed };
  }
  state.pos = end + 2;
  return true;
});
// %%comment%%
md.inline.ruler.before('emphasis', 'obsidianComment', (state, silent) => {
  if (state.src.slice(state.pos, state.pos + 2) !== '%%') return false;
  const end = state.src.indexOf('%%', state.pos + 2);
  if (end === -1) return false;
  if (!silent) { const t = state.push('obsidianComment', '', 0); t.meta = { text: state.src.slice(state.pos + 2, end) }; }
  state.pos = end + 2;
  return true;
});
// ==highlight==
md.inline.ruler.before('emphasis', 'mark', (state, silent) => {
  if (state.src.slice(state.pos, state.pos + 2) !== '==') return false;
  const end = state.src.indexOf('==', state.pos + 2);
  if (end === -1 || end === state.pos + 2) return false;
  if (!silent) {
    state.push('mark_open', 'mark', 1);
    const t = state.push('text', '', 0); t.content = state.src.slice(state.pos + 2, end);
    state.push('mark_close', 'mark', -1);
  }
  state.pos = end + 2;
  return true;
});
// $inline$
md.inline.ruler.before('escape', 'inlineMath', (state, silent) => {
  if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false;
  const m = /^\$([^$\n]+?)\$/.exec(state.src.slice(state.pos));
  if (!m) return false;
  if (!silent) { const t = state.push('inlineMath', '', 0); t.meta = { latex: m[1] }; }
  state.pos += m[0].length;
  return true;
});
// $$ block $$
md.block.ruler.before('fence', 'blockMath', (state, start, end, silent) => {
  const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
  if (first.trim() !== '$$') return false;
  let line = start + 1;
  while (line < end) {
    const l = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
    if (l.trim() === '$$') break;
    line++;
  }
  if (line >= end) return false;
  if (silent) return true;
  const t = state.push('blockMath', '', 0);
  t.meta = { latex: state.getLines(start + 1, line, 0, false).replace(/\n$/, '') };
  t.map = [start, line + 1];
  state.line = line + 1;
  return true;
});

// [^1] references and [^1]: definitions are kept verbatim (raw nodes).
md.inline.ruler.before('link', 'footnoteRef', (state, silent) => {
  const m = /^\[\^[^\]\s]+\]/.exec(state.src.slice(state.pos));
  if (!m) return false;
  if (!silent) { const t = state.push('html_inline', '', 0); t.content = m[0]; }
  state.pos += m[0].length;
  return true;
});
md.block.ruler.before('reference', 'footnoteDef', (state, start, end, silent) => {
  const line = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
  if (!/^\[\^[^\]\s]+\]:/.test(line)) return false;
  if (silent) return true;
  const t = state.push('html_block', '', 0); t.content = line; t.map = [start, start + 1];
  state.line = start + 1;
  return true;
});
{ // link reference definitions: still resolved by markdown-it, but the text is kept too
  const orig = md.block.ruler.__rules__.find((r) => r.name === 'reference').fn;
  md.block.ruler.at('reference', (state, start, end, silent) => {
    const ok = orig(state, start, end, silent);
    if (ok && !silent) {
      const t = state.push('html_block', '', 0);
      t.content = state.getLines(start, state.line, 0, false).replace(/\n+$/, '');
      t.map = [start, state.line];
    }
    return ok;
  });
}

// Structure pass: unwrap block images, add paragraphs inside table cells, mark task lists,
// compute tightness, turn Obsidian callouts into their own tokens, keep raw HTML as raw nodes.
md.core.ruler.push('noted_structure', (state) => {
  const out = [];
  const toks = state.tokens;
  // tight lists + task items
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
      let depth = 0, tight = true, allTask = true, items = 0;
      for (let j = i; j < toks.length; j++) {
        if (toks[j].type.endsWith('_list_open')) depth++;
        if (toks[j].type.endsWith('_list_close')) { depth--; if (depth === 0) break; }
        if (depth === 1 && toks[j].type === 'paragraph_open' && !toks[j].hidden) tight = false;
        if (depth === 1 && toks[j].type === 'list_item_open') {
          items++;
          const inline = toks.slice(j, j + 4).find((x) => x.type === 'inline');
          if (!inline || !/^\[[ xX]\] /.test(inline.content)) allTask = false;
        }
      }
      t.meta = { tight, task: allTask && items > 0 && t.type === 'bullet_list_open' };
    }
  }
  let taskDepth = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') { taskDepth.push(!!t.meta?.task); if (t.meta?.task) t.type = 'task_list_open'; }
    else if (t.type === 'bullet_list_close' || t.type === 'ordered_list_close') { const task = taskDepth.pop(); if (task) t.type = 'task_list_close'; }
    else if (t.type === 'list_item_open' && taskDepth[taskDepth.length - 1]) {
      t.type = 'task_item_open';
      const inline = toks.slice(i, i + 4).find((x) => x.type === 'inline');
      const m = /^\[([ xX])\] /.exec(inline.content);
      t.meta = { checked: m[1].toLowerCase() === 'x' };
      inline.content = inline.content.slice(4);
      inline.children[0].content = inline.children[0].content.slice(4);
    } else if (t.type === 'list_item_close' && taskDepth[taskDepth.length - 1]) t.type = 'task_item_close';
  }
  // table cells need a block child
  for (const t of toks) {
    if (t.type === 'th_open') t.type = 'th_open';
  }
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    out.push(t);
    if (t.type === 'th_open' || t.type === 'td_open') {
      const p = new state.Token('paragraph_open', 'p', 1); out.push(p);
    }
    const next = toks[i + 1];
    if (next && (next.type === 'th_close' || next.type === 'td_close')) out.push(new state.Token('paragraph_close', 'p', -1));
  }
  state.tokens = out;
  // paragraph containing only an image -> block image; blockquote starting with [!kind] -> callout
  for (let i = 0; i < state.tokens.length; i++) {
    const t = state.tokens[i];
    if (t.type === 'paragraph_open') {
      const inline = state.tokens[i + 1];
      if (inline?.type === 'inline' && inline.children?.length === 1 && inline.children[0].type === 'image') {
        t.hidden = false; t.type = 'image_block_open';
        state.tokens[i + 2].type = 'image_block_close';
      }
    }
    if (t.type === 'blockquote_open') {
      const p = state.tokens[i + 1], inline = state.tokens[i + 2];
      const m = p?.type === 'paragraph_open' && inline?.type === 'inline' ? /^\[!([A-Za-z-]+)\]([+-]?)[ \t]*([^\n]*)(?:\n|$)/.exec(inline.content) : null;
      if (m) {
        t.type = 'callout_open'; t.meta = { kind: m[1], fold: m[2], title: m[3] };
        let depth = 0;
        for (let j = i; j < state.tokens.length; j++) {
          if (state.tokens[j].type === 'blockquote_open' || state.tokens[j].type === 'callout_open') depth++;
          if (state.tokens[j].type === 'blockquote_close') { depth--; if (depth === 0) { state.tokens[j].type = 'callout_close'; break; } }
        }
        const rest = inline.content.slice(m[0].length);
        if (rest.trim()) {
          inline.content = rest;
          const re = new state.Token('inline', '', 0);
          inline.children = md.parseInline(rest, state.env)[0].children;
        } else {
          state.tokens.splice(i + 1, 3); // drop the now-empty first paragraph
          if (state.tokens[i + 1]?.type === 'callout_close') state.tokens.splice(i + 1, 0, ...(() => { const a = new state.Token('paragraph_open', 'p', 1), b = new state.Token('inline', '', 0), c = new state.Token('paragraph_close', 'p', -1); b.children = []; b.content = ''; return [a, b, c]; })());
        }
      }
    }
  }
});

const tokens = {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: { block: 'listItem' },
  bullet_list: { block: 'bulletList', getAttrs: (tok) => ({ tight: tok.meta?.tight ?? true }) },
  ordered_list: { block: 'orderedList', getAttrs: (tok) => ({ start: +(tok.attrGet('start') || 1), tight: tok.meta?.tight ?? true }) },
  task_list: { block: 'taskList', getAttrs: (tok) => ({ tight: tok.meta?.tight ?? true }) },
  task_item: { block: 'taskItem', getAttrs: (tok) => ({ checked: !!tok.meta?.checked }) },
  heading: { block: 'heading', getAttrs: (tok) => ({ level: +tok.tag.slice(1) }) },
  code_block: { block: 'codeBlock', noCloseToken: true },
  fence: { block: 'codeBlock', getAttrs: (tok) => ({ language: tok.info.trim() || null }), noCloseToken: true },
  hr: { node: 'horizontalRule' },
  hardbreak: { node: 'hardBreak' },
  em: { mark: 'italic' },
  strong: { mark: 'bold' },
  s: { mark: 'strike' },
  mark: { mark: 'highlight' },
  link: { mark: 'link', getAttrs: (tok) => ({ href: tok.attrGet('href'), title: tok.attrGet('title') || null }) },
  code_inline: { mark: 'code', noCloseToken: true },
  table: { block: 'table' },
  thead: { ignore: true }, tbody: { ignore: true },
  tr: { block: 'tableRow' },
  th: { block: 'tableHeader', getAttrs: (tok) => ({ align: /text-align:\s*(\w+)/.exec(tok.attrGet('style') || '')?.[1] ?? null }) },
  td: { block: 'tableCell', getAttrs: (tok) => ({ align: /text-align:\s*(\w+)/.exec(tok.attrGet('style') || '')?.[1] ?? null }) },
  callout: { block: 'callout', getAttrs: (tok) => ({ kind: tok.meta.kind, fold: tok.meta.fold, title: tok.meta.title }) },
  wikilink: { node: 'wikilink', getAttrs: (tok) => tok.meta },
  obsidianComment: { node: 'obsidianComment', getAttrs: (tok) => tok.meta },
  inlineMath: { node: 'inlineMath', getAttrs: (tok) => tok.meta },
  blockMath: { node: 'blockMath', getAttrs: (tok) => tok.meta },
  html_inline: { node: 'rawInline', getAttrs: (tok) => ({ raw: tok.content }) },
  html_block: { node: 'rawBlock', getAttrs: (tok) => ({ raw: tok.content.replace(/\n+$/, '') }) },
};
// markdown-it names images 'image' (inline); a lone image became image_block above.
tokens.image = { node: 'image', getAttrs: (tok) => ({ src: tok.attrGet('src'), title: tok.attrGet('title') || null, alt: tok.children?.[0]?.content || null }) };
tokens.image_block = { ignore: true };

const parser = new MarkdownParser(schema, md, tokens);
parser.tokenHandlers.softbreak = (state) => state.addText('\n');

// ── serializer ─────────────────────────────────────────────────────────────
const esc = (s) => s;
const serializer = new MarkdownSerializer({
  paragraph(state, node) { state.renderInline(node); state.closeBlock(node); },
  heading(state, node) { state.write(state.repeat('#', node.attrs.level) + ' '); state.renderInline(node, false); state.closeBlock(node); },
  blockquote(state, node) { state.wrapBlock('> ', null, node, () => state.renderContent(node)); },
  callout(state, node) {
    const a = node.attrs;
    state.wrapBlock('> ', `> [!${a.kind}]${a.fold}${a.title ? ' ' + a.title : ''}\n> `, node, () => state.renderContent(node));
  },
  horizontalRule(state, node) { state.write('---'); state.closeBlock(node); },
  codeBlock(state, node) {
    const text = node.textContent;
    const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
    state.write(fence + (node.attrs.language || '') + '\n');
    state.text(text, false);
    state.ensureNewLine();
    state.write(fence);
    state.closeBlock(node);
  },
  bulletList(state, node) { state.renderList(node, '  ', () => '- '); },
  orderedList(state, node) {
    const start = node.attrs.start || 1;
    const maxW = String(start + node.childCount - 1).length;
    const space = state.repeat(' ', maxW + 2);
    state.renderList(node, space, (i) => { const nStr = String(start + i); return state.repeat(' ', maxW - nStr.length) + nStr + '. '; });
  },
  listItem(state, node) { state.renderContent(node); },
  taskList(state, node) { state.renderList(node, '  ', () => '- '); },
  taskItem(state, node) { state.write(node.attrs.checked ? '[x] ' : '[ ] '); state.renderContent(node); },
  image(state, node) {
    state.write('![' + state.esc(node.attrs.alt || '') + '](' + node.attrs.src.replace(/[()]/g, '\\$&') + (node.attrs.title ? ' "' + node.attrs.title.replace(/"/g, '\\"') + '"' : '') + ')');
    state.closeBlock(node);
  },
  hardBreak(state, node, parent, index) {
    for (let i = index + 1; i < parent.childCount; i++) if (parent.child(i).type !== node.type) { state.write('\\\n'); return; }
  },
  text(state, node) { state.text(node.text, !state.inAutolink); },
  table(state, node) {
    const rows = [];
    node.forEach((row) => {
      const cells = [];
      row.forEach((cell) => {
        let text = '';
        const inner = new MarkdownSerializer(serializer.nodes, serializer.marks);
        text = inner.serialize(cell, { tightLists: true }).replace(/\n+/g, ' ').trim().replace(/\|/g, '\\|');
        cells.push(text);
      });
      rows.push(cells);
    });
    // Unpadded cells: editing one cell changes one line in a diff, not the whole table.
    const aligns = [];
    node.firstChild.forEach((cell) => aligns.push(cell.attrs.align));
    const row = (r) => '| ' + r.join(' | ') + ' |';
    const sep = aligns.map((a) => (a === 'left' ? ':---' : a === 'right' ? '---:' : a === 'center' ? ':---:' : '---'));
    const out = [row(rows[0]), row(sep), ...rows.slice(1).map(row)];
    state.write(out.join('\n'));
    state.closeBlock(node);
  },
  wikilink(state, node) { const a = node.attrs; state.write(`${a.embed ? '!' : ''}[[${a.target}${a.heading ? '#' + a.heading : ''}${a.alias ? '|' + a.alias : ''}]]`); },
  obsidianComment(state, node) { state.write(`%%${node.attrs.text}%%`); },
  inlineMath(state, node) { state.write(`$${node.attrs.latex}$`); },
  blockMath(state, node) { state.write(`$$\n${node.attrs.latex}\n$$`); state.closeBlock(node); },
  rawInline(state, node) { state.write(node.attrs.raw); },
  rawBlock(state, node) { state.write(node.attrs.raw); state.closeBlock(node); },
}, {
  italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
  bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
  strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  highlight: { open: '==', close: '==', mixable: true, expelEnclosingWhitespace: true },
  code: {
    open(_state, _mark, parent, index) { return backticks(parent.child(index), -1); },
    close(_state, _mark, parent, index) { return backticks(parent.child(index - 1), 1); },
    escape: false,
  },
  link: {
    open(state, mark, parent, index) { state.inAutolink = isPlainURL(mark, parent, index); return state.inAutolink ? '<' : '['; },
    close(state, mark) {
      const { inAutolink } = state; state.inAutolink = undefined;
      return inAutolink ? '>' : '](' + mark.attrs.href.replace(/[\(\)"]/g, '\\$&') + (mark.attrs.title ? ` "${mark.attrs.title.replace(/"/g, '\\"')}"` : '') + ')';
    },
    mixable: true,
  },
}, { tightLists: true });

function backticks(node, side) {
  const ticks = /`+/g; let m, len = 0;
  if (node.isText) while ((m = ticks.exec(node.text))) len = Math.max(len, m[0].length);
  let result = len > 0 && side > 0 ? ' `' : '`';
  for (let i = 0; i < len; i++) result += '`';
  if (len > 0 && side < 0) result += ' ';
  return result;
}
function isPlainURL(link, parent, index) {
  if (link.attrs.title || !/^\w+:/.test(link.attrs.href)) return false;
  const content = parent.child(index);
  if (!content.isText || content.text !== link.attrs.href || content.marks[content.marks.length - 1] !== link) return false;
  return index === parent.childCount - 1 || !link.isInSet(parent.child(index + 1).marks);
}

export const pmMarkdown = {
  name: 'prosemirror-md',
  roundTrip(text) {
    const { fm, body } = splitFrontmatter(text);
    const doc = parser.parse(body);
    const out = serializer.serialize(doc, { tightLists: true });
    return fm ? fm.replace(/\n*$/, '\n') + (out ? '\n' + out : '') : out;
  },
};
