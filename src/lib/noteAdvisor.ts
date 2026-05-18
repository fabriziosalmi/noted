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

export type SuggestionActionKind = 'open' | 'rename' | 'addHeadings' | 'openFirst';

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  severity: SuggestionSeverity;
  /** i18n key for title, e.g. 'advSecretTitle' */
  titleKey: string;
  /** params to interpolate into title, e.g. { label: 'GitHub token' } */
  titleParams?: Record<string, string | number>;
  /** i18n key for detail */
  detailKey: string;
  detailParams?: Record<string, string | number>;
  noteName: string;
  relatedNotes?: string[];
  /** primary remediation action exposed to the user */
  action: SuggestionActionKind;
}

export interface NoteInput {
  name: string;
  text: string;    // plain text (no HTML)
  html: string;    // raw HTML for structure checks
  mtimeMs: number;
}

// --- Security patterns ---

// `labelKey` resolves to an i18n key for the human-readable label of the secret
// kind. This keeps suggestions language-agnostic at generation time.
const SECRET_PATTERNS: {
  id: string;
  labelKey: string;
  regex: RegExp;
  kind: SuggestionKind;
  severity: SuggestionSeverity;
}[] = [
  {
    id: 'github-token',
    labelKey: 'advLabelGithubToken',
    kind: 'secret-token',
    severity: 'high',
    regex: /\b(ghp|ghs|gho|ghr|github_pat)_[A-Za-z0-9_]{20,}/,
  },
  {
    id: 'openai-key',
    labelKey: 'advLabelOpenaiKey',
    kind: 'secret-key',
    severity: 'high',
    regex: /\bsk-[A-Za-z0-9]{32,}/,
  },
  {
    id: 'anthropic-key',
    labelKey: 'advLabelAnthropicKey',
    kind: 'secret-key',
    severity: 'high',
    regex: /\bsk-ant-[A-Za-z0-9\-_]{30,}/,
  },
  {
    id: 'aws-access-key',
    labelKey: 'advLabelAwsCredential',
    kind: 'secret-key',
    severity: 'high',
    regex: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: 'bearer-token',
    labelKey: 'advLabelBearerToken',
    kind: 'secret-token',
    severity: 'high',
    regex: /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}/,
  },
  {
    id: 'pem-key',
    labelKey: 'advLabelPemKey',
    kind: 'secret-pem',
    severity: 'high',
    regex: /-----BEGIN\s+(?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    id: 'url-with-creds',
    labelKey: 'advLabelUrlWithCreds',
    kind: 'secret-url',
    severity: 'high',
    regex: /https?:\/\/[^\s/:@]{1,64}:[^\s@]{3,64}@[^\s]+/,
  },
  {
    id: 'env-secret',
    labelKey: 'advLabelEnvSecret',
    kind: 'secret-env',
    severity: 'medium',
    regex: /\b[A-Z][A-Z0-9_]{1,}(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|PASS|AUTH)\s*[=:]\s*\S{6,}/m,
  },
  {
    id: 'stripe-key',
    labelKey: 'advLabelStripeKey',
    kind: 'secret-key',
    severity: 'high',
    regex: /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{20,}/,
  },
  {
    id: 'heroku-api-key',
    labelKey: 'advLabelHerokuKey',
    kind: 'secret-key',
    severity: 'high',
    // Bounded `.{0,80}` instead of unbounded `.*` to prevent catastrophic
    // backtracking on long lines.
    regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b.{0,80}heroku/i,
  },
];

// --- Organization heuristics ---

const GENERIC_TITLES = ['nuova nota', 'untitled', 'nota', 'new note', 'appunti', 'bozza', 'draft'];

const WORD_COUNT_SPLIT_THRESHOLD = 800;
const STALE_DAYS = 90;
const STALE_WORD_MIN = 200;
const DUPLICATE_TOPIC_MIN_NOTES = 2;

// Keywords too generic to flag as duplicate topics.
const STOPWORD_KEYWORDS = new Set([
  'nota', 'note', 'new', 'nuova', 'appunti', 'todo', 'tasks', 'task',
  'ideas', 'idee', 'idea', 'project', 'progetto', 'work', 'lavoro',
  'meeting', 'meetings', 'daily', 'weekly', 'monthly', 'draft',
  'bozza', 'temp', 'misc', 'random', 'inbox', 'archive',
]);

