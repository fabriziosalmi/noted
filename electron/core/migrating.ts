// While a vault is being converted between note formats (electron/migration.ts) nothing else may write to it:
// a note saved in the old format after it was converted would be the one outcome the conversion cannot fix.
let running = false;

export const isMigrating = (): boolean => running;

export function setMigrating(value: boolean): void {
  running = value;
}

/** Throws the message a handler returns to the renderer when a write is attempted during a conversion. */
export function assertNotMigrating(): void {
  if (running) throw new Error('The vault is being converted to another note format. Try again in a moment.');
}
