// What the chat shows the model, and what it makes of the answer. The sources are the active note and the sections the vault
// found; the model is asked to cite them by number; the numbers it writes are checked against the sources that exist. In
// "vault only" mode nothing outside the sources may be used, and with no source at all the model is not asked. Pure.

import { readCitations, sourceLabel, sourcesBlock, supports, type Source } from '../../shared/search/citations';
import type { RagChunk } from '../../shared/search/embeddingTypes';

export interface PromptInput {
  lang: string;
  /** The open note, with the text the model will see (already trimmed); empty when there is none. */
  active: { name: string; title: string; text: string } | null;
  chunks: readonly RagChunk[];
  vaultOnly: boolean;
}

export interface Prompt {
  system: string;
  /** What the model was shown, numbered from 1. */
  sources: Source[];
  /** Vault only, and nothing to answer from: no question to the model, a fixed answer instead. */
  refuse: boolean;
}

const TEXT = {
  en: {
    role: "You are an assistant integrated into a Markdown note editor. You have access to the user's note content.\n\nReply concisely and helpfully.",
    cite: 'The sources below are numbered. When a statement comes from a source, put that source\'s number in square brackets right after it, like [1] or [2][3]. Use only numbers that appear below, never invent one, and do not cite what you say on your own.',
    only: 'Answer only from the sources. If they do not contain the answer, say so in one sentence and do not guess.',
    sources: 'Sources',
  },
  it: {
    role: "Sei un assistente integrato in un editor di note Markdown. Hai accesso al contenuto delle note dell'utente.\n\nRispondi in modo conciso e utile.",
    cite: "Le fonti qui sotto sono numerate. Quando un'affermazione viene da una fonte, metti il numero di quella fonte tra parentesi quadre subito dopo, così: [1] oppure [2][3]. Usa solo numeri che compaiono qui sotto, non inventarne, e non citare ciò che dici di tuo.",
    only: 'Rispondi solo con le fonti. Se non contengono la risposta, dillo in una frase e non tirare a indovinare.',
    sources: 'Fonti',
  },
};

const textFor = (lang: string) => (lang === 'it' ? TEXT.it : TEXT.en);

/** The system prompt and the numbered sources for one question. */
export function assemblePrompt(input: PromptInput): Prompt {
  const words = textFor(input.lang);
  const sources: Source[] = [];
  if (input.active && input.active.text.trim()) {
    sources.push({ n: 1, name: input.active.name, title: input.active.title, headingPath: [], text: input.active.text });
  }
  // Offered for what it is when the vault may answer on its own; as evidence only when it holds up.
  const offered = input.vaultOnly ? input.chunks.filter(supports) : input.chunks;
  for (const c of offered) sources.push({ n: sources.length + 1, name: c.name, title: c.title, headingPath: c.headingPath, text: c.text });

  if (sources.length === 0) {
    return { system: input.vaultOnly ? `${words.role}\n\n${words.only}` : words.role, sources, refuse: input.vaultOnly };
  }
  const instructions = [words.role, words.cite, ...(input.vaultOnly ? [words.only] : [])].join('\n\n');
  return { system: `${instructions}\n\n${words.sources}:\n"""\n${sourcesBlock(sources)}\n"""`, sources, refuse: false };
}

export interface FinishedAnswer {
  /** The answer, without markers that named no source. */
  content: string;
  /** The sources it cites, in order of first citation (what the chips show, and what the links point to). */
  cited: Source[];
  /** Vault only, and the answer cites nothing: it is not backed by the notes, and the person is told. */
  uncited: boolean;
}

export function finishAnswer(response: string, sources: readonly Source[], vaultOnly: boolean): FinishedAnswer {
  const read = readCitations(response, sources.length);
  const cited = read.cited.map(n => sources[n - 1]);
  return { content: read.text, cited, uncited: vaultOnly && sources.length > 0 && cited.length === 0 };
}

export { sourceLabel };
