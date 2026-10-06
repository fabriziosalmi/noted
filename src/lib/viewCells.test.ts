import { describe, it, expect } from 'vitest';
import { cellFor, cellText, editorText, parseCellInput, propertyType, initialValue } from './viewCells';

describe('cellFor', () => {
  it('empty values are empty, but an empty checkbox is an unchecked box', () => {
    for (const v of [undefined, null, '', []] as const) expect(cellFor(v, 'text')).toEqual({ kind: 'empty' });
    expect(cellFor(undefined, 'checkbox')).toEqual({ kind: 'check', checked: false });
  });

  it('checkboxes, numbers (right-aligned only in a number field), lists and choices', () => {
    expect(cellFor(true, 'checkbox')).toEqual({ kind: 'check', checked: true });
    expect(cellFor(3, 'number')).toEqual({ kind: 'text', text: '3', align: 'right' });
    expect(cellFor(3, 'text')).toEqual({ kind: 'text', text: '3', align: undefined });
    expect(cellFor(['a', 'b'], 'list')).toEqual({ kind: 'chips', items: ['a', 'b'] });
    expect(cellFor('open', 'select')).toEqual({ kind: 'chips', items: ['open'] });
    expect(cellFor('2026-10-06', 'date')).toEqual({ kind: 'text', text: '2026-10-06' });
  });

  it('a value that does not fit the field\'s type is shown as it is', () => {
    expect(cellFor(true, 'text')).toEqual({ kind: 'text', text: 'true' });
    expect(cellFor(['a'], 'text')).toEqual({ kind: 'chips', items: ['a'] });
    expect(cellFor('many', 'number')).toEqual({ kind: 'text', text: 'many' });
  });

  it('a link value is a link cell in a link field, a plain text anywhere else', () => {
    expect(cellFor('[[Home]]', 'link')).toEqual({ kind: 'link', value: '[[Home]]' });
    expect(cellFor('[[Home]]', 'text')).toEqual({ kind: 'text', text: '[[Home]]' });
    expect(cellFor('Home', 'link')).toEqual({ kind: 'text', text: 'Home' });
    expect(cellText(cellFor('[[Home|my home]]', 'link'))).toBe('my home');
    expect(cellText(cellFor(['[[A]]', 'b'], 'list'))).toBe('A, b');
  });

  it('cellText gives each cell as text', () => {
    expect(cellText(cellFor(['a', 'b'], 'list'))).toBe('a, b');
    expect(cellText(cellFor(true, 'checkbox'))).toBe('✓');
    expect(cellText(cellFor(undefined, 'text'))).toBe('');
  });
});

describe('editing a cell', () => {
  it('the editor starts with the value as text, lists comma-separated', () => {
    expect(editorText(undefined)).toBe('');
    expect(editorText(null)).toBe('');
    expect(editorText(3)).toBe('3');
    expect(editorText(['a', 'b'])).toBe('a, b');
  });

  it('what is typed becomes the value: empty clears, numbers are numbers, lists are split', () => {
    expect(parseCellInput('  ', 'text')).toBeUndefined();
    expect(parseCellInput(' open ', 'select')).toBe('open');
    expect(parseCellInput('12.5', 'number')).toBe(12.5);
    expect(parseCellInput('twelve', 'number')).toBe('twelve');
    expect(parseCellInput('12', 'text')).toBe('12');
    expect(parseCellInput('a, b ,, c', 'list')).toEqual(['a', 'b', 'c']);
    expect(parseCellInput(' , ', 'list')).toBeUndefined();
    expect(parseCellInput('2026-10-06', 'date')).toBe('2026-10-06');
    expect(parseCellInput('Home', 'link')).toBe('[[Home]]');
    expect(parseCellInput(' [[Home|my]] ', 'link')).toBe('[[Home|my]]');
  });
});

describe('propertyType', () => {
  it('a value shows its own type first', () => {
    expect(propertyType(3, 'text', undefined)).toBe('number');
    expect(propertyType(false, undefined, undefined)).toBe('checkbox');
    expect(propertyType(['a'], 'text', undefined)).toBe('list');
    expect(propertyType('[[Home]]', 'text', undefined)).toBe('link');
  });

  it('a text value takes what the vault says about the name (a date, a choice), but not a type that needs another kind of value', () => {
    expect(propertyType('2026-10-06', 'date', undefined)).toBe('date');
    expect(propertyType('open', 'select', undefined)).toBe('select');
    expect(propertyType('open', 'checkbox', undefined)).toBe('text');
    expect(propertyType('open', 'list', undefined)).toBe('text');
  });

  it('with no value, the type that was chosen, else the vault\'s, else text', () => {
    expect(propertyType(null, 'date', 'number')).toBe('number');
    expect(propertyType(undefined, 'date', undefined)).toBe('date');
    expect(propertyType('', undefined, undefined)).toBe('text');
  });

  it('what a new property starts as', () => {
    expect(initialValue('checkbox')).toBe(false);
    expect(initialValue('list')).toEqual([]);
    expect(initialValue('number')).toBeNull();
    expect(initialValue('link')).toBeNull();
  });
});
