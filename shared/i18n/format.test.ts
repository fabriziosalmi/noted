import { describe, expect, it } from 'vitest';
import { fillTemplate } from './format';

describe('fillTemplate', () => {
  it('fills every placeholder, each occurrence', () => {
    expect(fillTemplate('{a} and {b}, then {a}', { a: 'x', b: 2 })).toBe('x and 2, then x');
  });
  it('leaves an unknown placeholder visible and text without placeholders alone', () => {
    expect(fillTemplate('Hello {name}', {})).toBe('Hello {name}');
    expect(fillTemplate('plain')).toBe('plain');
  });
  it('does not treat the value as a template, nor "$&" as a replacement pattern', () => {
    expect(fillTemplate('{a}', { a: '{b} $& $1' })).toBe('{b} $& $1');
  });
});
