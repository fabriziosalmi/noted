// Turning a web page or some text into a source note: read it, ask the model for a summary, find which of your notes it is near, and lay
// the note out (see shared/ingest/source.ts). Nothing is written here: the person reads the result first (IngestDialog).

import { getElectronApi } from './electronApi';
import { askLLM, isLocalHost } from './llm';
import { createMasker } from './piiMasker';
import { retrieveChunks } from './ragSearch';
import { translate, type TranslationKey } from './i18n';
import { ensureFolders } from './vaultFolders';
import { diskToWire } from './noteIo';
import {
  clipForModel, composeSourceNote, parseSummary, relatedNotes, sourceNoteName, SUMMARY_SYSTEM, tidy,
  type SourceNoteInput, type SourceSummary,
} from '../../shared/ingest/source';
import type { Reviewable } from '../../shared/diff/hunks';
import { MIN_SUPPORTING_SIMILARITY } from '../../shared/search/citations';

export type IngestInput = { kind: 'url'; url: string } | { kind: 'text'; text: string; title: string };
export type IngestStage = 'fetching' | 'summarising' | 'linking';
export type IngestFailure = 'local-only' | 'empty' | 'fetch' | 'model' | 'input';

export class IngestError extends Error {
  code: IngestFailure;
  constructor(code: IngestFailure, message: string) {
    super(message);
    this.name = 'IngestError';
    this.code = code;
  }
}

/** What the steps need to know of the settings. */
export interface IngestSettings {
  language?: string;
  llmProvider?: string;
  llmModel?: string;
  openaiCompatibleUrl?: string;
  lmStudioUrl?: string;
  piiMasking?: boolean;
  syncDirectory?: string | null;
  ragMaxNotes?: number;
  embeddingsEnabled?: boolean;
  embeddingProvider?: string;
  embeddingModel?: string;
  llmApiKey?: string;
  ingestLocalOnly?: boolean;
}

