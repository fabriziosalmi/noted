/**
 * Which tests make sense for which kind of field, so the filter builder only offers questions that can be answered:
 * "greater than" for a number, "before" for a date, "has" for a list. Pure.
 */
import type { FieldType } from './schema';
import type { FilterOp, ViewFilter } from './model';

const EMPTY: FilterOp[] = ['is-empty', 'not-empty'];

const BY_TYPE: Record<FieldType, FilterOp[]> = {
  text: ['contains', 'not-contains', 'equals', 'not-equals', ...EMPTY],
  number: ['equals', 'not-equals', 'gt', 'gte', 'lt', 'lte', ...EMPTY],
  date: ['equals', 'before', 'after', ...EMPTY],
  select: ['equals', 'not-equals', ...EMPTY],
  checkbox: ['is-true', 'is-false'],
  list: ['has', 'not-has', 'contains', ...EMPTY],
};

/** The tests offered for a field of this type, the most common first. */
export function opsFor(type: FieldType): readonly FilterOp[] {
  return BY_TYPE[type];
}

/** Does this test take a value (`status` is ___) or stand alone (`status` is empty)? */
export function takesValue(op: FilterOp): boolean {
  return !['is-empty', 'not-empty', 'is-true', 'is-false'].includes(op);
}

/** A new, unfinished filter for a field: its first test, no value yet (an unfinished filter lets every note through). */
export function newFilter(field: string, type: FieldType): ViewFilter {
  return { field, op: BY_TYPE[type][0] };
}

/** The same filter on another field: keeps the test when the new type offers it, else starts over; the value goes. */
export function retarget(filter: ViewFilter, field: string, type: FieldType): ViewFilter {
  return BY_TYPE[type].includes(filter.op) ? { field, op: filter.op } : newFilter(field, type);
}

/** The value as the filter stores it: a number for a number field (when it reads as one), else the text; nothing when empty. */
export function operandFrom(type: FieldType, text: string): ViewFilter['value'] {
  if (text.trim() === '') return undefined;
  if (type === 'number' && Number.isFinite(Number(text))) return Number(text);
  return text;
}
