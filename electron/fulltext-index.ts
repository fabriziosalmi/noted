import fs from 'node:fs';
import path from 'node:path';
import { InvertedIndex } from '../shared/search/invertedIndex.js';
import { noteToPlainText, deriveTitleFromRelPath } from '../shared/search/textExtract.js';
import { checkNotePath } from '../shared/vault/paths.js';
import { walkVault } from '../shared/vault/walk.js';

export interface FullTextResult {
  relPath: string;
  title: string;
  snippet: string;
  score: number;
  terms: string[];
}

interface DirState {
  index: InvertedIndex;
  truncated: boolean;
  dirty: boolean;
  scannedAt: number;
}

interface SearchOutput {
  results: FullTextResult[];
  truncated: boolean;
}

/** A retrieval candidate: a note with enough of its text to rank and to quote. */
export interface RetrievalCandidate {
  name: string;
  title: string;
  text: string;
  score: number;
}

// The index must cover the WHOLE vault (it feeds search and the AI chat's
// retrieval), so the caps are safety nets, not working limits. The text budget is
// counted on the extracted plain text: an old note carrying megabytes of base64
// images is a few KB of text once its tags are stripped.
const FT_MAX_FILES = 20_000;
const FT_MAX_TOTAL_TEXT = 200 * 1024 * 1024;
const FT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const FT_READ_CONCURRENCY = 32;
const CTX_CHARS = 90;
// Safety net only: changes are applied incrementally (own writes and the watcher).
const AUTO_RESCAN_MS = 10 * 60_000;
/** How much of a note's text a retrieval candidate carries. */
const CANDIDATE_TEXT_CHARS = 6000;
const REFRESH_DEBOUNCE_MS = 80;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

function normalizeDir(dir: string): string {
  return path.resolve(dir);
}

// Build a context window around the first matched term (falls back to the head
// of the note when a match is title-only).
function buildSnippet(text: string, matchedTerms: string[]): string {
  const lower = text.toLowerCase();
  let firstIdx = -1;
  for (const term of matchedTerms) {
    const i = lower.indexOf(term);
    if (i !== -1 && (firstIdx === -1 || i < firstIdx)) firstIdx = i;
  }
  if (firstIdx === -1) firstIdx = 0;
  const start = Math.max(0, firstIdx - CTX_CHARS);
  const end = Math.min(text.length, firstIdx + CTX_CHARS * 2);
  let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet += '…';
  return snippet;
}

/**
 * In-memory full-text read model wrapping the shared BM25 InvertedIndex. Owns
 * the fs scan, caps, staleness rescan, and incremental updates; ranking is
 * delegated to the shared index so it matches the MCP server exactly.
 */
export class FullTextSearchReadModel {
  private readonly byDir = new Map<string, DirState>();

  markDirty(dir: string): void {
    const state = this.byDir.get(normalizeDir(dir));
    if (state) state.dirty = true;
  }

  upsertFromRaw(dir: string, relPath: string, raw: string): void {
    const state = this.byDir.get(normalizeDir(dir));
    if (!state) return;
    state.index.add({
      id: relPath,
      title: deriveTitleFromRelPath(relPath),
      text: noteToPlainText(raw),
      mtimeMs: Date.now(),
    });
  }

  renameDoc(dir: string, oldRelPath: string, newRelPath: string): void {
    const state = this.byDir.get(normalizeDir(dir));
    if (!state) return;
    if (!state.index.has(oldRelPath)) {
      state.dirty = true;
      return;
    }
    state.index.rename(oldRelPath, newRelPath, deriveTitleFromRelPath(newRelPath));
  }

  deleteDoc(dir: string, relPath: string): void {
    const state = this.byDir.get(normalizeDir(dir));
    if (!state) return;
    if (!state.index.has(relPath)) {
      state.dirty = true;
      return;
    }
    state.index.remove(relPath);
  }

  clearDir(dir: string): void {
    this.byDir.set(normalizeDir(dir), {
      index: new InvertedIndex(),
      truncated: false,
      dirty: false,
      scannedAt: Date.now(),
    });
  }

