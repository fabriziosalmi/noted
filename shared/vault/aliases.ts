/**
 * A note's aliases, from its frontmatter (Obsidian's `aliases:`): other names the note answers to, so `[[Alias]]`
 * finds it and Quick Open matches it. Read-only, and tolerant: a note with broken YAML simply has none.
 */
import { parseFrontmatterBlock } from '../markdown/yamlFrontmatter';

export const MAX_ALIASES = 50;
export const MAX_ALIAS_CHARS = 200;

const KEYS = ['aliases', 'alias'];

function listFrom(value: unknown): string[] {
  // A list, or one value; "a, b" in a single string was how older notes wrote a list.
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [value];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string' && typeof item !== 'number') continue; // a nested list or mapping is not a name
    const alias = String(item).trim();
    if (alias && alias.length <= MAX_ALIAS_CHARS && !out.some(a => a.toLowerCase() === alias.toLowerCase())) out.push(alias);
    if (out.length >= MAX_ALIASES) break;
  }
  return out;
}

/** `block` is a frontmatter block as stored, `---` lines included (null if the note has none). */
export function aliasesFromFrontmatter(block: string | null): string[] {
  if (!block || !/alias/i.test(block)) return []; // nearly every note: no YAML is parsed at all
  const { data } = parseFrontmatterBlock(block);
  if (!data) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!KEYS.includes(key.toLowerCase())) continue;
    for (const alias of listFrom(value)) if (!out.some(a => a.toLowerCase() === alias.toLowerCase())) out.push(alias);
  }
  return out.slice(0, MAX_ALIASES);
}
