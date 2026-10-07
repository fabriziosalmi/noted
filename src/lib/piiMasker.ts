export interface PiiResult {
  maskedText: string;
  count: number;
}

// Patterns are defined once at module load — the previous version compiled a
// new RegExp on every call, which was wasteful and (worse) reset the `g` flag
// state inconsistencies across invocations. All patterns are bounded to avoid
// catastrophic backtracking on pathological input.
export const PII_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'EMAIL',  pattern: /[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,255}\.[a-zA-Z]{2,24}/g },
  { name: 'PHONE',  pattern: /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?!\d)/g },
  { name: 'CARD',   pattern: /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/g },
  { name: 'SSN',    pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'IBAN',   pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}[A-Z0-9]{0,16}\b/g },
  { name: 'IP',     pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { name: 'CF',     pattern: /\b[A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z]\b/gi },
  { name: 'VAT',    pattern: /\b[A-Z]{2}\d{8,12}\b/g },
];

// Already-masked tokens (output of a previous maskPii pass) match `VAT` and
// other patterns trivially — skip the run if the input was already masked.
const MASK_TOKEN_RE = /\[(?:EMAIL|PHONE|CARD|SSN|IBAN|IP|CF|VAT)_\d+\]/;

// Hard cap on text size — beyond this we don't even try; PII masking is a
// hint, not a security boundary.
const MAX_INPUT_CHARS = 200_000;

export function maskPii(text: string): PiiResult {
  if (text.length > MAX_INPUT_CHARS) return { maskedText: text, count: 0 };

  const counters: Record<string, number> = {};
  let maskedText = text;

  for (const { name, pattern } of PII_PATTERNS) {
    counters[name] = 0;
    // Reset lastIndex before each replace call. We can reuse the same RegExp
    // object across calls because String.prototype.replace with a /g RegExp
    // does not depend on lastIndex (it scans the whole string each time).
    pattern.lastIndex = 0;
    maskedText = maskedText.replace(pattern, (match) => {
      // Don't double-mask: if the matched substring already looks like a token
      // we emitted on a prior pattern this same call, pass it through.
      if (MASK_TOKEN_RE.test(match)) return match;
      counters[name]++;
      return `[${name}_${counters[name]}]`;
    });
  }

  const count = Object.values(counters).reduce((a, b) => a + b, 0);
  return { maskedText, count };
}

export function hasPii(text: string): boolean {
  if (text.length > MAX_INPUT_CHARS) return false;
  for (const { pattern } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
}

// ==========================================
// Masking that can be undone
// ==========================================
//
// A masker is one conversation's worth of masking: the same value always gets the same token, tokens never repeat for
// different values (the counters run across every message it masks, not per message), and the model's answer can be
// turned back into the original text, locally. Without this, "[EMAIL_1]" in an answer cannot be told from the
// "[EMAIL_1]" of another message.

const TOKEN_RE = /\[(EMAIL|PHONE|CARD|SSN|IBAN|IP|CF|VAT)_(\d+)\]/g;
// The end of a chunk that could still become a token: "[", "[EMA", "[EMAIL_", "[EMAIL_12". Longest token is "[PHONE_" + digits + "]".
const PARTIAL_TOKEN_RE = /\[[A-Z]{0,5}(?:_\d{0,6})?$/;

export interface StreamUnmasker {
  /** Text safe to show for this chunk; a token cut in two by the chunk boundary waits for its other half. */
  push(chunk: string): string;
  /** What is left at the end of the stream (a "[" that never became a token is text like any other). */
  flush(): string;
}

export interface PiiMasker {
  mask(text: string): string;
  unmask(text: string): string;
  streamUnmasker(): StreamUnmasker;
  /** How many distinct values have been masked. */
  readonly count: number;
}

export function createMasker(): PiiMasker {
  const counters: Record<string, number> = {};
  const tokenOf = new Map<string, string>(); // `${kind}\0${value}` -> token
  const valueOf = new Map<string, string>(); // token -> original value

  const mask = (text: string): string => {
    if (text.length > MAX_INPUT_CHARS) return text;
    let out = text;
    for (const { name, pattern } of PII_PATTERNS) {
      pattern.lastIndex = 0;
      out = out.replace(pattern, (match) => {
        if (MASK_TOKEN_RE.test(match)) return match;
        const key = `${name}\0${match}`;
        let token = tokenOf.get(key);
        if (!token) {
          counters[name] = (counters[name] ?? 0) + 1;
          token = `[${name}_${counters[name]}]`;
          tokenOf.set(key, token);
          valueOf.set(token, match);
        }
        return token;
      });
    }
    return out;
  };

  const unmask = (text: string): string => text.replace(TOKEN_RE, (token) => valueOf.get(token) ?? token);

  const streamUnmasker = (): StreamUnmasker => {
    let held = '';
    return {
      push(chunk) {
        const text = held + chunk;
        const cut = text.search(PARTIAL_TOKEN_RE);
        if (cut === -1) { held = ''; return unmask(text); }
        held = text.slice(cut);
        return unmask(text.slice(0, cut));
      },
      flush() {
        const rest = held;
        held = '';
        return unmask(rest);
      },
    };
  };

  return { mask, unmask, streamUnmasker, get count() { return tokenOf.size; } };
}
