// ProseMirror document -> Markdown text (ADR 0001). The output style is fixed so diffs stay quiet:
// "-" bullets, "1." ordered lists, ATX headings, *italic* and **bold**, the shortest safe code fence,
// "\" hard breaks, tables without column padding.
import { MarkdownSerializer, type MarkdownSerializerState } from 'prosemirror-markdown';
import { Fragment, type Mark, type Node as PMNode } from '@tiptap/pm/model';
import { COMMENT, HIGHLIGHT, INLINE_MATH } from './syntax';

type State = MarkdownSerializerState & { inAutolink?: boolean; out: string; atBlockStart: boolean };

/**
 * What in a block's inline content could be read as the start or end of our own paired syntax.
 * Decided for the whole block, not per text node, and deliberately generous: a pair can straddle a
 * bold or italic boundary (the delimiters those marks write sit between the two halves), so looking at
 * the plain text alone is not enough.
 */
interface Pairs { math: boolean; highlight: boolean; comment: boolean; tagClose: boolean }
const pairCache = new WeakMap<PMNode, Pairs>();
function pairsIn(block: PMNode): Pairs {
  let found = pairCache.get(block);
  if (!found) {
    const t = block.textContent;
    let hasHighlight = false;
    let inlineMath = 0;
    let rawInline = false;
    block.descendants((n) => {
      if (n.type.name === 'inlineMath') inlineMath++;
      if (n.type.name === 'rawInline') rawInline = true;
      if (n.isText && hasMark(n, 'highlight')) hasHighlight = true;
      return true;
    });
    const dollars = [...t.matchAll(/\$(.?)/g)];
    const prices = dollars.every((m) => /\d/.test(m[1]));
    found = {
      // two or more dollars (or one next to an inline formula) that are not all "$5"-style prices
      math: (dollars.length + inlineMath * 2 >= 2 && !prices) || INLINE_MATH.test(t),
      highlight: ((t.match(/==/g)?.length ?? 0) >= 2) || (hasHighlight && t.includes('==')) || HIGHLIGHT.test(t),
      comment: ((t.match(/%%/g)?.length ?? 0) >= 2) || COMMENT.test(t),
      // a tag can only open if a ">" can close it somewhere in the block (text or raw inline HTML)
      tagClose: t.includes('>') || rawInline,
    };
    pairCache.set(block, found);
  }
  return found;
}

/** Marks a character that must be written escaped; resolved to a backslash after the CommonMark escaper has run. */
const ESC = '\uE000';
/** Stands in for an underscore that must be written as "\\_" (see markSyntax). */
const UNDERSCORE = '\uE001';

/**
 * Where ordinary text would be read as syntax, put ESC in front of the character. Everything we escape
 * ourselves goes through here, before prosemirror-markdown's own escaper, so no backslash is ever added
 * twice and none is mistaken for one the user typed.
 */
