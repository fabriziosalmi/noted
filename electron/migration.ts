// Converting a whole vault between the two note formats (ADR 0001): HTML-in-.md to Markdown, and back.
//
// The rules, in order of importance:
//  1. Nothing is written until every note has been converted in memory without an error.
//  2. A copy of every note goes into a verified zip first (.noted/backups/), and each note's previous text
//     goes into its own version history, so a single note can be restored from inside the app.
//  3. Each note is written atomically and read back; one failure puts every note back exactly as it was.
//  4. The vault's format marker changes last. Until then the vault is, and is read as, the old format.
//  5. It can be run again at any point: notes already in the target format are left alone, so an
//     interrupted run (power cut, quit) is finished by running it again.
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import type { DomEnv } from '../shared/markdown/html';
import { convertHtmlNote, convertMarkdownNoteToHtml, isLegacyHtml, type Verdict } from '../shared/markdown/migrate';
import { MIGRATION_LOCK_STALE_MS, migrationLockPath, readVaultFormat, writeVaultFormat } from '../shared/vault/formatFile';
import type { NoteFormat } from '../shared/vault/format';

export type Direction = 'to-markdown' | 'to-html';

export interface MigrationDeps {
  dom: DomEnv;
  /** Durable, atomic write of a note's text (the same recipe as saving). */
  writeNote(name: string, content: string): Promise<void>;
  /** Keep `previous` as a version of the note, whatever the history rules would say. */
  snapshotBefore(name: string, previous: string): Promise<void>;
  onProgress?(p: MigrationProgress): void;
  now?(): Date;
}

export interface MigrationProgress {
  phase: 'scan' | 'convert' | 'backup' | 'write' | 'finish';
  done: number;
  total: number;
  name?: string;
}

export interface NoteReport {
  name: string;
  verdict?: Verdict;
  findings: string[];
  error?: string;
}

export interface MigrationReport {
  direction: Direction;
  total: number;
  /** Notes that will be rewritten. */
  convert: number;
  /** Notes already in the target format (or empty), left as they are. */
  skip: number;
  verdicts: Record<Verdict, number>;
  failed: number;
  /** Every note that is not exact, and every failure, capped at {@link MAX_LISTED}. */
  notes: NoteReport[];
  truncated: boolean;
}

export type MigrationResult =
  | { ok: true; report: MigrationReport; backup: string; converted: number }
  | { ok: false; reason: string; report?: MigrationReport };

const MAX_LISTED = 500;
const YIELD_EVERY = 10;

const targetFormat = (d: Direction): NoteFormat => (d === 'to-markdown' ? 'markdown' : 'html');
const sourceFormat = (d: Direction): NoteFormat => (d === 'to-markdown' ? 'html' : 'markdown');
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Every note file in the vault, as vault-relative names with "/" (hidden folders and links are not part of the vault). */
export async function listNoteFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await fs.promises.readdir(path.join(dir, rel), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const relName = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(relName);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(relName);
    }
  };
  await walk('');
  return out.sort();
}

interface Planned {
  name: string;
  previous: string;
  next: string;
  verdict: Verdict;
  findings: string[];
}

interface Plan {
  report: MigrationReport;
  work: Planned[];
}

async function plan(dir: string, deps: MigrationDeps, direction: Direction): Promise<Plan> {
  const names = await listNoteFiles(dir);
  const verdicts: Record<Verdict, number> = { exact: 0, raw: 0, formatting: 0, lossy: 0 };
  const notes: NoteReport[] = [];
  const work: Planned[] = [];
  let skip = 0;
  let failed = 0;
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (i % YIELD_EVERY === 0) {
      deps.onProgress?.({ phase: 'convert', done: i, total: names.length, name });
      await yieldToEventLoop();
    }
    let previous: string;
    try {
      previous = await fs.promises.readFile(path.join(dir, name), 'utf8');
    } catch (err) {
      failed++;
      notes.push({ name, findings: [], error: `could not be read: ${(err as Error).message}` });
      continue;
    }
    const isHtml = isLegacyHtml(previous);
    const needs = direction === 'to-markdown' ? isHtml : !isHtml && previous.trim() !== '';
    if (!needs) { skip++; continue; }
    try {
      if (direction === 'to-markdown') {
        const c = convertHtmlNote(previous, deps.dom);
        verdicts[c.verdict]++;
        work.push({ name, previous, next: c.text, verdict: c.verdict, findings: c.findings });
        if (c.verdict !== 'exact') notes.push({ name, verdict: c.verdict, findings: c.findings });
      } else {
        const next = convertMarkdownNoteToHtml(previous, deps.dom);
        verdicts.exact++;
        work.push({ name, previous, next, verdict: 'exact', findings: [] });
      }
    } catch (err) {
      failed++;
      notes.push({ name, findings: [], error: `could not be converted: ${(err as Error).message}` });
    }
  }
  return {
    work,
    report: {
      direction,
      total: names.length,
      convert: work.length,
      skip,
      verdicts,
      failed,
      notes: notes.slice(0, MAX_LISTED),
      truncated: notes.length > MAX_LISTED,
    },
  };
}

/** What a conversion would do, without touching anything. */
export async function planMigration(dir: string, deps: MigrationDeps, direction: Direction = 'to-markdown'): Promise<MigrationReport> {
  return (await plan(dir, deps, direction)).report;
}

// ── backup ─────────────────────────────────────────────────────────────────

