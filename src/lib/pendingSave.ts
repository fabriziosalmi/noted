// Whatever the editor has typed but not yet written, drained on demand. Something that is about to rewrite
// every note (the conversion to Markdown, ADR 0001) must not start while the last keystrokes are still
// waiting in a debounce timer: they would land after it, in the old format, or be lost.
type Flusher = () => Promise<void>;

let flusher: Flusher | null = null;

/** The editor registers how to drain itself (and unregisters on unmount). */
export function setPendingSaveFlusher(next: Flusher | null): void {
  flusher = next;
}

/** Resolves when the open note's pending edits are on disk. A no-op when nothing is open. */
export async function flushPendingSaves(): Promise<void> {
  await flusher?.();
}