  async search(
    dir: string,
    query: string,
    validateFileName: (name: string) => void,
  ): Promise<SearchOutput> {
    const normalizedDir = normalizeDir(dir);
    const state = await this.ensureFresh(normalizedDir, validateFileName);
    const hits = state.index.search(query, { limit: 25 });
    const results: FullTextResult[] = hits.map((hit) => {
      const doc = state.index.getDoc(hit.id);
      return {
        relPath: hit.id,
        title: doc?.title ?? deriveTitleFromRelPath(hit.id),
        snippet: buildSnippet(doc?.text ?? '', hit.matchedTerms),
        score: hit.score,
        terms: hit.matchedTerms,
      };
    });
    return { results, truncated: state.truncated };
  }

  /**
   * Notes whose text may contain one of these names, best matches first (BM25 over the in-memory index, so no
   * file is read). A superset of the notes that really contain the phrase: the caller checks.
   */
  async notesMatching(
    dir: string,
    phrases: readonly string[],
    validateFileName: (name: string) => void,
    limit = 200,
  ): Promise<string[]> {
    const state = await this.ensureFresh(normalizeDir(dir), validateFileName);
    const best = new Map<string, number>();
    for (const phrase of phrases) {
      for (const hit of state.index.search(phrase, { limit })) best.set(hit.id, Math.max(best.get(hit.id) ?? 0, hit.score));
    }
    return [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
  }

  /**
   * The best-matching notes for a question, from the whole vault (BM25 over the
   * in-memory index), with their text. The caller re-ranks this short list.
   */
  async candidates(
    dir: string,
    query: string,
    limit: number,
    validateFileName: (name: string) => void,
  ): Promise<{ candidates: RetrievalCandidate[]; truncated: boolean; indexed: number }> {
    const normalizedDir = normalizeDir(dir);
    const state = await this.ensureFresh(normalizedDir, validateFileName);
    const n = Math.max(1, Math.min(200, Math.floor(limit)));
    const hits = state.index.search(query, { limit: n });
    const candidates = hits.map((hit) => {
      const doc = state.index.getDoc(hit.id);
      return {
        name: hit.id,
        title: doc?.title ?? deriveTitleFromRelPath(hit.id),
        text: (doc?.text ?? '').slice(0, CANDIDATE_TEXT_CHARS),
        score: hit.score,
      };
    });
    return { candidates, truncated: state.truncated, indexed: state.index.size };
  }

  /** The plain text of every indexed note, by name (for checks that compare notes with each other). */
  async plainTexts(dir: string, validateFileName: (name: string) => void): Promise<Map<string, string>> {
    const state = await this.ensureFresh(normalizeDir(dir), validateFileName);
    return new Map(state.index.ids().map((id) => [id, state.index.getDoc(id)?.text ?? '']));
  }

  /** Every indexed note with the time its text was last read (a change in it means the note changed). */
  async docs(dir: string, validateFileName: (name: string) => void): Promise<{ id: string; title: string; mtimeMs: number }[]> {
    const state = await this.ensureFresh(normalizeDir(dir), validateFileName);
    return state.index.ids().map((id) => {
      const doc = state.index.getDoc(id);
      return { id, title: doc?.title ?? deriveTitleFromRelPath(id), mtimeMs: doc?.mtimeMs ?? 0 };
    });
  }

  private readonly refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Debounced refresh of one note from disk (the watcher fires several events per save). */
  scheduleRefresh(dir: string, relPath: string): void {
    const key = `${normalizeDir(dir)}\0${relPath}`;
    const prev = this.refreshTimers.get(key);
    if (prev) clearTimeout(prev);
    this.refreshTimers.set(key, setTimeout(() => {
      this.refreshTimers.delete(key);
      void this.refreshFile(dir, relPath);
    }, REFRESH_DEBOUNCE_MS));
  }

  /** Re-read one note: gone -> removed, changed -> re-indexed. A no-op until the vault has been indexed. */
  async refreshFile(dir: string, relPath: string): Promise<void> {
    const state = this.byDir.get(normalizeDir(dir));
    if (!state) return;
    // The watcher reports any file that changes; only a note the walk would list belongs in the index
    // (not `.obsidian/x.md`, `A/.trash/x.md`, history or trash copies).
    if (checkNotePath(relPath) !== null) return;
    const file = path.join(dir, relPath);
    let stat: fs.Stats;
    try { stat = await fs.promises.stat(file); } catch { if (state.index.has(relPath)) state.index.remove(relPath); return; }
    if (!stat.isFile() || stat.size > FT_MAX_FILE_BYTES) return;
    const known = state.index.getDoc(relPath);
    if (known && known.mtimeMs === stat.mtimeMs) return;
    let raw: string;
    try { raw = await fs.promises.readFile(file, 'utf-8'); } catch { return; }
    state.index.add({ id: relPath, title: deriveTitleFromRelPath(relPath), text: noteToPlainText(raw), mtimeMs: stat.mtimeMs });
  }

  private async ensureFresh(
    dir: string,
    validateFileName: (name: string) => void,
  ): Promise<DirState> {
    const state = this.byDir.get(dir);
    const now = Date.now();
    if (!state) {
      const built = await this.rebuild(dir, validateFileName);
      this.byDir.set(dir, built);
      return built;
    }
    if (!state.dirty && now - state.scannedAt < AUTO_RESCAN_MS) return state;
    const rebuilt = await this.rebuild(dir, validateFileName);
    this.byDir.set(dir, rebuilt);
    return rebuilt;
  }

  private async rebuild(
    dir: string,
    validateFileName: (name: string) => void,
  ): Promise<DirState> {
    const index = new InvertedIndex();
    let truncated = false;
    let totalBytes = 0;

    try {
      // Every note at any depth (never a hidden folder, never a link); the cap below is applied to the most recent ones.
      const walked = await walkVault(dir);
      const validCandidates: { relPath: string; filePath: string }[] = [];
      for (const relPath of walked.notes) {
        try {
          validateFileName(relPath);
          validCandidates.push({ relPath, filePath: path.join(dir, relPath) });
        } catch {
          // skip
        }
      }
      if (walked.truncated) truncated = true;

      const stattedFiles = (await mapLimit(validCandidates, FT_READ_CONCURRENCY, async (cand) => {
        try {
          const stat = await fs.promises.stat(cand.filePath);
          return { ...cand, size: stat.size, mtimeMs: stat.mtimeMs };
        } catch {
          return null;
        }
      })).filter(
        (f): f is { relPath: string; filePath: string; size: number; mtimeMs: number } => f !== null
      );

      // Most recent first: if a safety cap ever bites, it drops the oldest notes (not whichever the walk met last).
      stattedFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (stattedFiles.length > FT_MAX_FILES) {
        truncated = true;
        stattedFiles.length = FT_MAX_FILES;
      }

      // Read with bounded concurrency (a vault of thousands of notes would
      // otherwise open them all at once and run out of file descriptors).
      const readFiles = await mapLimit(stattedFiles, FT_READ_CONCURRENCY, async (entry) => {
        if (entry.size > FT_MAX_FILE_BYTES) return null;
        try {
          const raw = await fs.promises.readFile(entry.filePath, 'utf-8');
          return { ...entry, text: noteToPlainText(raw) };
        } catch {
          return null;
        }
      });

      for (const entry of readFiles) {
        if (!entry) continue;
        if (totalBytes + entry.text.length > FT_MAX_TOTAL_TEXT) {
          truncated = true;
          break;
        }
        totalBytes += entry.text.length;
        index.add({
          id: entry.relPath,
          title: deriveTitleFromRelPath(entry.relPath),
          text: entry.text,
          mtimeMs: entry.mtimeMs,
        });
      }
    } catch {
      return { index, truncated: false, dirty: false, scannedAt: Date.now() };
    }

    return { index, truncated, dirty: false, scannedAt: Date.now() };
  }
}
