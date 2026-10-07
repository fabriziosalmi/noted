// The vectors of the vault's chunks, on disk. One file per embedding model in `.noted/embeddings/`, append-only:
//
//   header   "NEMB", version u32, dimension u32, reserved u32                    (16 bytes)
//   record   chunk hash (16 bytes), the unit-length vector (dimension x float32) (repeated)
//
// A chunk is known by the hash of the text that was embedded, so an unchanged chunk is found again whatever happened to the
// rest of the note, and a changed one is simply a new hash. Nothing is updated in place: a crash can only leave a torn last
// record, which is cut off when the file is next opened. Space of chunks that no longer exist is given back by `retain`.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalize } from '../shared/search/rank.js';

const MAGIC = 'NEMB';
const VERSION = 1;
const HEADER_BYTES = 16;
const HASH_BYTES = 16;
/** Memory the vectors of one model may take once loaded. Past it the vault is not embedded further (reported, not hidden). */
export const MAX_STORE_BYTES = 512 * 1024 * 1024;

export const embeddingsDir = (vaultDir: string): string => path.join(vaultDir, '.noted', 'embeddings');

/** 32 hex characters naming the text that was embedded. */
export function chunkHash(embeddedText: string): string {
  return crypto.createHash('sha256').update(embeddedText).digest('hex').slice(0, HASH_BYTES * 2);
}

