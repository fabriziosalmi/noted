/**
 * What the main-process VaultIndex sends the renderer. `electron/vault-index.ts`
 * keeps the producing side; `electron/vault-index.types-check.ts` makes the
 * compiler prove the two stay equal.
 */
export interface VaultIndexNoteView {
  /** Distinct [[link]] targets, without alias/heading/".md". */
  links: string[];
  tags: string[];
}

export interface VaultIndexSnapshot {
  vault: string;
  seq: number;
  notes: Record<string, VaultIndexNoteView>;
}

export interface VaultIndexDelta {
  vault: string;
  seq: number;
  upserts: Record<string, VaultIndexNoteView>;
  removals: string[];
}

export interface VaultIndexNote {
  links: { target: string; alias?: string; heading?: string }[];
  tags: string[];
  headings: { level: number; text: string }[];
  frontmatterKeys: string[];
}
