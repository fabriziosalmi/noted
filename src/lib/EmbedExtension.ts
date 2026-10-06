// `![[Note]]`, `![[Note#Heading]]`, `![[Note#^block]]` and `![[image.png]]` show what they point at, in place, under
// the line that holds them. The text of the link stays in the document (so the Markdown on disk is the Markdown you
// wrote) and what it shows is a read-only widget: it is never part of the document, so it can never be saved into it.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { parseWikilinkText, type WikilinkParts } from '../../shared/vault/wikilink';
import { embedHtml, imageSize, isImageTarget } from './embedContent';

export interface EmbedContext {
  /** The HTML of a note's content (frontmatter apart), or null if it cannot be read. */
  read(noteFile: string): Promise<string | null>;
  /** The note (with .md) a link target points at, or null. */
  resolve(target: string): string | null;
  /** Follow the link as written, the way a click on it in the text would. */
  open(literal: string): void;
  /** Where an image of that name may be, in the order to try them. */
  imageSources(name: string): string[];
  text(key: 'embedLoading' | 'embedMissing' | 'embedOpenAria', params?: Record<string, string>): string;
}

export interface EmbedSite {
  /** Where the widget goes: the end of the block holding the link. */
  pos: number;
  literal: string;
  parts: WikilinkParts;
}

const EMBED = /!\[\[[^\][\n]+\]\]/g;
const LEAF = '￼';

/** Every `![[...]]` in the document, in order, with the end of the block that holds it. */
export function findEmbeds(doc: PMNode): EmbedSite[] {
  const sites: EmbedSite[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code) return false; // `![[x]]` in a code block is code
    const text = node.textBetween(0, node.content.size, '', LEAF);
    for (const found of text.matchAll(EMBED)) {
      const parts = parseWikilinkText(found[0]);
      if (parts && parts.target) sites.push({ pos: pos + 1 + node.content.size, literal: found[0], parts });
    }
    return false;
  });
  return sites;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderImage(site: EmbedSite, body: HTMLElement, ctx: EmbedContext): void {
  const sources = ctx.imageSources(site.parts.target);
  const img = document.createElement('img');
  img.alt = site.parts.target;
  const { width, height } = imageSize(site.parts.alias);
  if (width) img.width = width;
  if (height) img.height = height;
  let tried = 0;
  img.onerror = () => {
    tried++;
    if (tried < sources.length) img.src = sources[tried];
    else body.replaceChildren(el('span', 'embed-missing', ctx.text('embedMissing', { name: site.parts.target })));
  };
  img.src = sources[0];
  body.replaceChildren(img);
}

async function renderNote(site: EmbedSite, body: HTMLElement, ctx: EmbedContext): Promise<void> {
  const file = ctx.resolve(site.parts.target);
  const html = file ? await ctx.read(file) : null;
  const shown = html === null ? null : embedHtml(html, { heading: site.parts.heading, block: site.parts.block });
  if (shown === null) {
    body.replaceChildren(el('span', 'embed-missing', ctx.text('embedMissing', { name: site.parts.target })));
    return;
  }
  // Parsed into an inert document first (the HTML is already sanitized by embedHtml), then its nodes are adopted.
  const holder = document.createElement('div');
  holder.append(...new DOMParser().parseFromString(shown, 'text/html').body.childNodes);
  body.replaceChildren(holder);
}

/** The widget for one embed: filled in when the note has been read, and a click on it follows the link. */
function buildWidget(site: EmbedSite, ctx: EmbedContext): HTMLElement {
  // What a click does is looked up when it happens: the widget outlives the render that made it.
  const now = (): EmbedContext => context ?? ctx;
  const box = el('div', 'embed');
  box.contentEditable = 'false';
  box.setAttribute('data-embed-target', site.literal);
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', ctx.text('embedOpenAria', { name: site.parts.target }));
  const body = el('div', 'embed-body', ctx.text('embedLoading'));
  box.append(body);

  const isImage = isImageTarget(site.parts.target);
  box.addEventListener('click', event => {
    if (isImage) return; // an image is not a note to open
    const anchor = (event.target as HTMLElement).closest('a[href]');
    if (anchor) {
      event.preventDefault(); // never navigate the app away from inside an embed
      const href = anchor.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener');
      else now().open(site.literal);
      return;
    }
    now().open(site.literal);
  });

  if (isImage) renderImage(site, body, ctx);
  else {
    const missing = (): void => body.replaceChildren(el('span', 'embed-missing', ctx.text('embedMissing', { name: site.parts.target })));
    void renderNote(site, body, ctx).catch(missing);
  }
  return box;
}

// There is one editor in a window; it reads what embeds need from the app through this, set by the component that owns
// the editor (the editor itself is made once and must see the vault as it is now).
let context: EmbedContext | null = null;
export function setEmbedContext(next: EmbedContext | null): void {
  context = next;
}

export const embedPluginKey = new PluginKey<DecorationSet>('embeds');

export const EmbedExtension = Extension.create({
  name: 'embeds',
  addProseMirrorPlugins() {
    const decorate = (doc: PMNode): DecorationSet => {
      const ctx = context;
      if (!ctx) return DecorationSet.empty;
      const seen = new Map<string, number>();
      return DecorationSet.create(doc, findEmbeds(doc).map(site => {
        const n = (seen.get(site.literal) ?? 0) + 1;
        seen.set(site.literal, n);
        // Keyed by what it shows, so typing elsewhere keeps the same widget (and does not read the note again).
        return Decoration.widget(site.pos, () => buildWidget(site, ctx), {
          key: `${site.literal}#${n}`, side: 1, ignoreSelection: true, stopEvent: () => true,
        });
      }));
    };
    return [new Plugin({
      key: embedPluginKey,
      state: {
        init: (_, { doc }) => decorate(doc),
        apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
      },
      props: { decorations: state => embedPluginKey.getState(state) },
    })];
  },
});
