/**
 * VaultIndex — the main process's single source of truth for what the notes in
 * a vault link to and are about: wikilinks, tags, headings and frontmatter keys.
 *
 * Why it lives here and not in the renderer: the renderer only knew about notes
 * it had opened (links), only rebuilt tags on save (and never persisted them),
 * and lost its link cache whenever localStorage filled up. Here the whole vault
 * is scanned once at startup and then kept current incrementally — by the app's
 * own saves/renames/deletes, and by the file watcher for everything else (an MCP
 * client, a git pull, another device) — so backlinks, the tag filter and "Same
 * project" are right after a restart and after external edits.
 *
 * The renderer receives a snapshot, then small deltas; each carries a `seq` so a
 * delta that raced the snapshot is recognised and dropped.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  parseWikilinks, extractTags, extractHeadings, extractFrontmatterKeys, linkPointsAt,
  type WikiLink, type Heading,
} from '../shared/vault/extract.js';
import { localImageRefs } from '../shared/vault/attachments.js';

export interface NoteEntry {
  name: string;
  links: WikiLink[];
  /** Distinct link targets (what the renderer shows as outgoing links). */
  linkTargets: string[];
  tags: string[];
  headings: Heading[];
  frontmatterKeys: string[];
  /** Vault-relative image files this note refers to. */
  images: string[];
  /** False when the note was too large to read: its links/tags/images are unknown, not empty. */
  parsed: boolean;
  mtimeMs: number;
  size: number;
  /** Bumped on every write to this entry; lets a slow scan tell it was overtaken. */
  gen: number;
}

/** What the renderer stores per note. */
export interface NoteView {
  links: string[];
  tags: string[];
}

export interface IndexSnapshot {
  vault: string;
  seq: number;
  notes: Record<string, NoteView>;
}

export interface IndexDelta {
  vault: string;
  seq: number;
  upserts: Record<string, NoteView>;
  removals: string[];
}

export interface VaultIndexOptions {
  onDelta?: (dir: string, delta: IndexDelta) => void;
  /** Throws for a name the app would refuse; such files are not indexed. */
  validateFileName?: (name: string) => void;
  /** Coalescing window for outgoing deltas and for watcher "touch" bursts. */
  flushMs?: number;
  /** Notes above this size are listed but not parsed (they are almost always embedded media). */
  maxParseBytes?: number;
}

const DEFAULT_FLUSH_MS = 60;
const DEFAULT_MAX_PARSE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 50_000;
const READ_CONCURRENCY = 32;

interface DirState {
  vault: string;
  notes: Map<string, NoteEntry>;
  seq: number;
  ready: Promise<void>;
  pendingUpserts: Set<string>;
  pendingRemovals: Set<string>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  touchTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** Bumped by clearDir so an in-flight scan of the old content is discarded. */
  epoch: number;
}

const toView = (e: NoteEntry): NoteView => ({ links: e.linkTargets, tags: e.tags });