function bareTitle(name: string): string {
  return name.replace(/\.md$/, '');
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function hasHeadings(html: string): boolean {
  return /<h[1-3][^>]*>/i.test(html);
}

function extractKeywords(name: string): string[] {
  return name
    .replace(/\.md$/, '')
    .toLowerCase()
    .split(/[\s_\-./]+/)
    // Require length >4 and not in stoplist to reduce false positives.
    .filter(w => w.length > 4 && !STOPWORD_KEYWORDS.has(w));
}

// --- Main analysis functions ---

export function analyzeNote(note: NoteInput): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const noteName = note.name;
  const text = note.text;
  const wc = wordCount(text);
  const title = bareTitle(noteName);

  // Security scan
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.regex.test(text)) {
      suggestions.push({
        id: `${noteName}__${pattern.id}`,
        kind: pattern.kind,
        severity: pattern.severity,
        titleKey: 'advSecretTitle',
        titleParams: { labelKey: pattern.labelKey },
        detailKey: 'advSecretDetail',
        detailParams: { note: title, labelKey: pattern.labelKey },
        noteName,
        action: 'open',
      });
    }
  }

  // Generic title
  const titleBase = title.toLowerCase().trim();
  if (GENERIC_TITLES.some(g => titleBase === g || titleBase.startsWith(g + '_') || titleBase.startsWith(g + ' '))) {
    suggestions.push({
      id: `${noteName}__generic-title`,
      kind: 'org-generic-title',
      severity: 'low',
      titleKey: 'advGenericTitle',
      detailKey: 'advGenericDetail',
      detailParams: { note: title },
      noteName,
      action: 'rename',
    });
  }

  // Too long → suggest splitting
  if (wc > WORD_COUNT_SPLIT_THRESHOLD) {
    suggestions.push({
      id: `${noteName}__split`,
      kind: 'org-split',
      severity: 'low',
      titleKey: 'advSplitTitle',
      detailKey: 'advSplitDetail',
      detailParams: { note: title, wc },
      noteName,
      action: 'open',
    });
  }

  // Long note with no structure
  if (wc > 300 && !hasHeadings(note.html)) {
    suggestions.push({
      id: `${noteName}__no-structure`,
      kind: 'org-no-structure',
      severity: 'low',
      titleKey: 'advNoStructureTitle',
      detailKey: 'advNoStructureDetail',
      detailParams: { note: title },
      noteName,
      action: 'addHeadings',
    });
  }

  return suggestions;
}

export function analyzeCrossNotes(notes: NoteInput[]): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const now = Date.now();

  for (const note of notes) {
    const ageDays = (now - note.mtimeMs) / (1000 * 60 * 60 * 24);
    const wc = wordCount(note.text);
    if (ageDays >= STALE_DAYS && wc >= STALE_WORD_MIN) {
      suggestions.push({
        id: `${note.name}__stale`,
        kind: 'org-stale',
        severity: 'low',
        titleKey: 'advStaleTitle',
        detailKey: 'advStaleDetail',
        detailParams: { note: bareTitle(note.name), days: Math.floor(ageDays) },
        noteName: note.name,
        action: 'open',
      });
    }
  }

  // Duplicate topics — group notes by shared keyword.
  // Require ≥DUPLICATE_TOPIC_MIN_NOTES *and* tighter stoplist (see extractKeywords).
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
      suggestions.push({
        id: `cross__topic__${kw}`,
        kind: 'org-duplicate-topic',
        severity: 'low',
        titleKey: 'advDuplicateTopicTitle',
        titleParams: { count: noteNames.length },
        detailKey: 'advDuplicateTopicDetail',
        detailParams: {
          kw,
          list: noteNames.map(n => `"${bareTitle(n)}"`).join(', '),
        },
        noteName: noteNames[0],
        relatedNotes: noteNames.slice(1),
        action: 'openFirst',
      });
    }
  }

  return suggestions;
}

export function runAdvisor(activeNote: NoteInput | null, allNotes: NoteInput[]): Suggestion[] {
  const perNote = activeNote ? analyzeNote(activeNote) : [];
  const cross = analyzeCrossNotes(allNotes);

  const seen = new Set<string>();
  const all: Suggestion[] = [];
  for (const s of [...perNote, ...cross]) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      all.push(s);
    }
  }

  const severityOrder = { high: 0, medium: 1, low: 2 };
  const kindOrder = (k: SuggestionKind) => k.startsWith('secret') ? 0 : 1;
  return all.sort((a, b) =>
    severityOrder[a.severity] - severityOrder[b.severity] ||
    kindOrder(a.kind) - kindOrder(b.kind)
  );
}
