// Markdown text -> ProseMirror document (ADR 0001). markdown-it parses; the rules below add the
// Obsidian-style syntax and reshape a few tokens so they fit the editor's schema; prosemirror-markdown
// turns the tokens into nodes. Anything the schema cannot hold becomes a raw node, never a loss.
import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
import type { StateBlock, StateCore } from 'markdown-it';
import { MarkdownParser, type ParseSpec } from 'prosemirror-markdown';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { documentSchema } from './schema';
import { COMMENT, HIGHLIGHT, INLINE_MATH, wikilinkTarget } from './syntax';

const anchored = (re: RegExp): RegExp => new RegExp(`^(?:${re.source})`);
const HIGHLIGHT_AT = anchored(HIGHLIGHT);
const MATH_AT = anchored(INLINE_MATH);
const COMMENT_AT = anchored(COMMENT);

type Meta = Record<string, unknown>;
const meta = (tok: Token): Meta => (tok.meta ?? {}) as Meta;

const CALLOUT_HEAD = /^\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*([^\n]*)(?:\n|$)/;
const TASK_PREFIX = /^\[([ xX])\] /;
const ALIGN = /text-align:\s*(\w+)/;

function createMarkdownIt(): InstanceType<typeof MarkdownIt> {
  const md = new MarkdownIt('commonmark', { html: true }).enable(['table', 'strikethrough']);

  // [[target#heading|alias]] and ![[target|size]]: the literal text is kept, under a wikilink mark.
  md.inline.ruler.before('image', 'wikilink', (state, silent) => {
    const { src, pos } = state;
    const embed = src[pos] === '!';
    const start = embed ? pos + 1 : pos;
    if (src.slice(start, start + 2) !== '[[') return false;
    const end = src.indexOf(']]', start + 2);
    if (end === -1 || end + 2 > state.posMax) return false; // never read past the range being tokenized
    const inner = src.slice(start + 2, end);
    if (!inner || /[\n[\]]/.test(inner)) return false;
    const target = wikilinkTarget(inner);
    if (!target) return false;
    if (!silent) {
      state.push('wikilink_open', 'span', 1).meta = { target, embed };
      const text = state.push('text', '', 0);
      text.content = src.slice(pos, end + 2);
      state.push('wikilink_close', 'span', -1);
    }
    state.pos = end + 2;
    return true;
  });

  // %%comment%%
  md.inline.ruler.before('emphasis', 'obsidian_comment', (state, silent) => {
    const m = COMMENT_AT.exec(state.src.slice(state.pos, state.posMax));
    if (!m) return false;
    if (!silent) {
      state.push('obsidian_comment_open', 'span', 1);
      state.push('text', '', 0).content = m[0];
      state.push('obsidian_comment_close', 'span', -1);
    }
    state.pos += m[0].length;
    return true;
  });

  // ==highlight== (the text inside is parsed as inline Markdown, so ==*slanted*== works)
  md.inline.ruler.before('emphasis', 'highlight', (state, silent) => {
    if (state.src.slice(state.pos, state.pos + 2) !== '==') return false;
    const rest = state.src.slice(state.pos, state.posMax);
    const m = HIGHLIGHT_AT.exec(rest);
    if (!m) return false;
    const oldPos = state.pos, oldMax = state.posMax;
    if (!silent) {
      state.push('highlight_open', 'mark', 1);
      state.pos = oldPos + 2;
      state.posMax = oldPos + m[0].length - 2;
      state.md.inline.tokenize(state);
      state.push('highlight_close', 'mark', -1);
      state.posMax = oldMax;
    }
    state.pos = oldPos + m[0].length;
    return true;
  });

  // $inline math$ (not "$$", and not a lone price like "$5 and $6": the content may not touch a space)
  md.inline.ruler.before('escape', 'inline_math', (state, silent) => {
    if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false;
    const m = MATH_AT.exec(state.src.slice(state.pos, state.posMax));
    if (!m) return false;
    if (!silent) state.push('inline_math', '', 0).meta = { latex: m[1] };
    state.pos += m[0].length;
    return true;
  });

  // $$ ... $$ on their own lines
  md.block.ruler.before('fence', 'block_math', (state, start, end, silent) => {
    const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    if (first.trim() !== '$$') return false;
    let line = start + 1;
    while (line < end) {
      const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
      if (text.trim() === '$$') break;
      line++;
    }
    if (line >= end) return false;
    if (silent) return true;
    const tok = state.push('block_math', '', 0);
    tok.meta = { latex: state.getLines(start + 1, line, 0, false).replace(/\n$/, '') };
    tok.map = [start, line + 1];
    state.line = line + 1;
    return true;
  });

  // [^1] references and [^1]: definitions are kept verbatim.
  md.inline.ruler.before('link', 'footnote_ref', (state, silent) => {
    const m = /^\[\^[^\]\s]+\]/.exec(state.src.slice(state.pos, state.posMax));
    if (!m) return false;
    if (!silent) state.push('html_inline', '', 0).content = m[0];
    state.pos += m[0].length;
    return true;
  });
  md.block.ruler.before('reference', 'footnote_def', (state, start, end, silent) => {
    const lineText = (n: number): string => state.src.slice(state.bMarks[n], state.eMarks[n]);
    if (!/^ {0,3}\[\^[^\]\s]+\]:/.test(lineText(start))) return false;
    if (silent) return true;
    // the definition, its indented continuation lines, and directly following definitions
    let last = start;
    for (let n = start + 1; n < end; n++) {
      const text = lineText(n);
      if (/^( {4}|\t)/.test(text) || /^ {0,3}\[\^[^\]\s]+\]:/.test(text)) last = n;
      else if (text.trim() === '' && n + 1 < end && /^( {4}|\t)/.test(lineText(n + 1))) continue;
      else break;
    }
    const tok = state.push('html_block', '', 0);
    tok.content = state.getLines(start, last + 1, state.blkIndent, false);
    tok.map = [start, last + 1];
    state.line = last + 1;
    return true;
  });

  // Link reference definitions are still resolved by markdown-it, but their text is kept too.
  type RuleFn = (state: StateBlock, start: number, end: number, silent: boolean) => boolean;
  const reference = (md.block.ruler as unknown as { __rules__: { name: string; fn: RuleFn }[] }).__rules__.find((r) => r.name === 'reference')?.fn;
  if (reference) {
    md.block.ruler.at('reference', (state, start, end, silent) => {
      const ok = reference(state, start, end, silent);
      if (ok && !silent) {
        const tok = state.push('html_block', '', 0);
        tok.content = state.getLines(start, state.line, state.blkIndent, false).replace(/\n+$/, '');
        tok.map = [start, state.line];
      }
      return ok;
    });
  }

  md.core.ruler.push('noted_structure', structurePass);
  return md;
}

