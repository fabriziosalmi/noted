export type SuggestionKind =
  | 'secret-token'
  | 'secret-key'
  | 'secret-url'
  | 'secret-env'
  | 'secret-pem'
  | 'org-split'
  | 'org-generic-title'
  | 'org-no-structure'
  | 'org-duplicate-topic'
  | 'org-stale';

export type SuggestionSeverity = 'high' | 'medium' | 'low';

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  severity: SuggestionSeverity;
  title: string;
  detail: string;
  noteName: string;
  relatedNotes?: string[];
}

export interface NoteInput {
  name: string;
  text: string;    // plain text (no HTML)
  html: string;    // raw HTML for structure checks
  mtimeMs: number;
}

// --- Security patterns ---

const SECRET_PATTERNS: {
  id: string;
  label: string;
  regex: RegExp;
  kind: SuggestionKind;
  severity: SuggestionSeverity;
}[] = [
  {
    id: 'github-token',
    label: 'token GitHub',
    kind: 'secret-token',
    severity: 'high',
    regex: /\b(ghp|ghs|gho|ghr|github_pat)_[A-Za-z0-9_]{20,}/,
  },
  {
    id: 'openai-key',
    label: 'API key OpenAI',
    kind: 'secret-key',
    severity: 'high',
    regex: /\bsk-[A-Za-z0-9]{32,}/,
  },
  {
    id: 'anthropic-key',
    label: 'API key Anthropic',
    kind: 'secret-key',
    severity: 'high',
    regex: /\bsk-ant-[A-Za-z0-9\-_]{30,}/,
  },
  {
    id: 'aws-access-key',
    label: 'credenziale AWS',
    kind: 'secret-key',
    severity: 'high',
    regex: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: 'bearer-token',
    label: 'Bearer token',
    kind: 'secret-token',
    severity: 'high',
    regex: /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}/,
  },
  {
    id: 'pem-key',
    label: 'chiave privata (PEM)',
    kind: 'secret-pem',
    severity: 'high',
    regex: /-----BEGIN\s+(?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    id: 'url-with-creds',
    label: 'URL con credenziali incorporate',
    kind: 'secret-url',
    severity: 'high',
    regex: /https?:\/\/[^\s/:@]{1,64}:[^\s@]{3,64}@[^\s]+/,
  },
  {
    id: 'env-secret',
    label: 'variabile d\'ambiente con segreto',
    kind: 'secret-env',
    severity: 'medium',
    // matches KEY=value or KEY: value where key contains secret-y words
    regex: /\b[A-Z][A-Z0-9_]{1,}(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|PASS|AUTH)\s*[=:]\s*\S{6,}/m,
  },
  {
    id: 'stripe-key',
    label: 'chiave Stripe',
    kind: 'secret-key',
    severity: 'high',
    regex: /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{20,}/,
  },
  {
    id: 'heroku-api-key',
    label: 'API key Heroku',
    kind: 'secret-key',
    severity: 'high',
    regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b.*heroku/i,
  },
];

// --- Organization heuristics ---

const GENERIC_TITLES = ['nuova nota', 'untitled', 'nota', 'new note', 'appunti', 'bozza', 'draft'];

const WORD_COUNT_SPLIT_THRESHOLD = 800;
const STALE_DAYS = 90;
const STALE_WORD_MIN = 200;
const DUPLICATE_TOPIC_MIN_NOTES = 2;

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function hasHeadings(html: string): boolean {
  return /<h[1-3][^>]*>/i.test(html);
}

function extractKeywords(name: string): string[] {
  return name
    .replace('.md', '')
    .toLowerCase()
    .split(/[\s_\-./]+/)
    .filter(w => w.length > 3 && !['nota', 'note', 'new', 'nuova', 'appunti'].includes(w));
}

// --- Main analysis functions ---

