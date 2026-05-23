import fs from 'node:fs';
import path from 'node:path';

export interface FullTextResult {
  relPath: string;
  title: string;
  snippet: string;
  score: number;
  terms: string[];
}

interface IndexedDoc {
  relPath: string;
  plain: string;
  lower: string;
  title: string;
  titleLower: string;
  mtimeMs: number;
  size: number;
}

interface DirState {
  docs: Map<string, IndexedDoc>;
  ordered: IndexedDoc[];
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

function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(p|h[1-6]|li|div|blockquote)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeDoc(relPath: string, raw: string, mtimeMs: number, size: number): IndexedDoc {
  const plain = stripHtmlToText(raw);
  const lower = plain.toLowerCase();
  const title = relPath.split('/').pop()!.replace(/\.md$/, '').replace(/_/g, ' ');
  return {
    relPath,
    plain,
    lower,
    title,
    titleLower: title.toLowerCase(),
    mtimeMs,
    size,
  };
}

function sortDocs(state: DirState): void {
  state.ordered = Array.from(state.docs.values()).sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export class FullTextSearchReadModel {
  private readonly byDir = new Map<string, DirState>();

  markDirty(dir: string): void {
    const state = this.byDir.get(normalizeDir(dir));
    if (state) state.dirty = true;
  }

  upsertFromRaw(dir: string, relPath: string, raw: string): void {
    const state = this.byDir.get(normalizeDir(dir));
    if (!state) return;
    const now = Date.now();
    state.docs.set(relPath, makeDoc(relPath, raw, now, raw.length));
    sortDocs(state);
  }

  renameDoc(dir: string, oldRelPath: string, newRelPath: string): void {
    const state = this.byDir.get(normalizeDir(dir));
    if (!state) return;
    const existing = state.docs.get(oldRelPath);
    if (!existing) {
      state.dirty = true;
      return;
    }
    state.docs.delete(oldRelPath);
    state.docs.set(
      newRelPath,
      makeDoc(newRelPath, existing.plain, Date.now(), existing.size),
    );
    sortDocs(state);
  }

  deleteDoc(dir: string, relPath: string): void {
    const state = this.byDir.get(normalizeDir(dir));
    if (!state) return;
    if (!state.docs.delete(relPath)) {
      state.dirty = true;
      return;
    }
    sortDocs(state);
  }

  clearDir(dir: string): void {
    this.byDir.set(normalizeDir(dir), {
      docs: new Map(),
      ordered: [],
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

    const rawTerms = query.trim().toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    if (rawTerms.length === 0) return { results: [], truncated: state.truncated };

    const results: FullTextResult[] = [];
    for (const doc of state.ordered) {
      let score = 0;
      let firstMatchIdx = -1;
      const matchedTerms: string[] = [];

      for (const term of rawTerms) {
        let idx = 0;
        let termCount = 0;
        while ((idx = doc.lower.indexOf(term, idx)) !== -1) {
          if (firstMatchIdx === -1 || idx < firstMatchIdx) firstMatchIdx = idx;
          termCount++;
          idx += term.length;
        }
        if (termCount > 0) {
          matchedTerms.push(term);
          score += termCount;
          if (doc.titleLower.includes(term)) score += 10;
        }
      }

      if (score === 0 || firstMatchIdx === -1) continue;
      if (matchedTerms.length === rawTerms.length) score += 5;

      const start = Math.max(0, firstMatchIdx - CTX_CHARS);
      const end = Math.min(doc.plain.length, firstMatchIdx + CTX_CHARS * 2);
      let snippet = doc.plain.slice(start, end).replace(/\s+/g, ' ').trim();
      if (start > 0) snippet = '…' + snippet;
      if (end < doc.plain.length) snippet += '…';

      results.push({
        relPath: doc.relPath,
        title: doc.title,
        snippet,
        score,
        terms: matchedTerms,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return { results: results.slice(0, 25), truncated: state.truncated };
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
    const docs = new Map<string, IndexedDoc>();
    let truncated = false;
    let totalBytes = 0;

    const mdFiles: { relPath: string; filePath: string; mtimeMs: number; size: number }[] = [];
    try {
      const rootEntries = await fs.promises.readdir(dir, { withFileTypes: true });
      outer: for (const entry of rootEntries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const sub = path.join(dir, entry.name);
          let subEntries: fs.Dirent[];
          try {
            subEntries = await fs.promises.readdir(sub, { withFileTypes: true });
          } catch {
            continue;
          }
          for (const f of subEntries) {
            if (!f.isDirectory() && f.name.endsWith('.md')) {
              try {
                const relPath = `${entry.name}/${f.name}`;
                validateFileName(relPath);
                const fp = path.join(sub, f.name);
                const stat = await fs.promises.stat(fp);
                mdFiles.push({ relPath, filePath: fp, size: stat.size, mtimeMs: stat.mtimeMs });
              } catch {
                // skip invalid or unreadable
              }
              if (mdFiles.length >= FT_MAX_FILES) {
                truncated = true;
                break outer;
              }
            }
          }
        } else if (!entry.isDirectory() && entry.name.endsWith('.md')) {
          try {
            validateFileName(entry.name);
            const fp = path.join(dir, entry.name);
            const stat = await fs.promises.stat(fp);
            mdFiles.push({ relPath: entry.name, filePath: fp, size: stat.size, mtimeMs: stat.mtimeMs });
          } catch {
            // skip invalid or unreadable
          }
          if (mdFiles.length >= FT_MAX_FILES) {
            truncated = true;
            break;
          }
        }
      }
    } catch {
      return { docs, ordered: [], truncated: false, dirty: false, scannedAt: Date.now() };
    }

    mdFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const entry of mdFiles) {
      if (entry.size > FT_MAX_FILE_BYTES) continue;
      if (totalBytes + entry.size > FT_MAX_TOTAL_BYTES) {
        truncated = true;
        break;
      }
      try {
        const raw = await fs.promises.readFile(entry.filePath, 'utf-8');
        totalBytes += raw.length;
        docs.set(entry.relPath, makeDoc(entry.relPath, raw, entry.mtimeMs, entry.size));
      } catch {
        // skip unreadable
      }
    }

    const state: DirState = {
      docs,
      ordered: [],
      truncated,
      dirty: false,
      scannedAt: Date.now(),
    };
    sortDocs(state);
    return state;
  }
}