/** Reshape tokens so they fit the schema. One linear pass per concern. */
function structurePass(state: StateCore): void {
  const { Token: TokenCtor } = state;
  const make = (type: string, tag: string, nesting: 1 | 0 | -1): Token => new TokenCtor(type, tag, nesting);
  const src = state.tokens;

  // 1. Lists: tightness, and task lists (every item starts with "[ ] " or "[x] ").
  const listStack: { open: number; tight: boolean; tasks: number; items: number }[] = [];
  const listInfo = new Map<number, { tight: boolean; task: boolean }>();
  for (let i = 0; i < src.length; i++) {
    const t = src[i];
    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
      listStack.push({ open: i, tight: true, tasks: 0, items: 0 });
    } else if (t.type === 'bullet_list_close' || t.type === 'ordered_list_close') {
      const done = listStack.pop();
      if (done) listInfo.set(done.open, { tight: done.tight, task: done.items > 0 && done.tasks === done.items && src[done.open].type === 'bullet_list_open' });
    } else if (listStack.length > 0) {
      const top = listStack[listStack.length - 1];
      if (t.type === 'list_item_open') {
        top.items++;
        const first = src[i + 1]?.type === 'paragraph_open' ? src[i + 2] : undefined;
        if (first?.type === 'inline' && TASK_PREFIX.test(first.content)) top.tasks++;
      } else if (t.type === 'paragraph_open' && !t.hidden && src[i - 1]?.type === 'list_item_open') {
        // a visible paragraph directly in an item of this list: the list is loose
        top.tight = false;
      } else if (t.type === 'paragraph_open' && !t.hidden) {
        top.tight = false;
      }
    }
  }
  const taskLists: boolean[] = [];
  for (let i = 0; i < src.length; i++) {
    const t = src[i];
    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
      const info = listInfo.get(i) ?? { tight: true, task: false };
      t.meta = { tight: info.tight };
      taskLists.push(info.task);
      if (info.task) t.type = 'task_list_open';
    } else if (t.type === 'bullet_list_close' || t.type === 'ordered_list_close') {
      if (taskLists.pop()) t.type = 'task_list_close';
    } else if (t.type === 'list_item_open' && taskLists[taskLists.length - 1]) {
      t.type = 'task_item_open';
      const inline = src[i + 2];
      const m = TASK_PREFIX.exec(inline.content);
      t.meta = { checked: !!m && m[1].toLowerCase() === 'x' };
      inline.content = inline.content.slice(4);
      const first = inline.children?.[0];
      if (first && first.type === 'text') first.content = first.content.slice(4);
    } else if (t.type === 'list_item_close' && taskLists[taskLists.length - 1]) {
      t.type = 'task_item_close';
    }
  }

  // 2. Table cells hold blocks in the schema but inline content in Markdown.
  const out: Token[] = [];
  for (let i = 0; i < src.length; i++) {
    const t = src[i];
    out.push(t);
    if (t.type === 'th_open' || t.type === 'td_open') out.push(make('paragraph_open', 'p', 1));
    const next = src[i + 1];
    if (next && (next.type === 'th_close' || next.type === 'td_close')) out.push(make('paragraph_close', 'p', -1));
  }
  state.tokens = out;
  const toks = state.tokens;

  // 3. Blocks: a lone image is a block node; "> [!kind]" opens a callout.
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === 'paragraph_open') {
      const inline = toks[i + 1];
      if (inline?.type === 'inline' && inline.children?.length === 1 && inline.children[0].type === 'image') {
        t.type = 'image_block_open';
        toks[i + 2].type = 'image_block_close';
      }
    }
  }
  const stack: number[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === 'blockquote_open') {
      stack.push(i);
      const para = toks[i + 1], inline = toks[i + 2];
      const m = para?.type === 'paragraph_open' && inline?.type === 'inline' ? CALLOUT_HEAD.exec(inline.content) : null;
      if (m) {
        t.type = 'callout_open';
        t.meta = { kind: m[1], fold: m[2], title: m[3] };
        const rest = inline.content.slice(m[0].length);
        inline.content = rest;
        inline.children = rest ? state.md.parseInline(rest, state.env)[0].children : [];
        // "> [!kind]" with the body in the blocks that follow: the head paragraph is now empty and goes away
        if (!rest && toks[i + 4] && toks[i + 4].type !== 'blockquote_close') toks.splice(i + 1, 3);
      }
    } else if (t.type === 'blockquote_close') {
      const open = stack.pop();
      if (open !== undefined && toks[open].type === 'callout_open') t.type = 'callout_close';
    }
  }

  // 4. Inline: <br> in a table cell is a line break; <u>..</u> is underline; a mid-line image is raw.
  let inCell = 0;
  for (const t of toks) {
    if (t.type === 'th_open' || t.type === 'td_open') inCell++;
    else if (t.type === 'th_close' || t.type === 'td_close') inCell--;
    else if (t.type === 'inline' && t.children) {
      const kids = t.children;
      const loneImage = kids.length === 1 && kids[0].type === 'image';
      for (let k = 0; k < kids.length; k++) {
        const c = kids[k];
        if (c.type === 'link_open' && kids[k + 1]?.type === 'link_close') {
          // a link with no text has nothing to carry its mark: keep it as written
          const title = c.attrGet('title');
          c.type = 'html_inline';
          c.content = `[](${c.attrGet('href') ?? ''}${title ? ` "${String(title).replace(/"/g, '\\"')}"` : ''})`;
          kids.splice(k + 1, 1);
        } else if (c.type === 'html_inline') {
          if (inCell > 0 && /^<br\s*\/?>$/i.test(c.content)) c.type = 'cell_break';
          else if (/^<u>$/i.test(c.content) && kids.slice(k + 1).some((x) => x.type === 'html_inline' && /^<\/u>$/i.test(x.content))) c.type = 'underline_open';
          else if (/^<\/u>$/i.test(c.content) && kids.slice(0, k).some((x) => x.type === 'underline_open')) c.type = 'underline_close';
        } else if (c.type === 'image' && !loneImage) {
          c.type = 'raw_image';
        }
      }
    }
  }
}

