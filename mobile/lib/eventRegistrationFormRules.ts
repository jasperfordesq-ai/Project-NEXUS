// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/** Client checks mirror Laravel EventRegistrationFormRuleSet; never execute authored rules. */
const textTypes = ['short_text', 'long_text', 'dietary', 'accessibility'];
const choiceTypes = ['single_choice', 'multiple_choice'];
export const registrationConditionOperators = ['equals', 'not_equals', 'contains', 'not_contains', 'in', 'not_in', 'is_answered', 'is_not_answered'] as const;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
export function validRegistrationValidationRules(type: string, rules: Record<string, unknown> | null | undefined): boolean {
  if (rules == null) return true;
  const text = textTypes.includes(type);
  const choice = choiceTypes.includes(type);
  const allowed = text ? ['min_length', 'max_length', 'format'] : choice ? ['min_selections', 'max_selections'] : [];
  if (Object.keys(rules).some(key => !allowed.includes(key))) return false;
  const [minimum, maximum] = text ? ['min_length', 'max_length'] : ['min_selections', 'max_selections'];
  const limit = text ? (type === 'short_text' ? 500 : 10000) : type === 'single_choice' ? 1 : 100;
  for (const key of [minimum, maximum]) if (key in rules && !integer(rules[key], limit)) return false;
  if (minimum in rules && maximum in rules && Number(rules[minimum]) > Number(rules[maximum])) return false;
  return !('format' in rules) || ['email', 'phone', 'url'].includes(String(rules.format));
}
function validConditionValue(value: unknown): boolean {
  const scalar = (item: unknown) => typeof item === 'string' || typeof item === 'boolean'
    || (typeof item === 'number' && Number.isFinite(item));
  if (Array.isArray(value)) return value.length <= 100 && value.every(scalar);
  return scalar(value) && (typeof value !== 'string' || [...value].length <= 1000);
}
export function validRegistrationVisibilityRules(rules: Record<string, unknown> | null | undefined, earlierKeys: readonly string[]): boolean {
  if (rules == null) return true;
  if (Object.keys(rules).some(key => !['match', 'conditions'].includes(key)) || !['all', 'any'].includes(String(rules.match))
    || !Array.isArray(rules.conditions) || rules.conditions.length < 1 || rules.conditions.length > 20) return false;
  return rules.conditions.every(condition => {
    if (!object(condition) || Object.keys(condition).some(key => !['question_key', 'operator', 'value'].includes(key))
      || typeof condition.question_key !== 'string' || !earlierKeys.includes(condition.question_key)
      || !registrationConditionOperators.some(operator => operator === condition.operator)) return false;
    const needsValue = condition.operator !== 'is_answered' && condition.operator !== 'is_not_answered';
    return needsValue === Object.hasOwn(condition, 'value') && (!needsValue || validConditionValue(condition.value));
  });
}
