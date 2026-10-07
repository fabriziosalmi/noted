// What the main process and the renderer say to each other about embeddings. Types only, so both can import it.

/** Which model's vectors: they are only comparable with vectors of the same model. */
export interface EmbeddingModelRef { provider: string; model: string }

export interface EmbeddingStatus {
  /** Distinct chunks in the vault. */
  chunks: number;
  /** Of those, how many have a vector. */
  embedded: number;
  /** Vector size of this model's store (0 while it is empty). */
  dimension: number;
  /** The store reached its memory limit: the rest of the vault is not embedded. */
  capped: boolean;
}

/** A section of a note, as retrieval returns it. */
export interface RagChunk {
  name: string;
  title: string;
  headingPath: string[];
  text: string;
  ord: number;
  /** Fused score (the larger, the better); only the order means anything. */
  score: number;
  /** 1-based place in the word ranking and in the meaning ranking; null where that ranking did not have the chunk. */
  lexicalRank: number | null;
  denseRank: number | null;
}

export type IpcResult<T> = { success: true; data: T } | { success: false; error: string; mismatch?: boolean };
