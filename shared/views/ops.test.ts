import { describe, it, expect } from 'vitest';
import { opsFor, takesValue, newFilter, retarget, operandFrom } from './ops';
import { FILTER_OPS } from './model';
import type { FieldType } from './schema';

const TYPES: FieldType[] = ['text', 'number', 'date', 'select', 'checkbox', 'list'];

describe('opsFor', () => {
  it('offers every type only tests that can be answered for it, with no repeats', () => {
    expect(opsFor('number')).toContain('gt');
    expect(opsFor('text')).not.toContain('gt');
    expect(opsFor('date')).toEqual(expect.arrayContaining(['before', 'after']));
    expect(opsFor('list')).toContain('has');
    expect(opsFor('checkbox')).toEqual(['is-true', 'is-false']);
    for (const type of TYPES) {
      expect(new Set(opsFor(type)).size).toBe(opsFor(type).length);
      for (const op of opsFor(type)) expect(FILTER_OPS).toContain(op);
    }
  });

  it('every test in the model is offered for some type', () => {
    const offered = new Set(TYPES.flatMap(t => [...opsFor(t)]));
    for (const op of FILTER_OPS) expect(offered.has(op)).toBe(true);
  });
});

describe('filters in the builder', () => {
  it('a new filter starts with the first test and no value', () => {
    expect(newFilter('votes', 'number')).toEqual({ field: 'votes', op: 'equals' });
    expect(newFilter('done', 'checkbox')).toEqual({ field: 'done', op: 'is-true' });
  });

  it('takesValue: only the tests that compare against something', () => {
    expect(takesValue('equals')).toBe(true);
    expect(takesValue('before')).toBe(true);
    for (const op of ['is-empty', 'not-empty', 'is-true', 'is-false'] as const) expect(takesValue(op)).toBe(false);
  });

  it('changing the field keeps the test when the new type offers it, and drops the value either way', () => {
    expect(retarget({ field: 'a', op: 'not-equals', value: 'x' }, 'b', 'select')).toEqual({ field: 'b', op: 'not-equals' });
    expect(retarget({ field: 'a', op: 'gt', value: 3 }, 'b', 'text')).toEqual({ field: 'b', op: 'contains' });
  });

  it('operandFrom: numbers for a number field, text otherwise, nothing for nothing', () => {
    expect(operandFrom('number', '12')).toBe(12);
    expect(operandFrom('number', '1e2x')).toBe('1e2x');
    expect(operandFrom('text', '12')).toBe('12');
    expect(operandFrom('date', '2026-10-06')).toBe('2026-10-06');
    expect(operandFrom('text', '   ')).toBeUndefined();
  });
});
