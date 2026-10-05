/**
 * Vault operations for image attachments: save a pasted image under a
 * content-hash name, read one back for the `app://` protocol and for exports,
 * migrate images embedded in old notes out to files, and find (and remove)
 * attachments nothing refers to any more.
 *
 * Every path that arrives from outside (a renderer request, a src inside a note)
 * is confined to the vault, must be an image the app stores, and may not pass
 * through a hidden folder (.git, .noted_history, ...).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  detectImage, attachmentName, normalizeImageRef, extractDataImages, localImageRefs, inlineLocalImages,
  isValidAttachmentsFolder, imageTypeFromExt, MAX_ATTACHMENT_BYTES, type ImageType,
} from '../shared/vault/attachments.js';
import type { VaultIndex } from './vault-index.js';

export class AttachmentError extends Error {}

const sha256 = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');

/** Canonical path with symlinks resolved, or the plain resolved path when it does not exist yet. */
function canon(p: string): string {
  try { return fs.realpathSync.native(p); } catch { return path.resolve(p); }
}

/**
 * `rel` inside `vault`, or null. Rejects non-image extensions, hidden segments,
 * and anything that resolves (through symlinks) outside the vault.
 */
export function resolveVaultImage(vault: string, rel: string): { file: string; type: ImageType } | null {
  const norm = normalizeImageRef(rel);
  if (!norm || norm.split('/').some(seg => seg.startsWith('.'))) return null;
  const type = imageTypeFromExt(path.extname(norm));
  if (!type) return null;
  const root = canon(vault);
  const file = canon(path.join(root, ...norm.split('/')));
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return { file, type };
}

/** Read an image attachment, or null if it is missing, not allowed, or not really an image. */
export function readVaultImage(vault: string, rel: string): { bytes: Uint8Array; type: ImageType } | null {
  const r = resolveVaultImage(vault, rel);
  if (!r) return null;
  try {
    const stat = fs.statSync(r.file);
    if (!stat.isFile() || stat.size > MAX_ATTACHMENT_BYTES) return null;
    const bytes = new Uint8Array(fs.readFileSync(r.file));
    // The bytes decide what it is: a file named .png that is something else is not served.
    const real = detectImage(bytes);
    return real ? { bytes, type: real } : null;
  } catch {
    return null;
  }
}

function writeAtomic(file: string, bytes: Uint8Array): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

export interface SavedAttachment {
  /** Vault-relative path to put in the note: "attachments/<hash>.png". */
  rel: string;
  /** False when an identical image was already stored. */
  created: boolean;
}

/** Store image bytes under the attachments folder; identical content is stored once. */
export function saveAttachment(vault: string, folder: string, bytes: Uint8Array): SavedAttachment {
  if (!isValidAttachmentsFolder(folder)) throw new AttachmentError('Invalid attachments folder name');
  if (bytes.length === 0) throw new AttachmentError('Empty image');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new AttachmentError('Image is too large (25 MB maximum)');
  const type = detectImage(bytes);
  if (!type) throw new AttachmentError('Not a supported image (PNG, JPEG, GIF or WebP)');
  const rel = `${folder}/${attachmentName(sha256(bytes), type.ext)}`;
  const file = path.join(canon(vault), folder, path.basename(rel));
  if (fs.existsSync(file)) return { rel, created: false };
  writeAtomic(file, bytes);
  return { rel, created: true };
}

// ── migration of images embedded in notes ───────────────────────────────────

export interface MigrationReport {
  /** Notes that contain embedded images. */
  notes: { name: string; images: number; bytes: number }[];
  images: number;
  /** Different images (identical ones are stored once). */
  distinct: number;
  /** Base64 text that would leave the notes. */
  bytes: number;
}

export interface MigrationDeps {
  vaultIndex: Pick<VaultIndex, 'ensure' | 'reconcile' | 'names'>;
  readNote: (name: string) => Promise<string>;
  /** Keep the previous content in the note's history; unconditional. */
  snapshotBefore: (name: string, previous: string) => Promise<void>;
  writeNote: (name: string, content: string) => Promise<void>;
}

async function eachEmbedding<T>(
  vault: string,
  deps: MigrationDeps,
  store: (bytes: Uint8Array, type: ImageType) => string | null,
  onNote: (name: string, previous: string, r: ReturnType<typeof extractDataImages>) => Promise<T>,
): Promise<T[]> {
  await deps.vaultIndex.ensure(vault);
  await deps.vaultIndex.reconcile(vault);
  const out: T[] = [];
  for (const name of deps.vaultIndex.names(vault)) {
    let raw: string;
    try { raw = await deps.readNote(name); } catch { continue; }
    if (!raw.includes('data:image/')) continue;
    const r = extractDataImages(raw, store);
    if (r.images > 0) out.push(await onNote(name, raw, r));
  }
  return out;
}