const stamp = (d: Date): string => {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** Zip every note (as the bytes on disk) and check the zip can give each one back. Returns the zip's path. */
async function backup(dir: string, names: string[], deps: MigrationDeps, direction: Direction): Promise<string> {
  const zip = new JSZip();
  const sizes = new Map<string, number>();
  for (let i = 0; i < names.length; i++) {
    if (i % YIELD_EVERY === 0) { deps.onProgress?.({ phase: 'backup', done: i, total: names.length, name: names[i] }); await yieldToEventLoop(); }
    const bytes = await fs.promises.readFile(path.join(dir, names[i]));
    zip.file(names[i], bytes);
    sizes.set(names[i], bytes.length);
  }
  const folder = path.join(dir, '.noted', 'backups');
  await fs.promises.mkdir(folder, { recursive: true });
  const file = path.join(folder, `notes-before-${direction === 'to-markdown' ? 'markdown' : 'html'}-${stamp((deps.now ?? (() => new Date()))())}.zip`);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const tmp = `${file}.tmp`;
  await fs.promises.writeFile(tmp, buffer);
  // Verify before trusting it: reopen, and read every note back at its original size.
  const check = await JSZip.loadAsync(await fs.promises.readFile(tmp));
  const entries = Object.keys(check.files).filter((n) => !check.files[n].dir);
  if (entries.length !== names.length) throw new Error(`backup holds ${entries.length} of ${names.length} notes`);
  for (const [name, size] of sizes) {
    const entry = check.file(name);
    if (!entry || (await entry.async('nodebuffer')).length !== size) throw new Error(`backup of "${name}" does not match`);
  }
  await fs.promises.rename(tmp, file);
  return file;
}

// ── lock ───────────────────────────────────────────────────────────────────

function acquireLock(dir: string): () => void {
  const file = migrationLockPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const take = (): number => fs.openSync(file, 'wx');
  let fd: number;
  try {
    fd = take();
  } catch {
    // Left behind by a run that died: older than any real migration.
    if (Date.now() - fs.statSync(file).mtimeMs < MIGRATION_LOCK_STALE_MS) throw new Error('A conversion is already running on this vault');
    fs.rmSync(file, { force: true });
    fd = take();
  }
  fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  fs.closeSync(fd);
  return () => fs.rmSync(file, { force: true });
}

// ── the conversion ─────────────────────────────────────────────────────────

async function convertVault(dir: string, deps: MigrationDeps, direction: Direction, opts: { allowLossy?: boolean }): Promise<MigrationResult> {
  if (readVaultFormat(dir) !== sourceFormat(direction)) {
    return { ok: false, reason: `This vault is already stored as ${targetFormat(direction) === 'markdown' ? 'Markdown' : 'HTML'}.` };
  }
  let release: () => void;
  try { release = acquireLock(dir); } catch (err) { return { ok: false, reason: (err as Error).message }; }
  const written: Planned[] = [];
  let markerWritten = false;
  try {
    deps.onProgress?.({ phase: 'scan', done: 0, total: 0 });
    // 1. convert everything in memory; stop before touching a file if anything is wrong
    const { report, work } = await plan(dir, deps, direction);
    if (report.failed > 0) return { ok: false, reason: `${report.failed} note(s) could not be converted; nothing was changed.`, report };
    if (report.verdicts.lossy > 0 && !opts.allowLossy) {
      return { ok: false, reason: `${report.verdicts.lossy} note(s) would lose text; nothing was changed until you confirm.`, report };
    }

    // 2. a verified copy of every note
    const backupFile = await backup(dir, await listNoteFiles(dir), deps, direction);

    // 3. write each note, keeping the old text in its history, and read it back
    for (let i = 0; i < work.length; i++) {
      const item = work[i];
      if (i % YIELD_EVERY === 0) { deps.onProgress?.({ phase: 'write', done: i, total: work.length, name: item.name }); await yieldToEventLoop(); }
      await deps.snapshotBefore(item.name, item.previous);
      await deps.writeNote(item.name, item.next);
      written.push(item);
      const back = await fs.promises.readFile(path.join(dir, item.name), 'utf8');
      if (back !== item.next) throw new Error(`"${item.name}" did not read back as written`);
    }

    // 4. the marker changes last
    writeVaultFormat(dir, targetFormat(direction));
    markerWritten = true;

    // 5. a note someone wrote in the old format while this ran: convert it too (twice at most)
    for (let round = 0; round < 2; round++) {
      const late = await plan(dir, deps, direction);
      if (late.work.length === 0 || late.report.failed > 0) break;
      for (const item of late.work) {
        await deps.snapshotBefore(item.name, item.previous);
        await deps.writeNote(item.name, item.next);
      }
    }
    deps.onProgress?.({ phase: 'finish', done: work.length, total: work.length });
    return { ok: true, report, backup: backupFile, converted: work.length };
  } catch (err) {
    // Put every note back exactly as it was: a vault half in one format is the one outcome to avoid.
    for (const item of written.reverse()) {
      try { await deps.writeNote(item.name, item.previous); } catch { /* the zip still has it */ }
    }
    if (markerWritten) writeVaultFormat(dir, sourceFormat(direction));
    return { ok: false, reason: `Stopped, and every note was restored: ${(err as Error).message}` };
  } finally {
    release();
  }
}

/** HTML-in-.md vault -> Markdown vault. `allowLossy`: go on even if some note would lose text (the report said so). */
export function migrateToMarkdown(dir: string, deps: MigrationDeps, opts: { allowLossy?: boolean } = {}): Promise<MigrationResult> {
  return convertVault(dir, deps, 'to-markdown', opts);
}

/** The way back: Markdown vault -> HTML-in-.md vault. */
export function migrateToHtml(dir: string, deps: MigrationDeps): Promise<MigrationResult> {
  return convertVault(dir, deps, 'to-html', {});
}