function specs(): Record<string, ParseSpec> {
  return {
    blockquote: { block: 'blockquote' },
    paragraph: { block: 'paragraph' },
    list_item: { block: 'listItem' },
    bullet_list: { block: 'bulletList', getAttrs: (tok) => ({ tight: meta(tok).tight ?? true }) },
    ordered_list: {
      block: 'orderedList',
      getAttrs: (tok) => ({ start: Number(tok.attrGet('start') ?? 1), tight: meta(tok).tight ?? true }),
    },
    task_list: { block: 'taskList', getAttrs: (tok) => ({ tight: meta(tok).tight ?? true }) },
    task_item: { block: 'taskItem', getAttrs: (tok) => ({ checked: !!meta(tok).checked }) },
    heading: { block: 'heading', getAttrs: (tok) => ({ level: Number(tok.tag.slice(1)) }) },
    code_block: { block: 'codeBlock', noCloseToken: true },
    fence: { block: 'codeBlock', getAttrs: (tok) => ({ language: tok.info.trim() || null }), noCloseToken: true },
    hr: { node: 'horizontalRule' },
    image_block: { ignore: true },
    image: {
      node: 'image',
      getAttrs: (tok) => ({ src: tok.attrGet('src'), title: tok.attrGet('title') || null, alt: tok.children?.map((c) => c.content).join('') || null }),
    },
    raw_image: {
      node: 'rawInline',
      getAttrs: (tok) => {
        const alt = tok.children?.map((c) => c.content).join('') ?? '';
        const title = tok.attrGet('title');
        return { raw: `![${alt}](${tok.attrGet('src') ?? ''}${title ? ` "${String(title).replace(/"/g, '\\"')}"` : ''})` };
      },
    },
    hardbreak: { node: 'hardBreak' },
    cell_break: { node: 'hardBreak' },
    em: { mark: 'italic' },
    strong: { mark: 'bold' },
    s: { mark: 'strike' },
    highlight: { mark: 'highlight' },
    underline: { mark: 'underline' },
    wikilink: { mark: 'wikilink', getAttrs: (tok) => ({ target: meta(tok).target, embed: !!meta(tok).embed }) },
    obsidian_comment: { mark: 'obsidianComment' },
    link: { mark: 'link', getAttrs: (tok) => ({ href: tok.attrGet('href'), title: tok.attrGet('title') || null }) },
    code_inline: { mark: 'code', noCloseToken: true },
    table: { block: 'table' },
    thead: { ignore: true },
    tbody: { ignore: true },
    tr: { block: 'tableRow' },
    th: { block: 'tableHeader', getAttrs: (tok) => ({ align: ALIGN.exec(tok.attrGet('style') ?? '')?.[1] ?? null }) },
    td: { block: 'tableCell', getAttrs: (tok) => ({ align: ALIGN.exec(tok.attrGet('style') ?? '')?.[1] ?? null }) },
    callout: { block: 'callout', getAttrs: (tok) => ({ kind: meta(tok).kind, fold: meta(tok).fold, title: meta(tok).title }) },
    inline_math: { node: 'inlineMath', getAttrs: (tok) => ({ latex: meta(tok).latex }) },
    block_math: { node: 'blockMath', getAttrs: (tok) => ({ latex: meta(tok).latex }) },
    html_inline: { node: 'rawInline', getAttrs: (tok) => ({ raw: tok.content }) },
    html_block: { node: 'rawBlock', getAttrs: (tok) => ({ raw: tok.content.replace(/\n+$/, '') }) },
  };
}

export function createMarkdownParser(schema: Schema = documentSchema()): MarkdownParser {
  const parser = new MarkdownParser(schema, createMarkdownIt(), specs());
  // A soft line break inside a paragraph is part of the text, not a space: keep the newline.
  (parser as unknown as { tokenHandlers: Record<string, (state: { addText(t: string): void }) => void> }).tokenHandlers.softbreak =
    (state) => state.addText('\n');
  return parser;
}

let shared: MarkdownParser | null = null;

/** Parse the body of a note (frontmatter already removed). */
export function parseMarkdownBody(markdown: string): PMNode {
  shared ??= createMarkdownParser();
  return shared.parse(markdown);
}
