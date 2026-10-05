/**
 * A deterministic vault of realistic notes for integrity tests (the same idea as
 * the demo fixture in scripts/demo, scaled up): folders one level deep, every
 * wikilink form, tags, headings, frontmatter, names with characters that must be
 * HTML-escaped, and links to notes that do not exist. Same seed, same vault.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseWikilinks, extractTags, linkPointsAt } from '../../shared/vault/extract';

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FOLDERS = ['', '', '', '', 'Projects', 'Archive', 'Meetings', 'Ideas'];
const WORDS = ['aurora', 'budget', 'cedar', 'delta', 'ember', 'falcon', 'glacier', 'harbor', 'indigo', 'juniper', 'kestrel', 'lagoon', 'meadow', 'nimbus', 'orchid', 'pebble', 'quartz', 'ripple', 'summit', 'tundra'];
const TAGS = ['#idea', '#todo', '#reading', '#project/aurora', '#project/falcon', '#review', '#draft'];
const NEVER = 'A note nobody wrote';

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface GeneratedVault {
  names: string[];
  /** Links in the generated notes that point at no note (and must stay exactly that). */
  danglingBaseline: string[];
}

export function generateVault(dir: string, opts: { count?: number; seed?: number } = {}): GeneratedVault {
  const count = opts.count ?? 500;
  const rand = rng(opts.seed ?? 1);
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];

  // Names first, so notes can link to each other.
  const names: string[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    const folder = pick(FOLDERS);
    let stem = `${pick(WORDS)} ${pick(WORDS)} ${i}`;
    if (i % 41 === 0) stem = `Q&A review ${i}`;
    if (i % 43 === 0) stem = `Tom's list ${i}`;
    const name = `${folder ? folder + '/' : ''}${stem}.md`;
    if (!used.has(name.toLowerCase())) { used.add(name.toLowerCase()); names.push(name); }
  }

  const bare = (n: string) => n.replace(/\.md$/, '');
  const linkText = (target: string) => {
    const t = escapeHtml(bare(target));
    switch (Math.floor(rand() * 6)) {
      case 0: return `[[${t}]]`;
      case 1: return `[[${t}|see ${pick(WORDS)}]]`;
      case 2: return `[[${t}#Details]]`;
      case 3: return `[[${escapeHtml(bare(target).toLowerCase())}]]`;
      case 4: return `[[${t}.md]]`;
      default: return `<span data-wikilink="${t.replace(/"/g, '&quot;')}" class="wikilink" role="link">[[${t}]]</span>`;
    }
  };

  for (const name of names) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const links = Array.from({ length: Math.floor(rand() * 5) }, () => linkText(pick(names)));
    if (rand() < 0.1) links.push(`[[${NEVER}]]`);
    const tags = Array.from({ length: Math.floor(rand() * 3) }, () => pick(TAGS));
    const front = rand() < 0.05 ? `<!--noted-frontmatter:${encodeURIComponent('---\ntitle: x\nstatus: draft\n---')}-->` : '';
    const html = `${front}<h1>${escapeHtml(bare(name).split('/').pop()!)}</h1><h2>Details</h2><p>${pick(WORDS)} ${pick(WORDS)} ${links.join(' ')} ${tags.join(' ')}</p><p>${pick(WORDS)} ${pick(WORDS)} ${pick(WORDS)}.</p>`;
    fs.writeFileSync(file, html, 'utf8');
  }
  return { names, danglingBaseline: danglingLinks(dir) };
}

/** Notes of a vault as the app lists them: the root and one level of non-hidden folders. */
export function listNotes(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name.startsWith('.')) continue;
      for (const f of fs.readdirSync(path.join(dir, e.name), { withFileTypes: true })) {
        if (!f.isDirectory() && f.name.endsWith('.md')) out.push(`${e.name}/${f.name}`);
      }
    } else if (e.name.endsWith('.md')) out.push(e.name);
  }
  return out.sort();
}

export interface ColdNote { links: string[]; tags: string[] }

/** What the index SHOULD say, computed from scratch from the files alone. */
export function coldScan(dir: string): Record<string, ColdNote> {
  const out: Record<string, ColdNote> = {};
  for (const name of listNotes(dir)) {
    const raw = fs.readFileSync(path.join(dir, name), 'utf8');
    out[name] = { links: [...new Set(parseWikilinks(raw).map(l => l.target))], tags: extractTags(raw) };
  }
  return out;
}

/** "note -> target" for every [[link]] that points at no existing note. */
export function danglingLinks(dir: string): string[] {
  const notes = listNotes(dir);
  const out: string[] = [];
  for (const n of notes) {
    for (const l of parseWikilinks(fs.readFileSync(path.join(dir, n), 'utf8'))) {
      if (!notes.some(m => linkPointsAt(l.target, m))) out.push(`${n} -> ${l.target}`);
    }
  }
  return out.sort();
}

/** Targets of the dangling links (without the source note), for "no NEW dangling link" checks. */
export const danglingTargets = (dir: string): string[] => danglingLinks(dir).map(d => d.replace(/^.* -> /, ''));
