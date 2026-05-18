export interface PiiResult {
  maskedText: string;
  count: number;
}

const PII_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'EMAIL',  pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g },
  { name: 'PHONE',  pattern: /(?:\+?\d{1,3}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}(?!\d)/g },
  { name: 'CARD',   pattern: /\b\d{4}[\s\-]\d{4}[\s\-]\d{4}[\s\-]\d{4}\b/g },
  { name: 'SSN',    pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'IBAN',   pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}[A-Z0-9]{0,16}\b/g },
  { name: 'IP',     pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  // Italian codice fiscale
  { name: 'CF',     pattern: /\b[A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z]\b/gi },
  // Italian/EU VAT
  { name: 'VAT',    pattern: /\b[A-Z]{2}\d{8,12}\b/g },
];

export function maskPii(text: string): PiiResult {
  const counters: Record<string, number> = {};
  let maskedText = text;

  for (const { name, pattern } of PII_PATTERNS) {
    counters[name] = 0;
    maskedText = maskedText.replace(new RegExp(pattern.source, pattern.flags), () => {
      counters[name]++;
      return `[${name}_${counters[name]}]`;
    });
  }

  const count = Object.values(counters).reduce((a, b) => a + b, 0);
  return { maskedText, count };
}

export function hasPii(text: string): boolean {
  return PII_PATTERNS.some(({ pattern }) =>
    new RegExp(pattern.source, pattern.flags).test(text)
  );
}