/** A name or address on this computer or in a private network: loopback, `.local`, and the ranges no one routes over the internet. */
function isPrivateHost(address: string): boolean {
  const host = address.replace(/^https?:\/\//i, '').split('/')[0].replace(/:\d+$/, '').toLowerCase();
  if (isLocalHost(host)) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Is the model on this computer or in the person's own network? Ollama always is (it is asked on this machine); LM Studio and a gateway
 * are if their address is; a cloud provider never is.
 */
export function isLocalModel(s: Pick<IngestSettings, 'llmProvider' | 'openaiCompatibleUrl' | 'lmStudioUrl'>): boolean {
  if (s.llmProvider === 'ollama') return true;
  if (s.llmProvider === 'lmstudio') return !(s.lmStudioUrl ?? '').trim() || isPrivateHost(s.lmStudioUrl as string);
  if (s.llmProvider === 'openai-compatible') return isPrivateHost(s.openaiCompatibleUrl ?? '');
  return false;
}

export interface Prepared {
  /** Everything the note is made of, but its title (the person may change that): see `buildNote`. */
  input: SourceNoteInput;
  /** The review of the related links, one change each. */
  review: Reviewable;
  /** The page or text was longer than was kept or shown to the model. */
  clipped: boolean;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
}

const labelsFor = (lang: string): SourceNoteInput['labels'] => {
  const t = (k: TranslationKey) => translate(k, lang);
  return { summary: t('ingestLabelSummary'), keyPoints: t('ingestLabelKeyPoints'), related: t('ingestLabelRelated'), source: t('ingestLabelSource'), pasted: t('ingestLabelPasted'), clipped: t('ingestLabelClipped') };
};

/** Reads the source, has it summarised, and finds the notes it is near. */
export async function prepareSource(
  input: IngestInput,
  settings: IngestSettings,
  opts: { signal?: AbortSignal; onStage?: (stage: IngestStage) => void; now?: Date } = {},
): Promise<Prepared> {
  const lang = settings.language ?? 'en';
  // Before anything is fetched or sent: a person who said "only a model on this computer" is not asked to trust a cloud one for a moment.
  if (settings.ingestLocalOnly && !isLocalModel(settings)) throw new IngestError('local-only', translate('ingestErrLocal', lang));

  let url: string | null = null;
  let title: string;
  let text: string;
  let truncated = false;
  if (input.kind === 'url') {
    if (!input.url.trim()) throw new IngestError('input', translate('ingestErrNeed', lang));
    opts.onStage?.('fetching');
    const res = await getElectronApi()?.ingestFetch(input.url.trim()).catch((e: Error) => ({ success: false as const, error: e.message, data: undefined }));
    if (!res?.success || !res.data) throw new IngestError('fetch', translate('ingestErrFetch', lang).replace('{error}', res?.error ?? 'unavailable'));
    ({ url, title, text, truncated } = res.data);
    text = text.trim(); // the same text is the same hash, however it came
  } else {
    text = input.text.trim();
    title = input.title.trim();
    if (!text) throw new IngestError('input', translate('ingestErrNeed', lang));
  }
  if (text.replace(/\s+/g, ' ').length < 40) throw new IngestError('empty', translate('ingestErrEmpty', lang));
  if (opts.signal?.aborted) throw new IngestError('input', 'cancelled');

  const hash = await sha256Hex(text);
  opts.onStage?.('summarising');
  const clip = clipForModel(text);
  const masker = settings.piiMasking ? createMasker() : undefined;
  let summary: SourceSummary;
  try {
    const user = `${title ? `Title: ${title}\n\n` : ''}${clip.text}`;
    const answer = await askLLM([
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: masker ? masker.mask(user) : user },
    ], { signal: opts.signal, masker });
    summary = parseSummary(answer);
  } catch (e) {
    throw new IngestError('model', translate('ingestErrModel', lang).replace('{error}', (e as Error).message));
  }
  if (!summary.summary) throw new IngestError('model', translate('ingestErrModel', lang).replace('{error}', 'empty answer'));

  opts.onStage?.('linking');
  const finalTitle = title || summary.title || (url ? new URL(url).hostname : 'Source');
  let related: SourceNoteInput['related'] = [];
  try {
    const found = await retrieveChunks(`${finalTitle}\n${summary.summary}`.slice(0, 600), 12, settings);
    // What a note is *about* is in the notes of the vault; its prompts and its own reports are not content. And a suggested link has to be
    // earned: a section found only because it shares "and" with the source (the words alone match anything) is not related.
    related = relatedNotes(
      found.chunks.filter(c => !/^(prompts|reports)\//i.test(c.name) && (c.coverage > 0 || (c.similarity ?? 0) >= MIN_SUPPORTING_SIMILARITY)),
      new Set(),
    );
  } catch { /* no related notes is not a failure */ }

  const clipped = clip.clipped || truncated;
  const when = (opts.now ?? new Date()).toISOString();
  const noteInput: SourceNoteInput = {
    title: finalTitle, url, hash, retrievedAt: when,
    model: `${settings.llmProvider ?? 'model'}/${settings.llmModel || 'default'}`, summary, related, clipped, labels: labelsFor(lang),
  };
  return { input: noteInput, review: composeSourceNote(noteInput).review, clipped };
}

/** The note for a title: the texts with and without the links, and the review of the difference. */
export function buildNote(prepared: Prepared, title: string) {
  return composeSourceNote({ ...prepared.input, title: title.trim() || prepared.input.title });
}

/** Writes the note: with the related links that were kept, in `sources/`, under a name that is not taken. Returns the name. */
export async function writeSourceNote(prepared: Prepared, title: string, kept: ReadonlySet<number>, taken: ReadonlySet<string>, syncDir: string | undefined): Promise<string> {
  const { compose } = await import('../../shared/diff/hunks');
  const note = buildNote(prepared, title);
  const markdown = tidy(compose(note.before, note.after, note.review, kept), prepared.input.labels.related);
  const name = sourceNoteName(title.trim() || prepared.input.title, taken);
  const folderError = await ensureFolders(name, syncDir);
  if (folderError) throw new Error(folderError);
  const res = await getElectronApi()?.saveNote(name, diskToWire(markdown, 'markdown'), syncDir);
  if (!res?.success) throw new Error(res?.error ?? 'could not save the note');
  return name;
}
