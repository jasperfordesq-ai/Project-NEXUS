// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import Editor from './EventRegistrationValidationEditor';
import ChoiceChips from '@/components/ui/ChoiceChips';
import { newRegistrationQuestion } from '@/lib/eventRegistrationFormDraft';
import { validRegistrationValidationRules } from '@/lib/eventRegistrationFormRules';
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/ui/Input', () => ({ __esModule: true, default: (props: object) => {
  const { TextInput } = require('react-native'); return <TextInput {...props} />;
} }));
jest.mock('@/components/ui/ChoiceChips', () => ({ __esModule: true, default: () => null }));
it('changes one limit while preserving the remaining rules and conditions', () => {
  const question = { ...newRegistrationQuestion([]), validation_rules: { min_length: 2, format: 'email' },
    visibility_rules: { match: 'all', conditions: [{ question_key: 'earlier', operator: 'is_answered' }] } };
  const change = jest.fn(); const view = render(<Editor question={question} disabled={false} onChange={change} />);
  fireEvent.changeText(view.getByLabelText('forms.editor.max_length'), '500');
  expect(change).toHaveBeenCalledWith({ ...question, validation_rules: { min_length: 2, max_length: 500, format: 'email' } });
});
it('retains invalid numeric text so validation can block rather than coerce it', () => {
  const change = jest.fn(); const view = render(<Editor question={newRegistrationQuestion([])} disabled={false} onChange={change} />);
  fireEvent.changeText(view.getByLabelText('forms.editor.max_length'), '3.5');
  const next = change.mock.calls[0][0];
  expect(next.validation_rules.max_length).toBe('3.5');
  expect(validRegistrationValidationRules(next.question_type, next.validation_rules)).toBe(false);
});
it('removes only the cleared limit', () => {
  const question = { ...newRegistrationQuestion([]), validation_rules: { min_length: 2, max_length: 50 } };
  const change = jest.fn(); const view = render(<Editor question={question} disabled={false} onChange={change} />);
  fireEvent.changeText(view.getByLabelText('forms.editor.min_length'), '');
  expect(change.mock.calls[0][0].validation_rules).toEqual({ max_length: 50 });
});
it('uses choice-count controls for choice questions', () => {
  const change = jest.fn(); const view = render(<Editor question={{ ...newRegistrationQuestion([]), question_type: 'multiple_choice' }} disabled={false} onChange={change} />);
  expect(view.queryByLabelText('forms.editor.max_length')).toBeNull();
  fireEvent.changeText(view.getByLabelText('forms.editor.max_selections'), '4');
  expect(change.mock.calls[0][0].validation_rules).toEqual({ max_selections: 4 });
});
it('blocks both numeric and format callbacks while disabled', () => {
  const change = jest.fn(); const view = render(<Editor question={newRegistrationQuestion([])} disabled onChange={change} />);
  fireEvent.changeText(view.getByLabelText('forms.editor.max_length'), '20');
  view.UNSAFE_getByType(ChoiceChips).props.onSelect('email');
  expect(change).not.toHaveBeenCalled();
});