/** What a migration would do, without writing anything. */
export async function scanEmbeddedImages(vault: string, deps: MigrationDeps): Promise<MigrationReport> {
  const seen = new Set<string>();
  const report: MigrationReport = { notes: [], images: 0, distinct: 0, bytes: 0 };
  await eachEmbedding(vault, deps,
    (bytes, type) => { seen.add(sha256(bytes)); return `dry/${type.ext}`; },
    async (name, _prev, r) => { report.notes.push({ name, images: r.images, bytes: r.bytes }); report.images += r.images; report.bytes += r.bytes; });
  report.distinct = seen.size;
  return report;
}

export interface MigrationOutcome {
  notes: number;
  images: number;
  bytes: number;
  failed: { name: string; error: string }[];
}

/**
 * Move every embedded image out to the attachments folder and point the notes at
 * the files. Per note: write the image files first, then snapshot the previous
 * text, then rewrite the note atomically — a failure at any step leaves the note
 * exactly as it was (an image that cannot be written stays embedded).
 */
export async function migrateEmbeddedImages(vault: string, folder: string, deps: MigrationDeps): Promise<MigrationOutcome> {
  if (!isValidAttachmentsFolder(folder)) throw new AttachmentError('Invalid attachments folder name');
  const out: MigrationOutcome = { notes: 0, images: 0, bytes: 0, failed: [] };
  const store = (bytes: Uint8Array): string | null => {
    try { return saveAttachment(vault, folder, bytes).rel; } catch { return null; }
  };
  await eachEmbedding(vault, deps, store, async (name, previous, r) => {
    try {
      await deps.snapshotBefore(name, previous);
      await deps.writeNote(name, r.content);
      out.notes++;
      out.images += r.images;
      out.bytes += r.bytes;
    } catch (err) {
      out.failed.push({ name, error: (err as Error).message });
    }
  });
  return out;
}

// ── orphans ─────────────────────────────────────────────────────────────────

export interface OrphanDeps {
  vaultIndex: Pick<VaultIndex, 'ensure' | 'reconcile' | 'get' | 'notesReferencingImage' | 'unparsedNotes'>;
  readNote: (name: string) => Promise<string>;
}

/** Is any note (other than `except`) still pointing at this image? Conservative: when unsure, yes. */
async function isReferenced(vault: string, rel: string, deps: OrphanDeps, except?: string): Promise<boolean> {
  if (deps.vaultIndex.notesReferencingImage(vault, rel).some(n => n !== except)) return true;
  // Notes too large to have been indexed: look inside them directly.
  for (const name of deps.vaultIndex.unparsedNotes(vault)) {
    if (name === except) continue;
    try { if (localImageRefs(await deps.readNote(name)).includes(rel)) return true; } catch { return true; }
  }
  return false;
}

/** Attachments (in `folder`) that only `noteName` refers to: what deleting it would leave unused. */
export async function listOrphanAttachments(vault: string, folder: string, noteName: string, deps: OrphanDeps): Promise<string[]> {
  if (!isValidAttachmentsFolder(folder)) return [];
  await deps.vaultIndex.ensure(vault);
  await deps.vaultIndex.reconcile(vault);
  const refs = deps.vaultIndex.get(vault, noteName)?.images ?? [];
  const out: string[] = [];
  for (const rel of refs) {
    if (!rel.startsWith(`${folder}/`) || !resolveVaultImage(vault, rel)) continue;
    if (!fs.existsSync(resolveVaultImage(vault, rel)!.file)) continue;
    if (!(await isReferenced(vault, rel, deps, noteName))) out.push(rel);
  }
  return out;
}

/**
 * Remove attachments. Each is re-checked NOW — inside the attachments folder, a
 * real image, and referenced by no note — so a stale list can never delete an
 * image something still shows. `trash` moves a file to the system Trash.
 */
export async function deleteAttachments(
  vault: string, folder: string, rels: string[], deps: OrphanDeps, trash: (file: string) => Promise<void>,
): Promise<{ deleted: string[]; skipped: string[] }> {
  const out = { deleted: [] as string[], skipped: [] as string[] };
  if (!isValidAttachmentsFolder(folder)) return { deleted: [], skipped: rels };
  await deps.vaultIndex.ensure(vault);
  await deps.vaultIndex.reconcile(vault);
  for (const raw of rels) {
    const rel = normalizeImageRef(raw);
    const r = rel ? resolveVaultImage(vault, rel) : null;
    if (!rel || !r || !rel.startsWith(`${folder}/`) || !fs.existsSync(r.file) || await isReferenced(vault, rel, deps)) {
      out.skipped.push(raw);
      continue;
    }
    try { await trash(r.file); out.deleted.push(rel); } catch { out.skipped.push(raw); }
  }
  return out;
}

// ── exports ─────────────────────────────────────────────────────────────────

/** HTML (or Markdown) with the note's local images embedded as data URIs, so the output stands alone. */
export function inlineVaultImages(vault: string, raw: string): string {
  if (!raw.includes('<img') && !raw.includes('![')) return raw;
  return inlineLocalImages(raw, rel => readVaultImage(vault, rel));
}
