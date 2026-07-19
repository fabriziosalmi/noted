import fs from 'node:fs';
import path from 'node:path';
import { InvertedIndex } from '../shared/search/invertedIndex.js';
import { htmlToPlainText, deriveTitleFromRelPath } from '../shared/search/textExtract.js';

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

const FT_MAX_FILES = 1500;
const FT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const FT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const CTX_CHARS = 90;
const AUTO_RESCAN_MS = 30_000;

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
      text: htmlToPlainText(raw),
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
      const rootEntries = await fs.promises.readdir(dir, { withFileTypes: true });
      const dirPromises = rootEntries.map(async (entry) => {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const sub = path.join(dir, entry.name);
          try {
            const subEntries = await fs.promises.readdir(sub, { withFileTypes: true });
            return subEntries
              .filter(f => !f.isDirectory() && f.name.endsWith('.md'))
              .map(f => ({ relPath: `${entry.name}/${f.name}`, filePath: path.join(sub, f.name) }));
          } catch {
            return [];
          }
        } else if (!entry.isDirectory() && entry.name.endsWith('.md')) {
          return [{ relPath: entry.name, filePath: path.join(dir, entry.name) }];
        }
        return [];
      });

      const nestedFiles = await Promise.all(dirPromises);
      const allCandidates = nestedFiles.flat();

      const validCandidates: { relPath: string; filePath: string }[] = [];
      for (const cand of allCandidates) {
        try {
          validateFileName(cand.relPath);
          validCandidates.push(cand);
        } catch {
          // skip
        }
        if (validCandidates.length >= FT_MAX_FILES) {
          truncated = true;
          break;
        }
      }

      const statPromises = validCandidates.map(async (cand) => {
        try {
          const stat = await fs.promises.stat(cand.filePath);
          return { ...cand, size: stat.size, mtimeMs: stat.mtimeMs };
        } catch {
          return null;
        }
      });

      const stattedFiles = (await Promise.all(statPromises)).filter(
        (f): f is { relPath: string; filePath: string; size: number; mtimeMs: number } => f !== null
      );

      stattedFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

      const readPromises = stattedFiles.map(async (entry) => {
        if (entry.size > FT_MAX_FILE_BYTES) return null;
        try {
          const raw = await fs.promises.readFile(entry.filePath, 'utf-8');
          return { ...entry, raw };
        } catch {
          return null;
        }
      });

      const readFiles = await Promise.all(readPromises);

      for (const entry of readFiles) {
        if (!entry) continue;
        if (totalBytes + entry.raw.length > FT_MAX_TOTAL_BYTES) {
          truncated = true;
          break;
        }
        totalBytes += entry.raw.length;
        index.add({
          id: entry.relPath,
          title: deriveTitleFromRelPath(entry.relPath),
          text: htmlToPlainText(entry.raw),
          mtimeMs: entry.mtimeMs,
        });
      }
    } catch {
      return { index, truncated: false, dirty: false, scannedAt: Date.now() };
    }

    return { index, truncated, dirty: false, scannedAt: Date.now() };
  }
}