export function buildEntry(name: string, raw: string, mtimeMs: number, size: number, gen = 0, parsed = true): NoteEntry {
  const links = parseWikilinks(raw);
  return {
    name,
    links,
    linkTargets: [...new Set(links.map(l => l.target))],
    tags: extractTags(raw),
    headings: extractHeadings(raw),
    frontmatterKeys: extractFrontmatterKeys(raw),
    images: localImageRefs(raw),
    parsed,
    mtimeMs,
    size,
    gen,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

export class VaultIndex {
  private readonly byDir = new Map<string, DirState>();
  private gen = 0;
  private readonly flushMs: number;
  private readonly maxParseBytes: number;

  private readonly opts: VaultIndexOptions;

  constructor(opts: VaultIndexOptions = {}) {
    this.opts = opts;
    this.flushMs = opts.flushMs ?? DEFAULT_FLUSH_MS;
    this.maxParseBytes = opts.maxParseBytes ?? DEFAULT_MAX_PARSE_BYTES;
  }

  private key(dir: string): string { return path.resolve(dir); }

  /**
   * Is this a note the app would list? Notes live at the vault root or one folder
   * down, in non-hidden folders: bookkeeping such as `.noted/trash/x.md` or
   * `.noted_history/...` must never be indexed, whichever way the name arrives.
   */
  private indexable(name: string): boolean {
    const parts = name.split('/');
    if (parts.length > 2 || !name.endsWith('.md')) return false;
    if (parts.some(p => p === '' || p.startsWith('.'))) return false;
    if (this.opts.validateFileName) {
      try { this.opts.validateFileName(name); } catch { return false; }
    }
    return true;
  }

  /** Start indexing a vault if not already; resolves when the first scan is done. */
  ensure(dir: string): Promise<void> {
    const k = this.key(dir);
    let st = this.byDir.get(k);
    if (!st) {
      st = {
        vault: k, notes: new Map(), seq: 0, ready: Promise.resolve(),
        pendingUpserts: new Set(), pendingRemovals: new Set(), flushTimer: null,
        touchTimers: new Map(), epoch: 0,
      };
      this.byDir.set(k, st);
      st.ready = this.scan(st).then(() => {
        st!.seq++;
      });
    }
    return st.ready;
  }

  async snapshot(dir: string): Promise<IndexSnapshot> {
    await this.ensure(dir);
    const st = this.byDir.get(this.key(dir))!;
    const notes: Record<string, NoteView> = {};
    for (const [name, e] of st.notes) notes[name] = toView(e);
    return { vault: st.vault, seq: st.seq, notes };
  }

  get(dir: string, name: string): NoteEntry | undefined {
    return this.byDir.get(this.key(dir))?.notes.get(name);
  }

  /** Notes whose [[links]] point at `name` (excluding itself). */
  backlinks(dir: string, name: string): string[] {
    const st = this.byDir.get(this.key(dir));
    if (!st) return [];
    const out: string[] = [];
    for (const [n, e] of st.notes) {
      if (n !== name && e.linkTargets.some(t => linkPointsAt(t, name))) out.push(n);
    }
    return out.sort();
  }

  /** Notes that refer to this vault-relative image file (parsed notes only; see unparsedNotes). */
  notesReferencingImage(dir: string, rel: string): string[] {
    const st = this.byDir.get(this.key(dir));
    if (!st) return [];
    const out: string[] = [];
    for (const [n, e] of st.notes) if (e.images.includes(rel)) out.push(n);
    return out.sort();
  }

  /** Notes too large to have been read: anything they refer to is unknown to the index. */
  unparsedNotes(dir: string): string[] {
    const st = this.byDir.get(this.key(dir));
    return st ? [...st.notes.values()].filter(e => !e.parsed).map(e => e.name).sort() : [];
  }

  /** tag -> note names, as the sidebar filter wants it. */
  tagIndex(dir: string): Record<string, string[]> {
    const st = this.byDir.get(this.key(dir));
    const idx: Record<string, string[]> = {};
    if (!st) return idx;
    // Sorted: scan order depends on which read finishes first.
    for (const n of [...st.notes.keys()].sort()) for (const t of st.notes.get(n)!.tags) (idx[t] ??= []).push(n);
    return idx;
  }

  names(dir: string): string[] {
    return [...(this.byDir.get(this.key(dir))?.notes.keys() ?? [])].sort();
  }

  // ── incremental updates ──────────────────────────────────────────────────

  upsertFromRaw(dir: string, name: string, raw: string, stat?: { mtimeMs: number; size: number }): void {
    const st = this.byDir.get(this.key(dir));
    if (!st || !this.indexable(name)) return;
    let s = stat;
    if (!s) {
      try { const f = fs.statSync(path.join(dir, name)); s = { mtimeMs: f.mtimeMs, size: f.size }; }
      catch { s = { mtimeMs: Date.now(), size: Buffer.byteLength(raw) }; }
    }
    st.notes.set(name, buildEntry(name, raw, s.mtimeMs, s.size, ++this.gen));
    this.queue(st, name, 'upsert');
  }

  renameDoc(dir: string, oldName: string, newName: string): void {
    const st = this.byDir.get(this.key(dir));
    if (!st) return;
    const e = st.notes.get(oldName);
    if (!e || !this.indexable(newName)) { this.deleteDoc(dir, oldName); void this.touch(dir, newName); return; }
    st.notes.delete(oldName);
    st.notes.set(newName, { ...e, name: newName, gen: ++this.gen });
    this.queue(st, oldName, 'remove');
    this.queue(st, newName, 'upsert');
  }

  deleteDoc(dir: string, name: string): void {
    const st = this.byDir.get(this.key(dir));
    if (!st || !st.notes.delete(name)) return;
    ++this.gen;
    this.queue(st, name, 'remove');
  }

  /** Forget everything (wipe) and rescan nothing: the vault is empty. */
  clearDir(dir: string): void {
    const st = this.byDir.get(this.key(dir));
    if (!st) return;
    st.epoch++;
    const names = [...st.notes.keys()];
    st.notes.clear();
    ++this.gen;
    for (const n of names) this.queue(st, n, 'remove');
  }

  /**
   * Re-check one note against the disk: gone -> removed; changed (mtime/size) ->
   * re-read; unchanged -> nothing. Safe to call for every watcher event.
   */
  async touch(dir: string, name: string): Promise<void> {
    const st = this.byDir.get(this.key(dir));
    if (!st || !this.indexable(name)) return;
    await st.ready;
    const file = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      this.deleteDoc(dir, name);
      return;
    }
    if (!stat.isFile()) return;
    const cur = st.notes.get(name);
    if (cur && cur.mtimeMs === stat.mtimeMs && cur.size === stat.size) return;
    const genAtRead = this.gen;
    let raw = '';
    if (stat.size <= this.maxParseBytes) {
      try { raw = await fs.promises.readFile(file, 'utf8'); } catch { return; }
    }
    // A save/rename that landed while we were reading is newer than what we read.
    const now = st.notes.get(name);
    if (now && now.gen > genAtRead) return;
    st.notes.set(name, buildEntry(name, raw, stat.mtimeMs, stat.size, ++this.gen, stat.size <= this.maxParseBytes));
    this.queue(st, name, 'upsert');
  }

  /** Debounced `touch`, for the bursts of events a single save produces. */
  scheduleTouch(dir: string, name: string): void {
    const st = this.byDir.get(this.key(dir));
    if (!st || !this.indexable(name)) return;
    const prev = st.touchTimers.get(name);
    if (prev) clearTimeout(prev);
    st.touchTimers.set(name, setTimeout(() => {
      st.touchTimers.delete(name);
      void this.touch(dir, name);
    }, this.flushMs));
  }

  /** Bring the index in line with the disk after a bulk change (folder ops, importers). */
  async reconcile(dir: string): Promise<void> {
    const st = this.byDir.get(this.key(dir));
    if (!st) return;
    await st.ready;
    const onDisk = new Set((await this.listFiles(st.vault)).map(f => f.name));
    for (const name of [...st.notes.keys()]) if (!onDisk.has(name)) this.deleteDoc(dir, name);
    await Promise.all([...onDisk].map(name => this.touch(dir, name)));
  }

  /** Test seam: wait for outgoing deltas and pending touches to settle. */
  async flushNow(dir: string): Promise<void> {
    const st = this.byDir.get(this.key(dir));
    if (!st) return;
    for (const [name, t] of st.touchTimers) { clearTimeout(t); st.touchTimers.delete(name); await this.touch(dir, name); }
    this.flush(st);
  }

  // ── scanning ─────────────────────────────────────────────────────────────

  private async listFiles(vault: string): Promise<{ name: string; file: string }[]> {
    const out: { name: string; file: string }[] = [];
    let root: fs.Dirent[];
    try { root = await fs.promises.readdir(vault, { withFileTypes: true }); } catch { return out; }
    const subs: string[] = [];
    for (const e of root) {
      if (e.isDirectory()) { if (!e.name.startsWith('.')) subs.push(e.name); }
      else if (e.name.endsWith('.md')) out.push({ name: e.name, file: path.join(vault, e.name) });
    }
    const nested = await Promise.all(subs.map(async s => {
      try {
        return (await fs.promises.readdir(path.join(vault, s), { withFileTypes: true }))
          .filter(f => !f.isDirectory() && f.name.endsWith('.md'))
          .map(f => ({ name: `${s}/${f.name}`, file: path.join(vault, s, f.name) }));
      } catch { return []; }
    }));
    out.push(...nested.flat());
    const valid = this.opts.validateFileName
      ? out.filter(f => { try { this.opts.validateFileName!(f.name); return true; } catch { return false; } })
      : out;
    return valid.slice(0, MAX_FILES);
  }

  private async scan(st: DirState): Promise<void> {
    // Captured before the first await: a save that lands while we list or read
    // files is newer than anything this scan will see.
    const epoch = st.epoch;
    const genAtStart = this.gen;
    const files = await this.listFiles(st.vault);
    await mapLimit(files, READ_CONCURRENCY, async f => {
      try {
        const stat = await fs.promises.stat(f.file);
        const raw = stat.size <= this.maxParseBytes ? await fs.promises.readFile(f.file, 'utf8') : '';
        if (st.epoch !== epoch) return;
        // Something wrote this note while we were scanning: that is newer.
        const existing = st.notes.get(f.name);
        if (existing && existing.gen > genAtStart) return;
        st.notes.set(f.name, buildEntry(f.name, raw, stat.mtimeMs, stat.size, ++this.gen, stat.size <= this.maxParseBytes));
      } catch { /* vanished or unreadable: skip */ }
    });
  }

  // ── delta delivery ───────────────────────────────────────────────────────

  private queue(st: DirState, name: string, kind: 'upsert' | 'remove'): void {
    if (kind === 'upsert') { st.pendingUpserts.add(name); st.pendingRemovals.delete(name); }
    else { st.pendingRemovals.add(name); st.pendingUpserts.delete(name); }
    if (st.flushTimer) return;
    st.flushTimer = setTimeout(() => this.flush(st), this.flushMs);
  }

  private flush(st: DirState): void {
    if (st.flushTimer) { clearTimeout(st.flushTimer); st.flushTimer = null; }
    if (st.pendingUpserts.size === 0 && st.pendingRemovals.size === 0) return;
    const upserts: Record<string, NoteView> = {};
    for (const n of st.pendingUpserts) { const e = st.notes.get(n); if (e) upserts[n] = toView(e); }
    const removals = [...st.pendingRemovals].filter(n => !st.notes.has(n));
    st.pendingUpserts.clear();
    st.pendingRemovals.clear();
    st.seq++;
    try { this.opts.onDelta?.(st.vault, { vault: st.vault, seq: st.seq, upserts, removals }); }
    catch { /* a broken listener must not break indexing */ }
  }
}
