// What quick capture writes, with the file work handed in so it can be tested on a plain directory (see ipc/capture.ts for the real one).
import crypto from 'node:crypto';
import type { NoteFormat } from '../shared/vault/format';
import { plainTextToMarkdown } from '../shared/markdown/codec';
import {
  INBOX_NOTE, captureBlock, clockTime, dailyFileName, insertCapture, newDailyNote, newInboxNote,
  type CaptureTarget, type DailySections,
} from '../shared/capture/target';

export interface CaptureDeps {
  format: NoteFormat;
  now: () => Date;
  /** The note as it is now, or null when there is none yet. */
  readNote: (name: string) => Promise<string | null>;
  writeNote: (name: string, content: string) => Promise<void>;
  /** Called with a note's content before an append replaces it, so the version before stays recoverable. */
  snapshotBefore: (name: string, previous: string) => Promise<void>;
  /** The title and section names of a new daily note, in the language of the app. */
  daily: (now: Date) => DailySections;
  /** Plain text as the vault's format wants it, used for a capture that is a note of its own. */
  newNoteBody: (text: string) => string;
}

export interface CaptureResult { fileName: string; created: boolean }

const pad = (n: number): string => String(n).padStart(2, '0');

export async function writeCapture(deps: CaptureDeps, text: string, target: CaptureTarget): Promise<CaptureResult> {
  const now = deps.now();
  if (target === 'new') {
    // Seconds + a short random suffix so two captures in the same minute don't overwrite each other.
    const rand = crypto.randomBytes(2).toString('hex');
    const fileName = `Capture_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}_${rand}.md`;
    await deps.writeNote(fileName, deps.newNoteBody(text));
    return { fileName, created: true };
  }

  const fileName = target === 'daily' ? dailyFileName(now) : INBOX_NOTE;
  const block = captureBlock(text, clockTime(now), deps.format);
  const existing = await deps.readNote(fileName);
  if (existing === null) {
    const base = target === 'daily' ? newDailyNote(deps.daily(now), deps.format) : newInboxNote('Inbox', deps.format);
    await deps.writeNote(fileName, insertCapture(base, block, deps.format, target === 'daily'));
    return { fileName, created: true };
  }
  await deps.snapshotBefore(fileName, existing);
  await deps.writeNote(fileName, insertCapture(existing, block, deps.format, target === 'daily'));
  return { fileName, created: false };
}

export const plainBody = (format: NoteFormat, stripHtml: (s: string) => string) => (text: string): string =>
  format === 'markdown' ? plainTextToMarkdown(text) : `<p>${stripHtml(text).replace(/\n/g, '</p><p>')}</p>`;