function markSyntax(line: string, block: PMNode, atLineStart: boolean, highlighted: boolean): string {
  const pairs = pairsIn(block);
  const isWord = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}]/u.test(c);
  let out = line
    // prosemirror-markdown leaves "_" bare between two "word characters" and counts "_" as one itself, so
    // "__a__" would come out as "\\__a_\\_" and read back as emphasis; here it is bare only between letters/digits
    .replace(/_/g, (m, i: number) => (isWord(line[i - 1]) && isWord(line[i + 1]) ? m : UNDERSCORE));
  if (pairs.highlight || highlighted) out = out.replace(/=/g, ESC + '=');
  else if (atLineStart) out = out.replace(/^(\s*)(=+)(\s*)$/, (_m, a: string, b: string, c: string) => `${a}${ESC}${b[0]}${b.slice(1)}${c}`); // setext underline
  if (pairs.comment) out = out.replace(/%/g, ESC + '%');
  if (pairs.math) out = out.replace(/\$/g, ESC + '$');
  if (atLineStart) {
    out = out
      .replace(/^(\s*)\+(?=\s|$)/, `$1${ESC}+`)
      .replace(/^(\s*\d+)([.)])(?=\s|$)/, `$1${ESC}$2`);
  }
  return out
    // "<" can open an HTML tag or comment; at the start of a line even a bare "<div" opens an HTML block
    .replace(/<(?=[A-Za-z/!?])/g, (m, offset: number) => ((atLineStart && offset === 0) || pairs.tagClose ? ESC + m : m))
    .replace(/&(?=#?\w+;)/g, ESC + '&');
}

/** How many lists of these kinds directly precede this one (they would merge with it if written alike). */
function precedingLists(parent: PMNode, index: number, types: string[], node?: PMNode): number {
  const known = node ? topLevelOrdinal.get(node) : undefined;
  if (known !== undefined) return known;
  let n = 0;
  for (let i = index - 1; i >= 0 && types.includes(parent.child(i).type.name); i--) n++;
  return n;
}

/** For top-level lists, serialized one block at a time (see serializeMarkdownBody), where the siblings are not in view. */
const topLevelOrdinal = new WeakMap<PMNode, number>();

const BULLETS = ['-', '*', '+'];
const bulletFor = (parent: PMNode, index: number, node: PMNode): string => BULLETS[precedingLists(parent, index, ['bulletList', 'taskList'], node) % BULLETS.length];

function hasMark(node: PMNode, name: string): boolean {
  return node.marks.some((m) => m.type.name === name);
}

function backticks(node: PMNode, side: number): string {
  const ticks = /`+/g;
  let m: RegExpExecArray | null;
  let len = 0;
  if (node.isText && node.text) while ((m = ticks.exec(node.text))) len = Math.max(len, m[0].length);
  let result = len > 0 && side > 0 ? ' `' : '`';
  for (let i = 0; i < len; i++) result += '`';
  if (len > 0 && side < 0) result += ' ';
  return result;
}

function isPlainUrl(link: Mark, parent: PMNode, index: number): boolean {
  const href = String(link.attrs.href ?? '');
  if (link.attrs.title || !/^\w+:/.test(href)) return false;
  const content = parent.child(index);
  if (!content.isText || content.text !== href || content.marks[content.marks.length - 1] !== link) return false;
  return index === parent.childCount - 1 || !link.isInSet(parent.child(index + 1).marks);
}

const escapeInTarget = (s: string): string => s.replace(/[()\\\s<>]/g, (c) => (/\s/.test(c) ? encodeURIComponent(c) : `\\${c}`));

/** The shortest fence its content cannot close. A language containing a backtick needs tildes (a backtick fence's info string may not). */
function fenceFor(text: string, language: string): string {
  const char = language.includes('`') ? '~' : '`';
  const run = new RegExp(`${char === '`' ? '`' : '~'}{3,}`, 'g');
  const longest = Math.max(0, ...[...text.matchAll(run)].map((m) => m[0].length));
  return char.repeat(Math.max(3, longest + 1));
}

function cellText(cell: PMNode): string {
  const inner = new MarkdownSerializer(nodes, marks, { strict: false });
  return inner
    .serialize(cell, { tightLists: true })
    .replace(/\\\n/g, '<br>')
    .replace(/\n+/g, '<br>')
    .replace(/\|/g, '\\|')
    .trim();
}

const nodes: ConstructorParameters<typeof MarkdownSerializer>[0] = {
  paragraph(state, node) {
    // An empty paragraph has no Markdown form; writing nothing (and not closing a block) keeps its
    // neighbours exactly as they would be written without it.
    if (node.content.size === 0) return;
    state.renderInline(node);
    state.closeBlock(node);
  },
  heading(state, node) {
    state.write(state.repeat('#', Number(node.attrs.level)) + (node.content.size ? ' ' : ''));
    state.renderInline(node, false);
    state.closeBlock(node);
  },
  blockquote(state, node) {
    state.wrapBlock('> ', null, node, () => state.renderContent(node));
  },
  callout(state, node) {
    const a = node.attrs;
    state.wrapBlock('> ', null, node, () => {
      state.write(`[!${a.kind}]${a.fold}${a.title ? ` ${a.title}` : ''}`);
      state.ensureNewLine();
      state.renderContent(node);
    });
  },
  horizontalRule(state, node) {
    state.write('---');
    state.closeBlock(node);
  },
  codeBlock(state, node) {
    const text = node.textContent;
    const language = String(node.attrs.language ?? '');
    const fence = fenceFor(text, language);
    state.write(`${fence}${language}\n`);
    state.text(text, false);
    state.ensureNewLine();
    state.write(fence);
    state.closeBlock(node);
  },
  bulletList(state, node, parent, index) {
    const marker = bulletFor(parent, index, node);
    state.renderList(node, '  ', () => `${marker} `);
  },
  orderedList(state, node, parent, index) {
    const start = Number(node.attrs.start ?? 1);
    const width = String(start + node.childCount - 1).length;
    const indent = state.repeat(' ', width + 2);
    const mark = precedingLists(parent, index, ['orderedList'], node) % 2 ? ')' : '.';
    state.renderList(node, indent, (i) => `${start + i}${mark} `);
  },
  listItem(state, node) {
    // An item that starts with an empty paragraph and goes on to nested content: "- - -" would be a thematic
    // break, so the marker stands alone on its line and the content follows on the next.
    if (node.childCount > 1 && node.firstChild?.type.name === 'paragraph' && node.firstChild.content.size === 0) state.ensureNewLine();
    state.renderContent(node);
  },
  taskList(state, node, parent, index) {
    const marker = bulletFor(parent, index, node);
    state.renderList(node, '  ', () => `${marker} `);
  },
  taskItem(state, node) {
    state.write(node.attrs.checked ? '[x] ' : '[ ] ');
    state.renderContent(node);
  },
  image(state, node) {
    const alt = state.esc(String(node.attrs.alt ?? ''));
    const title = node.attrs.title ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"` : '';
    state.write(`![${alt}](${escapeInTarget(String(node.attrs.src))}${title})`);
    state.closeBlock(node);
  },
  hardBreak(state, node, parent, index) {
    if (parent.type.name === 'heading') { // an ATX heading is one line: a break between words is a space, at the edges nothing
      if (index > 0 && index < parent.childCount - 1) state.write(' ');
      return;
    }
    for (let i = index + 1; i < parent.childCount; i++) {
      if (parent.child(i).type !== node.type) {
        state.write('\\\n');
        return;
      }
    }
  },
  text(state, node, parent, index) {
    const s = state as State;
    const text = parent.type.name === 'heading' ? (node.text ?? '').replace(/\n/g, ' ') : (node.text ?? '');
    if (hasMark(node, 'wikilink') || hasMark(node, 'obsidianComment') || s.inAutolink) {
      state.text(text, false);
      return;
    }
    // Same loop as state.text(), with our extra escaping applied after the CommonMark one. Whitespace
    // that Markdown ignores (leading on a line, trailing before a line break) is dropped here so that what
    // we write is what will be read.
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      // a hard break ends the line, so the text after it starts a new one
      const atLineStart = i > 0 || s.atBlockStart || (index > 0 && parent.child(index - 1).type.name === 'hardBreak');
      if (atLineStart) line = line.replace(/^[ \t]+/, '');
      if (i < lines.length - 1) line = line.replace(/[ \t]+$/, '');
      state.write();
      let escaped = state
        .esc(markSyntax(line, parent, atLineStart, hasMark(node, 'highlight')), atLineStart)
        .replace(new RegExp(`${ESC}(.)`, 'gs'), '\\$1')
        .replace(new RegExp(UNDERSCORE, 'g'), '\\_')
        .replace(/\u00A0/g, '&nbsp;');
      // "# title #": a trailing run of # closes an ATX heading, so the last one must not be read as a closer
      if (parent.type.name === 'heading' && index === parent.childCount - 1 && i === lines.length - 1) escaped = escaped.replace(/(?<!\\)(#+)$/, '\\$1');
      s.out += escaped;
      if (i !== lines.length - 1) s.out += '\n';
    }
  },
  table(state, node) {
    const rows: string[][] = [];
    node.forEach((row) => {
      const cells: string[] = [];
      row.forEach((cell) => cells.push(cellText(cell)));
      rows.push(cells);
    });
    const aligns: (string | null)[] = [];
    node.firstChild?.forEach((cell) => aligns.push((cell.attrs.align as string | null) ?? null));
    const line = (cells: string[]): string => `|${cells.map((c) => (c ? ` ${c} ` : ' ')).join('|')}|`;
    const separator = rows[0].map((_, i) => {
      const a = aligns[i];
      return a === 'left' ? ':---' : a === 'right' ? '---:' : a === 'center' ? ':---:' : '---';
    });
    state.text([line(rows[0]), line(separator), ...rows.slice(1).map(line)].join('\n'), false);
    state.closeBlock(node);
  },
  inlineMath(state, node) {
    state.write(`$${node.attrs.latex}$`);
  },
  blockMath(state, node) {
    state.write(`$$\n${node.attrs.latex}\n$$`);
    state.closeBlock(node);
  },
  rawInline(state, node) {
    state.write(String(node.attrs.raw));
  },
  rawBlock(state, node) {
    state.write(String(node.attrs.raw));
    state.closeBlock(node);
  },
};

const marks: ConstructorParameters<typeof MarkdownSerializer>[1] = {
  italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
  bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
  strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  highlight: { open: '==', close: '==', mixable: true, expelEnclosingWhitespace: true },
  underline: { open: '<u>', close: '</u>', mixable: true, expelEnclosingWhitespace: true },
  wikilink: { open: '', close: '', mixable: true },
  obsidianComment: { open: '', close: '', mixable: true },
  code: {
    open: (_s, _m, parent, index) => backticks(parent.child(index), -1),
    close: (_s, _m, parent, index) => backticks(parent.child(index - 1), 1),
    escape: false,
  },
  link: {
    open(state, mark, parent, index) {
      (state as State).inAutolink = isPlainUrl(mark, parent, index);
      return (state as State).inAutolink ? '<' : '[';
    },
    close(state, mark) {
      const auto = (state as State).inAutolink;
      (state as State).inAutolink = undefined;
      if (auto) return '>';
      const title = mark.attrs.title ? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"` : '';
      return `](${escapeInTarget(String(mark.attrs.href))}${title})`;
    },
    mixable: true,
  },
};

const serializer = new MarkdownSerializer(nodes, marks, { strict: false });

/**
 * Spaces and tabs next to a line break inside a paragraph mean nothing in Markdown and are not written.
 * They are removed from the document first because prosemirror-markdown's handling of whitespace at the
 * edge of a marked run reads only the first line of the text, and drops the rest when that line ends in a space.
 */
function stripLineEdgeWhitespace(node: PMNode): PMNode {
  if (node.isTextblock && node.type.name !== 'codeBlock') {
    const kids: PMNode[] = [];
    node.forEach((child) => {
      if (child.isText && child.text && /[ \t]\n|\n[ \t]/.test(child.text) && !child.marks.some((m) => m.type.name === 'code')) {
        kids.push(child.type.schema.text(child.text.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n'), child.marks));
      } else kids.push(child);
    });
    return node.copy(Fragment.fromArray(kids));
  }
  if (!node.childCount) return node;
  const kids: PMNode[] = [];
  node.forEach((child) => kids.push(stripLineEdgeWhitespace(child)));
  return node.copy(Fragment.fromArray(kids));
}

/** A list item with no content is "-", not "- " (trailing space); fenced code is left untouched. */
function trimEmptyMarkers(text: string): string {
  let fence: string | null = null;
  return text
    .split('\n')
    .map((line) => {
      const f = /^[\s>]*(`{3,}|~{3,})/.exec(line)?.[1];
      if (f) {
        if (fence === null) fence = f;
        else if (f.startsWith(fence[0]) && f.length >= fence.length) fence = null;
        return line;
      }
      return fence === null ? line.replace(/^([\s>]*(?:[-+*]|\d+[.)])) +$/, '$1').replace(/^([\s>]*>) +$/, '$1') : line;
    })
    .join('\n');
}

/**
 * Serialize a document body (frontmatter is handled by the caller). Output ends without a trailing newline.
 *
 * Top-level blocks are written one at a time and joined with a blank line: prosemirror-markdown appends to
 * one growing string and re-reads its end for every block, which made a 1 MB note take 14 seconds. Each
 * block is independent of its siblings except for which marker a list uses, which is passed along.
 */
export function serializeMarkdownBody(doc: PMNode): string {
  const clean = stripLineEdgeWhitespace(doc);
  const lists = ['bulletList', 'taskList'];
  let bullets = 0;
  let ordered = 0;
  const chunks: string[] = [];
  clean.forEach((block) => {
    const name = block.type.name;
    bullets = lists.includes(name) ? bullets + 1 : 0;
    ordered = name === 'orderedList' ? ordered + 1 : 0;
    if (lists.includes(name)) topLevelOrdinal.set(block, bullets - 1);
    if (name === 'orderedList') topLevelOrdinal.set(block, ordered - 1);
    const chunk = trimEmptyMarkers(serializer.serialize(clean.copy(Fragment.from(block)), { tightLists: true }));
    if (chunk.trim()) chunks.push(chunk.replace(/\n+$/, ''));
  });
  return chunks.join('\n\n');
}

/** Rows and cells have no entry of their own: the `table` entry writes them. */
const WRITTEN_BY_TABLE = ['tableRow', 'tableCell', 'tableHeader'];

/** Which node and mark types the serializer can write (for the schema-coverage test). */
export function serializerEntries(): { nodes: string[]; marks: string[] } {
  return { nodes: [...Object.keys(nodes), ...WRITTEN_BY_TABLE], marks: Object.keys(marks) };
}