/** The file of a model's vectors: readable name, plus a hash so two models whose names slug alike never share one. */
export function storeFile(vaultDir: string, provider: string, model: string): string {
  const slug = `${provider}-${model}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 60);
  const id = crypto.createHash('sha1').update(`${provider}\0${model}`).digest('hex').slice(0, 8);
  return path.join(embeddingsDir(vaultDir), `${slug}-${id}.bin`);
}

export class DimensionMismatchError extends Error {
  expected: number;
  got: number;
  constructor(expected: number, got: number) {
    super(`vectors of ${got} dimensions cannot join a store of ${expected}`);
    this.name = 'DimensionMismatchError';
    this.expected = expected;
    this.got = got;
  }
}

export class EmbeddingStore {
  private dim = 0;
  private ids: string[] = [];
  private rows = new Float32Array(0);
  private rowOf = new Map<string, number>();
  readonly file: string;

  private constructor(file: string) { this.file = file; }

  /** Opens (and loads) the store at `file`; a missing, foreign or damaged-header file is an empty store. */
  static open(file: string): EmbeddingStore {
    const store = new EmbeddingStore(file);
    store.load();
    return store;
  }

  get size(): number { return this.ids.length; }
  get dimension(): number { return this.dim; }
  get bytes(): number { return this.ids.length * this.dim * 4; }
  has(hash: string): boolean { return this.rowOf.has(hash); }

  /** All the vectors back to back, for a similarity scan. Valid until the next change. */
  matrix(): { ids: readonly string[]; rows: Float32Array; dim: number } {
    return { ids: this.ids, rows: this.rows.subarray(0, this.ids.length * this.dim), dim: this.dim };
  }

  private load(): void {
    let buf: Buffer;
    try { buf = fs.readFileSync(this.file); } catch { return; }
    if (buf.length < HEADER_BYTES || buf.toString('latin1', 0, 4) !== MAGIC || buf.readUInt32LE(4) !== VERSION) return;
    const dim = buf.readUInt32LE(8);
    if (dim === 0 || dim > 65536) return;
    const record = HASH_BYTES + dim * 4;
    const count = Math.floor((buf.length - HEADER_BYTES) / record);
    this.dim = dim;
    this.rows = new Float32Array(Math.max(count, 16) * dim);
    for (let i = 0; i < count; i++) {
      const at = HEADER_BYTES + i * record;
      const hash = buf.toString('hex', at, at + HASH_BYTES);
      const row = this.rowOf.get(hash) ?? this.ids.length; // a hash stored twice keeps its first row, rewritten by the later one
      if (row === this.ids.length) { this.ids.push(hash); this.rowOf.set(hash, row); }
      for (let j = 0; j < dim; j++) this.rows[row * dim + j] = buf.readFloatLE(at + HASH_BYTES + j * 4);
    }
    const valid = HEADER_BYTES + count * record;
    if (valid !== buf.length) { try { fs.truncateSync(this.file, valid); } catch { /* read-only: the tail is ignored anyway */ } }
  }

  /**
   * Stores vectors (normalised here, so that similarity is a dot product). Ones already stored are left as they are. Throws
   * DimensionMismatchError when a vector's size is not the store's, before anything is written.
   */
  add(entries: readonly { hash: string; vector: ArrayLike<number> }[]): number {
    const fresh = entries.filter((e, i) => !this.rowOf.has(e.hash) && entries.findIndex(x => x.hash === e.hash) === i);
    if (fresh.length === 0) return 0;
    const dim = this.dim || fresh[0].vector.length;
    if (dim === 0) throw new Error('empty vector');
    for (const e of fresh) if (e.vector.length !== dim) throw new DimensionMismatchError(dim, e.vector.length);

    const record = HASH_BYTES + dim * 4;
    const out = Buffer.alloc((this.dim ? 0 : HEADER_BYTES) + fresh.length * record);
    let at = 0;
    if (!this.dim) {
      out.write(MAGIC, 0, 'latin1');
      out.writeUInt32LE(VERSION, 4);
      out.writeUInt32LE(dim, 8);
      at = HEADER_BYTES;
    }
    const unit = fresh.map(e => normalize(e.vector));
    fresh.forEach((e, i) => {
      out.write(e.hash, at, HASH_BYTES, 'hex');
      for (let j = 0; j < dim; j++) out.writeFloatLE(unit[i][j], at + HASH_BYTES + j * 4);
      at += record;
    });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, out);

    if (!this.dim) { this.dim = dim; this.rows = new Float32Array(Math.max(fresh.length, 16) * dim); }
    if ((this.ids.length + fresh.length) * dim > this.rows.length) {
      const grown = new Float32Array(Math.max(this.rows.length * 2, (this.ids.length + fresh.length) * dim));
      grown.set(this.rows);
      this.rows = grown;
    }
    fresh.forEach((e, i) => {
      const row = this.ids.length;
      this.ids.push(e.hash);
      this.rowOf.set(e.hash, row);
      this.rows.set(unit[i], row * dim);
    });
    return fresh.length;
  }

  /** Keeps only the vectors of the chunks in `live`, rewriting the file. Returns how many were dropped. */
  retain(live: ReadonlySet<string>): number {
    const keep = this.ids.filter(id => live.has(id));
    const dropped = this.ids.length - keep.length;
    if (dropped === 0) return 0;
    const dim = this.dim;
    const rows = new Float32Array(Math.max(keep.length, 16) * dim);
    keep.forEach((id, i) => rows.set(this.rows.subarray((this.rowOf.get(id) as number) * dim, (this.rowOf.get(id) as number + 1) * dim), i * dim));
    const out = Buffer.alloc(HEADER_BYTES + keep.length * (HASH_BYTES + dim * 4));
    out.write(MAGIC, 0, 'latin1');
    out.writeUInt32LE(VERSION, 4);
    out.writeUInt32LE(dim, 8);
    keep.forEach((id, i) => {
      const at = HEADER_BYTES + i * (HASH_BYTES + dim * 4);
      out.write(id, at, HASH_BYTES, 'hex');
      for (let j = 0; j < dim; j++) out.writeFloatLE(rows[i * dim + j], at + HASH_BYTES + j * 4);
    });
    const tmp = `${this.file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, this.file);
    this.ids = keep;
    this.rows = rows;
    this.rowOf = new Map(keep.map((id, i) => [id, i]));
    return dropped;
  }

  /** Forgets every vector and deletes the file. */
  clear(): void {
    this.dim = 0;
    this.ids = [];
    this.rows = new Float32Array(0);
    this.rowOf.clear();
    try { fs.unlinkSync(this.file); } catch { /* not there */ }
  }
}
