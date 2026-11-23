// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { transformTextCase, cycleTextCase, type TextCaseMode } from './textCase';

describe('transformTextCase', () => {
  it('lower-cases ASCII', () => {
    expect(transformTextCase('Hello World', 'lower')).toBe('hello world');
  });

  it('upper-cases ASCII', () => {
    expect(transformTextCase('Hello World', 'upper')).toBe('HELLO WORLD');
  });

  it('title-cases every word, keeping the rest of each word intact', () => {
    expect(transformTextCase('hello wORld', 'title')).toBe('Hello WORld');
  });

  it('sentence-cases the first letter and lower-cases the rest', () => {
    expect(transformTextCase('hELLO WORLD', 'sentence')).toBe('Hello world');
  });

  it('returns an empty string for every mode', () => {
    const modes: TextCaseMode[] = ['lower', 'upper', 'title', 'sentence'];
    for (const mode of modes) {
      expect(transformTextCase('', mode)).toBe('');
    }
  });

  it('handles Unicode letters when title-casing', () => {
    expect(transformTextCase('élan vital', 'title')).toBe('Élan Vital');
    expect(transformTextCase('привет мир', 'title')).toBe('Привет Мир');
  });

  it('up-cases Unicode and expands special characters', () => {
    expect(transformTextCase('straße', 'upper')).toBe('STRASSE');
  });

  it('handles Unicode letters when sentence-casing', () => {
    expect(transformTextCase('ÄPFEL UND birnen', 'sentence')).toBe('Äpfel und birnen');
  });

  it('leaves text without letters unaffected when title-casing', () => {
    expect(transformTextCase('123 456', 'title')).toBe('123 456');
  });
});

describe('cycleTextCase', () => {
  it('advances lower -> upper -> title -> sentence -> lower with the text transformed each step', () => {
    let state = { mode: 'lower' as TextCaseMode, text: 'hello world' };

    state = { text: 'hello world', ...cycleTextCase(state.text, state.mode) };
    expect(state).toEqual({ mode: 'upper', text: 'HELLO WORLD' });

    state = cycleTextCase(state.text, state.mode);
    expect(state).toEqual({ mode: 'title', text: 'HELLO WORLD' });

    state = cycleTextCase(state.text, state.mode);
    expect(state).toEqual({ mode: 'sentence', text: 'Hello world' });

    state = cycleTextCase(state.text, state.mode);
    expect(state).toEqual({ mode: 'lower', text: 'hello world' });
  });

  it('returns to the starting text after a full cycle', () => {
    const start: TextCaseMode = 'lower';
    let state = { mode: start, text: 'Mixed Case text' };
    for (let i = 0; i < 4; i += 1) {
      state = cycleTextCase(state.text, state.mode);
    }
    expect(state.mode).toBe(start);
    expect(state.text).toBe('mixed case text');
  });

  it('preserves empty strings through a full cycle', () => {
    let state = { mode: 'lower' as TextCaseMode, text: '' };
    for (let i = 0; i < 4; i += 1) {
      state = cycleTextCase(state.text, state.mode);
    }
    expect(state).toEqual({ mode: 'lower', text: '' });
  });
});
