// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { act, render } from '@testing-library/react-native';
import ChoiceChips from '@/components/ui/ChoiceChips';
import Editor from './EventRegistrationQuestionEditor';
import { newRegistrationQuestion, registrationFormPayload, type RegistrationQuestionDraft } from '@/lib/eventRegistrationFormDraft';
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/ui/ChoiceChips', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/Input', () => ({ __esModule: true, default: () => null }));
jest.mock('./EventRegistrationValidationEditor', () => ({ __esModule: true, default: () => null }));
jest.mock('./EventRegistrationVisibilityEditor', () => ({ __esModule: true, default: () => null }));
const question: RegistrationQuestionDraft = { ...newRegistrationQuestion([]), prompt: 'Activity', purpose: 'Prepare',
  validation_rules: { min_length: 2, max_length: 100, format: 'email' },
  visibility_rules: { match: 'all', conditions: [{ question_key: 'earlier', operator: 'is_answered' }] } };
function changeType(current: RegistrationQuestionDraft, next: string, disabled = false) {
  const changed = jest.fn();
  const view = render(<Editor question={current} number={1} disabled={disabled} onChange={changed} />);
  act(() => view.UNSAFE_getAllByType(ChoiceChips)[0].props.onSelect(next));
  return changed;
}
it('preserves text limits, formatting and visibility when changing to long text', () => {
  expect(changeType(question, 'long_text')).toHaveBeenCalledWith({ ...question, question_type: 'long_text' });
});
it('retains stricter incompatible limits for correction rather than silently removing them', () => {
  const original = { ...question, visibility_rules: null, question_type: 'long_text' as const, validation_rules: { max_length: 1000 } };
  expect(registrationFormPayload({ name: 'Form', description: '', questions: [original] })).not.toBeNull();
  const updated = changeType(original, 'short_text').mock.calls[0][0];
  expect(updated.validation_rules).toEqual({ max_length: 1000 });
  expect(registrationFormPayload({ name: 'Form', description: '', questions: [updated] })).toBeNull();
});
it('preserves authored choices and selection limits within choice types', () => {
  const original = { ...question, question_type: 'single_choice' as const, choice_options: ['One', 'Two'],
    validation_rules: { min_selections: 1, max_selections: 1 } };
  expect(changeType(original, 'multiple_choice')).toHaveBeenCalledWith({ ...original, question_type: 'multiple_choice' });
});
it('clears text rules when explicitly switching to a choice field, retaining visibility', () => {
  expect(changeType(question, 'single_choice')).toHaveBeenCalledWith({ ...question,
    question_type: 'single_choice', choice_options: ['', ''], validation_rules: null });
});
it('preserves consent evidence when switching between consent and waiver', () => {
  const original = { ...question, question_type: 'consent' as const, validation_rules: null,
    displayed_text: 'Consent statement', displayed_text_version: '1' };
  expect(changeType(original, 'waiver')).toHaveBeenCalledWith({ ...original, question_type: 'waiver' });
});
it('ignores retained type selection callbacks while disabled', () => {
  expect(changeType(question, 'long_text', true)).not.toHaveBeenCalled();
});
