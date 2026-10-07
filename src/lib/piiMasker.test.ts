import { describe, it, expect } from 'vitest';
import { maskPii, hasPii, PII_PATTERNS, createMasker } from './piiMasker';

describe('piiMasker hasPii', () => {
  it('detects simple email addresses', () => {
    expect(hasPii('My email is test@example.com.')).toBe(true);
    expect(hasPii('test.name+alias@domain.co.uk')).toBe(true);
  });

  it('detects phone numbers', () => {
    expect(hasPii('Call me at +39 02 1234567')).toBe(true);
    expect(hasPii('Phone: (0039) 333-1234-567')).toBe(true);
    expect(hasPii('Number is 340.1234.567')).toBe(true);
  });

  it('detects credit card numbers', () => {
    expect(hasPii('My card is 1234-5678-1234-5678.')).toBe(true);
    expect(hasPii('Card: 1234 5678 1234 5678')).toBe(true);
  });

  it('detects SSN', () => {
    expect(hasPii('SSN: 123-45-6789')).toBe(true);
  });

  it('detects IBAN codes', () => {
    expect(hasPii('My IBAN is IT60D1234512345123456789012.')).toBe(true);
  });

  it('detects IP addresses', () => {
    expect(hasPii('Server IP is 192.168.1.1.')).toBe(true);
    expect(hasPii('127.0.0.1')).toBe(true);
  });

  it('detects CF (Codice Fiscale) codes', () => {
    expect(hasPii('Il mio codice fiscale è RSSMRA85A01F205Z.')).toBe(true);
    expect(hasPii('rssmra85a01f205z')).toBe(true); // lower case
  });

  it('detects VAT IDs', () => {
    expect(hasPii('P.IVA: IT12345678901.')).toBe(true);
  });

  it('returns false for text without PII', () => {
    expect(hasPii('This is a completely safe note with no sensitive data.')).toBe(false);
    expect(hasPii('')).toBe(false);
  });

  it('returns false for inputs exceeding MAX_INPUT_CHARS', () => {
    const hugeText = 'a'.repeat(200_001);
    expect(hasPii(hugeText)).toBe(false);
  });
});

describe('piiMasker maskPii', () => {
  it('masks single and multiple PII occurrences', () => {
    const text = 'Contact test@example.com or call +39 02 1234567.';
    const result = maskPii(text);
    expect(result.count).toBe(2);
    expect(result.maskedText).toContain('[EMAIL_1]');
    expect(result.maskedText).toContain('[PHONE_1]');
  });

  it('avoids double-masking already masked tokens', () => {
    // We append a custom pattern that will match the [EMAIL_1] token, simulating a regex match
    // on an already masked token.
    PII_PATTERNS.push({ name: 'TEST', pattern: /\[EMAIL_\d+\]/g });
    try {
      const text = 'Use [EMAIL_1] to write to test@example.com.';
      const result = maskPii(text);
      // It should NOT double-mask the [EMAIL_1] part. It should only mask the email.
      expect(result.maskedText).toBe('Use [EMAIL_1] to write to [EMAIL_1].');
    } finally {
      PII_PATTERNS.pop();
    }
  });

  it('handles empty string input', () => {
    const result = maskPii('');
    expect(result.count).toBe(0);
    expect(result.maskedText).toBe('');
  });

  it('returns original text if input is too long', () => {
    const hugeText = 'a'.repeat(200_001) + ' test@example.com';
    const result = maskPii(hugeText);
    expect(result.count).toBe(0);
    expect(result.maskedText).toBe(hugeText);
  });

  it('correctly increments counters per type', () => {
    const text = 'Emails: a@b.com, c@d.com. Phones: 333-123-4567, 344-555-6666';
    const result = maskPii(text);
    expect(result.count).toBe(4);
    expect(result.maskedText).toBe('Emails: [EMAIL_1], [EMAIL_2]. Phones: [PHONE_1], [PHONE_2]');
  });
});

describe('createMasker', () => {
  const MESSAGE = 'Write to ana@example.com or bob@example.org, again ana@example.com, call 192.168.1.20 now';

  it('gives the same value the same token, and different values different ones', () => {
    const m = createMasker();
    const out = m.mask(MESSAGE);
    expect(out).toBe('Write to [EMAIL_1] or [EMAIL_2], again [EMAIL_1], call [IP_1] now');
    expect(m.count).toBe(3);
  });

  it('keeps counting across messages, so a token never means two values', () => {
    const m = createMasker();
    expect(m.mask('mail ana@example.com')).toBe('mail [EMAIL_1]');
    expect(m.mask('mail bob@example.org')).toBe('mail [EMAIL_2]');
    expect(m.mask('mail ana@example.com')).toBe('mail [EMAIL_1]');
    // maskPii alone starts again at 1 in every message: the collision the masker exists to prevent
    expect(maskPii('mail bob@example.org').maskedText).toBe('mail [EMAIL_1]');
  });

  it('turns an answer back into the original text, and leaves tokens it never issued', () => {
    const m = createMasker();
    m.mask(MESSAGE);
    expect(m.unmask('Sure: [EMAIL_2] and [EMAIL_1] at [IP_1]; also [EMAIL_9] and [PHONE_1] and [not a token].'))
      .toBe('Sure: bob@example.org and ana@example.com at 192.168.1.20; also [EMAIL_9] and [PHONE_1] and [not a token].');
  });

  it('does not mask what it masked already', () => {
    const m = createMasker();
    const once = m.mask(MESSAGE);
    expect(m.mask(once)).toBe(once);
  });

  describe('streamUnmasker', () => {
    const answer = 'Mail [EMAIL_1], then [EMAIL_2] (or [IP_1]). Items [a] and [B] stay, so does a final [';
    const expected = 'Mail ana@example.com, then bob@example.org (or 192.168.1.20). Items [a] and [B] stay, so does a final [';
    const run = (chunks: string[]) => {
      const m = createMasker();
      m.mask(MESSAGE);
      const u = m.streamUnmasker();
      return chunks.map(c => u.push(c)).join('') + u.flush();
    };

    it('gives the same text however the stream is cut: at every position', () => {
      for (let i = 0; i <= answer.length; i++) expect(run([answer.slice(0, i), answer.slice(i)])).toBe(expected);
    });

    it('and one character at a time, and in three pieces', () => {
      expect(run([...answer])).toBe(expected);
      for (let i = 0; i < answer.length; i += 3) for (let j = i; j < answer.length; j += 5) {
        expect(run([answer.slice(0, i), answer.slice(i, j), answer.slice(j)])).toBe(expected);
      }
    });

    it('never shows half a token', () => {
      const m = createMasker();
      m.mask(MESSAGE);
      const u = m.streamUnmasker();
      expect(u.push('see [EMA')).toBe('see ');
      expect(u.push('IL_')).toBe('');
      expect(u.push('1] ok')).toBe('ana@example.com ok');
    });

    it('does not hold text back for long: a "[" that cannot become a token is released', () => {
      const m = createMasker();
      const u = m.streamUnmasker();
      expect(u.push('a [')).toBe('a ');
      expect(u.push('link](x)')).toBe('[link](x)');
    });
  });
});
