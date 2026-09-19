// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import Editor from './EventRegistrationVisibilityEditor';
import Value from './EventRegistrationConditionValue';
import ChoiceChips from '@/components/ui/ChoiceChips';
import { newRegistrationQuestion } from '@/lib/eventRegistrationFormDraft';
import { validRegistrationVisibilityRules } from '@/lib/eventRegistrationFormRules';
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/ui/Input', () => ({ __esModule: true, default: (props: object) => {
  const { TextInput } = require('react-native'); return <TextInput {...props} />;
} }));
jest.mock('@/components/ui/ChoiceChips', () => ({ __esModule: true, default: () => null }));
const earlier = [{ ...newRegistrationQuestion([]), stable_key: 'first', prompt: 'First' }];
const condition = { question_key: 'first', operator: 'equals', value: false };
const question = { ...newRegistrationQuestion(earlier), visibility_rules: { match: 'any', conditions: [condition,
  { question_key: 'first', operator: 'in', value: [1, true, 'text'] }] } };
it('updates one operator without replacing other conditions or their typed values', () => {
  const change = jest.fn(); const view = render(<Editor question={question} earlier={earlier} disabled={false} onChange={change} />);
  const controls = view.UNSAFE_getAllByType(ChoiceChips);
  controls.find(control => control.props.label === 'forms.editor.condition_operator')!.props.onSelect('is_answered');
  expect(change.mock.calls[0][0].visibility_rules).toEqual({ match: 'any', conditions: [
    { question_key: 'first', operator: 'is_answered' }, question.visibility_rules.conditions[1],
  ] });
  expect(question.visibility_rules.conditions[0].value).toBe(false);
});
it('changes all/any matching without reducing the condition list', () => {
  const change = jest.fn(); const view = render(<Editor question={question} earlier={earlier} disabled={false} onChange={change} />);
  view.UNSAFE_getAllByType(ChoiceChips).find(control => control.props.label === 'forms.editor.condition_match')!.props.onSelect('all');
  expect(change.mock.calls[0][0].visibility_rules).toEqual({ ...question.visibility_rules, match: 'all' });
});
it('blocks all mutation callbacks when disabled', () => {
  const change = jest.fn(); const view = render(<Editor question={question} earlier={earlier} disabled onChange={change} />);
  view.UNSAFE_getAllByType(ChoiceChips)[0].props.onSelect('no');
  fireEvent.press(view.getByText('forms.editor.add_condition'));
  expect(change).not.toHaveBeenCalled();
});
it.each(['-', '1.', ''])('keeps unfinished number %j invalid instead of turning it into text', text => {
  const change = jest.fn(); const view = render(<Value value={1} disabled={false} onChange={change} />);
  fireEvent.changeText(view.getByLabelText('forms.editor.condition_value'), text);
  const value = change.mock.calls[0][0];
  expect(value).toEqual({ invalidNumber: text });
  expect(validRegistrationVisibilityRules({ match: 'all', conditions: [{ ...condition, value }] }, ['first'])).toBe(false);
  view.rerender(<Value value={value} disabled={false} onChange={change} />);
  expect(view.getByLabelText('forms.editor.condition_value').props.value).toBe(text);
  fireEvent.changeText(view.getByLabelText('forms.editor.condition_value'), '-1.5');
  expect(change.mock.calls.at(-1)?.[0]).toBe(-1.5);
});
it('edits a list item without coercing its siblings', () => {
  const change = jest.fn(); const view = render(<Value value={[1, true, 'text']} disabled={false} onChange={change} />);
  const fields = view.getAllByLabelText('forms.editor.condition_value');
  fireEvent.changeText(fields[0], '2');
  expect(change).toHaveBeenCalledWith([2, true, 'text']);
});
