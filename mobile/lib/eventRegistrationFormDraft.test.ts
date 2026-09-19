// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { newRegistrationQuestion, registrationFormDraft, registrationFormPayload,
  moveRegistrationQuestion, removeRegistrationQuestion } from './eventRegistrationFormDraft';
const question = { ...newRegistrationQuestion([]), prompt: 'Support needed?', purpose: 'Prepare adjustments',
  question_type: 'accessibility' as const, data_classification: 'sensitive' as const };
const draft = () => ({ name: 'Registration', description: '', questions: [{ ...question }] });
it('round trips authored rules while removing server identities', () => {
  const source = { name: 'Registration', description: null, questions: [{
    ...question, id: 9, position: 1, retention_days: 30, choice_options: null,
    validation_rules: { max_length: 500 }, visibility_rules: { match: 'any', conditions: [{ question_key: 'earlier', operator: 'is_answered' }] },
  }] };
  const authored = source.questions[0];
  const withEarlier = { ...source, questions: [
    { ...authored, id: 8, position: 1, stable_key: 'earlier', visibility_rules: null }, ...source.questions,
  ] };
  const payload = registrationFormPayload(registrationFormDraft(withEarlier));
  expect(payload?.questions[1]).toMatchObject({ validation_rules: authored.validation_rules,
    visibility_rules: authored.visibility_rules, retention_days: 30 });
  expect(payload?.questions[0]).not.toHaveProperty('id');
  expect(payload?.questions[0]).not.toHaveProperty('position');
});
it.each(['', '-1', '1.5', '30days', '36501'])('rejects invalid retention %s without silently coercing it', retention => {
  const value = draft(); value.questions[0].retention_days = retention;
  expect(registrationFormPayload(value)).toBeNull();
});
it('does not weaken privacy classification for support questions', () => {
  expect(registrationFormPayload({ ...draft(), questions: [{ ...question, data_classification: 'public' }] })).toBeNull();
});
it('rejects empty and duplicate choices, and requires consent evidence', () => {
  for (const options of [['One'], ['One', 'One'], ['One', '']]) {
    expect(registrationFormPayload({ ...draft(), questions: [{ ...question, question_type: 'single_choice', choice_options: options }] })).toBeNull();
  }
  expect(registrationFormPayload({ ...draft(), questions: [{ ...question, question_type: 'consent' }] })).toBeNull();
});
it('preserves line breaks inside a choice rather than splitting the choice into separate answers', () => {
  const choices = ['First line\nSecond line', 'Another option'];
  const source = { name: 'Form', description: null, questions: [{ ...question,
    question_type: 'single_choice' as const, retention_days: 30, choice_options: choices }] };
  const converted = registrationFormDraft(source);
  expect(converted.questions[0].choice_options).not.toBe(choices);
  expect(registrationFormPayload(converted)?.questions[0].choice_options).toEqual(choices);
  expect(choices).toEqual(['First line\nSecond line', 'Another option']);
});
it('creates a noncolliding stable key after a question was removed', () => {
  expect(newRegistrationQuestion([{ ...question, stable_key: 'question_2' }]).stable_key).toBe('question_3');
});
it('blocks moves and removal which would orphan any condition, without changing the draft', () => {
  const first = { ...question, stable_key: 'first' };
  const second = { ...question, stable_key: 'second' };
  const third = { ...question, stable_key: 'third', visibility_rules: { match: 'any', conditions: [
    { question_key: 'first', operator: 'is_answered' }, { question_key: 'second', operator: 'is_answered' },
  ] } };
  const value = { ...draft(), questions: [first, second, third] };
  expect(moveRegistrationQuestion(value, 2, 0)).toBeNull();
  expect(moveRegistrationQuestion(value, 1, 2)).toBeNull();
  expect(removeRegistrationQuestion(value, 1)).toBeNull();
  expect(moveRegistrationQuestion(value, 0, 1)?.questions).toEqual([second, first, third]);
  expect(removeRegistrationQuestion(value, 2)?.questions).toEqual([first, second]);
  expect(value.questions).toEqual([first, second, third]);
});
