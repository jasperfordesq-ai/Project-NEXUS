// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import Comparison from './EventRegistrationFormComparison';
import Question from './EventRegistrationQuestionEditor';
import { newRegistrationQuestion, type RegistrationFormDraft } from '@/lib/eventRegistrationFormDraft';
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { value?: string; number?: number }) =>
  options?.value ? `${key}: ${options.value}` : options?.number ? `${key} ${options.number}` : key }) }));
jest.mock('./EventRegistrationQuestionEditor', () => ({ __esModule: true, default: () => null }));
const first = { ...newRegistrationQuestion([]), stable_key: 'first', prompt: 'First' };
const second = { ...first, stable_key: 'second', prompt: 'Second', visibility_rules: { match: 'all', conditions: [
  { question_key: 'first', operator: 'equals', value: false },
] } };
const current: RegistrationFormDraft = { name: 'Original', description: '', questions: [first, second] };
it('shows unchanged state without duplicating all question controls', () => {
  const view = render(<Comparison current={current} proposed={current} />);
  expect(view.getByText('events:registrationSettings.no_differences')).toBeTruthy();
  expect(view.UNSAFE_queryByType(Question)).toBeNull();
});
it('exposes complete current and proposed rules for a changed question', () => {
  const changed = { ...second, visibility_rules: { match: 'any', conditions: [
    { question_key: 'first', operator: 'equals', value: 'false' },
  ] } };
  const view = render(<Comparison current={current} proposed={{ ...current, questions: [first, changed] }} />);
  expect(view.UNSAFE_queryByType(Question)).toBeNull();
  fireEvent.press(view.getByText('Second'));
  const versions = view.UNSAFE_getAllByType(Question);
  expect(versions).toHaveLength(2);
  expect(versions[0].props).toMatchObject({ question: second, disabled: true, earlier: [first] });
  expect(versions[1].props).toMatchObject({ question: changed, disabled: true, earlier: [first] });
});
it('shows additions and removals without matching questions by their position', () => {
  const third = { ...first, stable_key: 'third', prompt: 'Third' };
  const view = render(<Comparison current={current} proposed={{ ...current, questions: [second, third] }} />);
  expect(view.getByText('First')).toBeTruthy(); expect(view.getByText('Third')).toBeTruthy();
  fireEvent.press(view.getByText('Third'));
  expect(view.UNSAFE_getByType(Question).props.question).toEqual(third);
  expect(view.getByText('forms.editor.current: forms.editor.absent')).toBeTruthy();
});
it('updates comparison as the proposed draft changes', () => {
  const view = render(<Comparison current={current} proposed={{ ...current, name: 'Changed' }} />);
  expect(view.getByText('events:registrationSettings.proposed_value: Changed')).toBeTruthy();
  view.rerender(<Comparison current={current} proposed={current} />);
  expect(view.queryByText('events:registrationSettings.proposed_value: Changed')).toBeNull();
  expect(view.getByText('events:registrationSettings.no_differences')).toBeTruthy();
});
