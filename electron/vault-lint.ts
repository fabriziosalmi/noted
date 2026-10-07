import { DEFAULT_LINT, lintVault, type LintNote, type LintOptions, type LintReport } from '../shared/lint/vaultLint.js';
import type { FullTextSearchReadModel } from './fulltext-index.js';
import type { VaultIndex } from './vault-index.js';

export interface LintDeps {
  vaultIndex: VaultIndex;
  fullText: FullTextSearchReadModel;
  validate: (name: string) => void;
}

/** The health report of a vault, from what the app already knows of it: nothing is read from disk for it. */
export async function lintVaultDir(dir: string, deps: LintDeps, opts: Partial<Omit<LintOptions, 'now'>> = {}, now = Date.now()): Promise<LintReport> {
  await deps.vaultIndex.ensure(dir);
  const texts = await deps.fullText.plainTexts(dir, deps.validate);
  const notes: LintNote[] = deps.vaultIndex.entries(dir).map(e => ({
    name: e.name,
    links: e.links.map(l => ({ target: l.target, heading: l.heading })),
    headings: e.headings.map(h => h.text),
    aliases: e.aliases,
    fields: e.fields,
    text: texts.get(e.name) ?? '',
    mtimeMs: e.mtimeMs,
    parsed: e.parsed,
  }));
  return lintVault(notes, { ...DEFAULT_LINT, ...opts, now });
}
