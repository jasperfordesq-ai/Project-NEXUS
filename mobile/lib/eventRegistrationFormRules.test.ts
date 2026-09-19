// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { validRegistrationValidationRules as validation, validRegistrationVisibilityRules as visibility,
  registrationConditionOperators } from './eventRegistrationFormRules';
it.each([
  ['short_text', { max_length: 501 }], ['short_text', { min_length: 10, max_length: 9 }],
  ['long_text', { max_length: 10001 }], ['single_choice', { max_selections: 2 }],
  ['multiple_choice', { min_selections: -1 }], ['consent', { min_length: 1 }],
  ['short_text', { format: 'script' }], ['short_text', { max_length: '500' }],
  ['short_text', { pattern: '.*' }], ['multiple_choice', { max_selections: Infinity }],
])('rejects invalid validation rules %s %j', (type, rules) => expect(validation(type as string, rules as Record<string, unknown>)).toBe(false));
it('accepts supported boundaries and formats without changing them', () => {
  const rules = { min_length: 0, max_length: 500, format: 'email' };
  expect(validation('short_text', rules)).toBe(true);
  expect(validation('multiple_choice', { min_selections: 0, max_selections: 100 })).toBe(true);
  expect(validation('consent', null)).toBe(true);
  expect(rules).toEqual({ min_length: 0, max_length: 500, format: 'email' });
});
it.each(registrationConditionOperators)('preserves supported condition operator %s', operator => {
  const condition = { question_key: 'earlier', operator, ...(['is_answered', 'is_not_answered'].includes(operator) ? {} : { value: false }) };
  expect(visibility({ match: 'any', conditions: [condition] }, ['earlier'])).toBe(true);
});
it.each([
  { match: 'all', conditions: [{ question_key: 'later', operator: 'is_answered' }] },
  { match: 'any', conditions: [{ question_key: 'earlier', operator: 'is_answered', value: true }] },
  { match: 'all', conditions: [{ question_key: 'earlier', operator: 'equals' }] },
  { match: 'all', conditions: [{ question_key: 'earlier', operator: 'equals', value: { nested: true } }] },
  { match: 'all', conditions: [{ question_key: 'earlier', operator: 'equals', value: [['nested']] }] },
  { match: 'all', conditions: [{ question_key: 'earlier', operator: 'equals', value: 'x'.repeat(1001) }] },
  { match: 'all', conditions: [] },
  { match: 'all', conditions: Array(21).fill({ question_key: 'earlier', operator: 'is_answered' }) },
])('rejects invalid visibility rules %j', rules => expect(visibility(rules, ['earlier'])).toBe(false));
it('retains typed condition values and all conditions', () => {
  const rules = { match: 'all', conditions: [
    { question_key: 'earlier', operator: 'in', value: [1, true, 'text'] },
    { question_key: 'other', operator: 'equals', value: false },
  ] };
  expect(visibility(rules, ['earlier', 'other'])).toBe(true);
  expect(rules.conditions[0].value).toEqual([1, true, 'text']);
  expect(rules.conditions[1].value).toBe(false);
});
