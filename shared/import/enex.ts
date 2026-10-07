// Evernote export (.enex), the pure half: dates, the note's properties, and ENML (Evernote's XHTML) turned into the HTML the Markdown codec
// reads. Reading the file and writing the vault is electron/import-enex.ts.
import { stringify } from 'yaml';
import type { DomEnv } from '../markdown/html';
import { checkNotePath } from '../vault/paths';

/** A file the note embeds with <en-media>, already stored in the vault. */
export interface MediaRef {
  /** Where it is in the vault, relative to the vault root. */
  rel: string;
  /** What to call it where it has no picture of its own. */
  name: string;
  image: boolean;
}

export interface EnmlFinding { level: 'lossy' | 'skipped'; message: string }

/** `20190314T101530Z` as an ISO date; null for anything else. */
export function parseEnexDate(value: string | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec((value ?? '').trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export interface EnexMeta { created: string | null; updated: string | null; tags: string[]; sourceUrl: string; author: string }

/** The note's properties as a frontmatter block, or '' when it has none worth keeping. */
export function enexFrontmatter(meta: EnexMeta): string {
  const data: Record<string, unknown> = {};
  if (meta.created) data.created = meta.created;
  if (meta.updated) data.modified = meta.updated;
  if (meta.tags.length) data.tags = meta.tags;
  if (meta.sourceUrl) data.source = meta.sourceUrl;
  if (meta.author) data.author = meta.author;
  if (Object.keys(data).length === 0) return '';
  return `---\n${stringify(data, { lineWidth: 0 })}---\n`;
}

const WINDOWS_RESERVED = /[\x00-\x1F\x7F\\/:*?"<>|;`$]/g; // eslint-disable-line no-control-regex

/** A file name stem for a note: its title made safe, never empty, never a name the vault refuses. */
export function noteStem(title: string): string {
  let stem = title.replace(WINDOWS_RESERVED, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  while (new TextEncoder().encode(stem).length > 120) stem = stem.slice(0, -1);
  stem = stem.trimEnd();
  if (!stem || checkNotePath(`${stem}.md`) !== null) stem = stem ? `${stem}_` : 'Untitled';
  return checkNotePath(`${stem}.md`) === null ? stem : 'Untitled';
}

/**
 * ENML's three self-closing elements would swallow what follows them when an HTML parser reads them (it does not know they are empty),
 * so they are made into elements it does know, before anything is parsed.
 */
function prepare(enml: string): string {
  return enml
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<en-media\b([^>]*?)\/?>(\s*<\/en-media>)?/gi, '<img data-en-media="1"$1>')
    .replace(/<en-todo\b([^>]*?)\/?>(\s*<\/en-todo>)?/gi, '<span data-en-todo="1"$1></span>');
}

const BLOCK_WITH_TODO = new Set(['DIV', 'P', 'LI']);
const isBlank = (n: Node): boolean => n.nodeType === 3 && !(n.textContent ?? '').trim();

function firstContent(el: Element): ChildNode | null {
  for (const n of Array.from(el.childNodes)) if (!isBlank(n)) return n;
  return null;
}

const isTodo = (n: Node | null): n is HTMLElement => !!n && n.nodeType === 1 && (n as Element).hasAttribute('data-en-todo');

/** ENML as HTML the Markdown codec reads: attachments linked, to-dos as a task list, encrypted text said to be missing. */
export function enmlToHtml(enml: string, env: Pick<DomEnv, 'DOMParser' | 'document'>, media: Map<string, MediaRef>): { html: string; findings: EnmlFinding[] } {
  const findings: EnmlFinding[] = [];
  const doc = new env.DOMParser().parseFromString(`<body>${prepare(enml)}</body>`, 'text/html');
  const body = doc.body;
  const make = (tag: string): HTMLElement => doc.createElement(tag);

  // The wrapper is not content
  for (const el of Array.from(body.querySelectorAll('en-note'))) el.replaceWith(...Array.from(el.childNodes));

  // Attachments
  for (const el of Array.from(body.querySelectorAll('img[data-en-media]'))) {
    const hash = (el.getAttribute('hash') ?? '').toLowerCase();
    const ref = media.get(hash);
    if (!ref) {
      el.replaceWith(doc.createTextNode('(attachment missing from the export)'));
      findings.push({ level: 'lossy', message: 'an attachment is named in the note but is not in the export' });
    } else if (ref.image) {
      const img = make('img');
      img.setAttribute('src', ref.rel);
      img.setAttribute('alt', ref.name);
      el.replaceWith(img);
    } else {
      const a = make('a');
      a.setAttribute('href', ref.rel);
      a.textContent = ref.name;
      el.replaceWith(a);
    }
  }

  // Encrypted text cannot be read without the passphrase; say so where it was
  for (const el of Array.from(body.querySelectorAll('en-crypt'))) {
    const em = make('em');
    em.textContent = '(encrypted text, not imported)';
    el.replaceWith(em);
    findings.push({ level: 'lossy', message: 'encrypted text was not imported (Evernote keeps it behind a passphrase)' });
  }

  // To-dos: a block that starts with a check box is one item, and neighbours that do the same are one list
  const items = Array.from(body.querySelectorAll('*')).filter((el) => BLOCK_WITH_TODO.has(el.tagName) && isTodo(firstContent(el)));
  for (const el of items) {
    const marker = firstContent(el) as HTMLElement;
    const checked = marker.getAttribute('checked') === 'true';
    marker.remove();
    const p = make('p');
    while (el.firstChild) p.appendChild(el.firstChild);
    if (el.tagName === 'LI' && el.parentElement && /^(UL|OL)$/.test(el.parentElement.tagName)) {
      // already in a list: the list becomes a task list
      el.setAttribute('data-type', 'taskItem');
      el.setAttribute('data-checked', String(checked));
      el.appendChild(p);
      el.parentElement.setAttribute('data-type', 'taskList');
      continue;
    }
    const li = make('li');
    li.setAttribute('data-type', 'taskItem');
    li.setAttribute('data-checked', String(checked));
    li.appendChild(p);
    const before = el.previousElementSibling;
    const list = before?.getAttribute('data-type') === 'taskList' ? before : make('ul');
    if (list !== before) { list.setAttribute('data-type', 'taskList'); el.before(list); }
    list.appendChild(li);
    el.remove();
  }
  // Any check box left in the middle of a line has no list to stand in: keep the text, say what it was
  for (const el of Array.from(body.querySelectorAll('[data-en-todo]'))) {
    el.replaceWith(doc.createTextNode(el.getAttribute('checked') === 'true' ? '[x] ' : '[ ] '));
  }

  return { html: body.innerHTML, findings };
}
