import { describe, it, expect } from 'vitest';
import { maskPii, hasPii, PII_PATTERNS } from './piiMasker';

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