export function analyzeNote(note: NoteInput): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const noteName = note.name;
  const text = note.text;
  const wc = wordCount(text);

  // Security scan
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.regex.test(text)) {
      suggestions.push({
        id: `${noteName}__${pattern.id}`,
        kind: pattern.kind,
        severity: pattern.severity,
        title: `Possibile ${pattern.label} trovato`,
        detail: `"${noteName.replace('.md', '')}" sembra contenere ${pattern.label}. Considera di spostare questi dati in un password manager o nel keychain di sistema.`,
        noteName,
      });
    }
  }

  // Generic title
  const titleBase = noteName.replace('.md', '').toLowerCase().trim();
  if (GENERIC_TITLES.some(g => titleBase === g || titleBase.startsWith(g + '_') || titleBase.startsWith(g + ' '))) {
    suggestions.push({
      id: `${noteName}__generic-title`,
      kind: 'org-generic-title',
      severity: 'low',
      title: 'Titolo nota generico',
      detail: `"${noteName.replace('.md', '')}" ha un titolo poco descrittivo. Un nome specifico rende più facile trovare la nota in futuro.`,
      noteName,
    });
  }

  // Too long → suggest splitting
  if (wc > WORD_COUNT_SPLIT_THRESHOLD) {
    suggestions.push({
      id: `${noteName}__split`,
      kind: 'org-split',
      severity: 'low',
      title: 'Nota molto lunga',
      detail: `"${noteName.replace('.md', '')}" contiene ${wc} parole. Considera di suddividerla in note più specifiche per argomento.`,
      noteName,
    });
  }

  // Long note with no structure (no headings)
  if (wc > 300 && !hasHeadings(note.html)) {
    suggestions.push({
      id: `${noteName}__no-structure`,
      kind: 'org-no-structure',
      severity: 'low',
      title: 'Nota lunga senza struttura',
      detail: `"${noteName.replace('.md', '')}" è abbastanza lunga ma non ha titoli di sezione. Aggiungere H1/H2 migliora la leggibilità e la navigazione.`,
      noteName,
    });
  }

  return suggestions;
}

export function analyzeCrossNotes(notes: NoteInput[]): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const now = Date.now();

  // Stale notes
  for (const note of notes) {
    const ageDays = (now - note.mtimeMs) / (1000 * 60 * 60 * 24);
    const wc = wordCount(note.text);
    if (ageDays >= STALE_DAYS && wc >= STALE_WORD_MIN) {
      suggestions.push({
        id: `${note.name}__stale`,
        kind: 'org-stale',
        severity: 'low',
        title: 'Nota non aggiornata da tempo',
        detail: `"${note.name.replace('.md', '')}" non viene modificata da ${Math.floor(ageDays)} giorni. Potrebbe essere archiviata o aggiornata.`,
        noteName: note.name,
      });
    }
  }

  // Duplicate topics — group notes by shared keyword
  const keywordMap = new Map<string, string[]>();
  for (const note of notes) {
    for (const kw of extractKeywords(note.name)) {
      const group = keywordMap.get(kw) ?? [];
      group.push(note.name);
      keywordMap.set(kw, group);
    }
  }
  for (const [kw, noteNames] of keywordMap) {
    if (noteNames.length >= DUPLICATE_TOPIC_MIN_NOTES) {
      const id = `cross__topic__${kw}`;
      suggestions.push({
        id,
        kind: 'org-duplicate-topic',
        severity: 'low',
        title: `${noteNames.length} note sullo stesso argomento`,
        detail: `Le note su "${kw}" sono separate (${noteNames.map(n => `"${n.replace('.md', '')}"`).join(', ')}). Potrebbe valere la pena consolidarle in un'unica nota strutturata.`,
        noteName: noteNames[0],
        relatedNotes: noteNames.slice(1),
      });
    }
  }

  return suggestions;
}

export function runAdvisor(activeNote: NoteInput | null, allNotes: NoteInput[]): Suggestion[] {
  const perNote = activeNote ? analyzeNote(activeNote) : [];
  const cross = analyzeCrossNotes(allNotes);

  // Deduplicate by id (cross-note may overlap with per-note)
  const seen = new Set<string>();
  const all: Suggestion[] = [];
  for (const s of [...perNote, ...cross]) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      all.push(s);
    }
  }

  // Sort: high → medium → low, then security → org
  const severityOrder = { high: 0, medium: 1, low: 2 };
  const kindOrder = (k: SuggestionKind) => k.startsWith('secret') ? 0 : 1;
  return all.sort((a, b) =>
    severityOrder[a.severity] - severityOrder[b.severity] ||
    kindOrder(a.kind) - kindOrder(b.kind)
  );
}
