// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import Editor from './EventRegistrationFormEditor';
import type { OrganizerRegistrationForm } from '@/lib/api/eventRegistration';
const mockConfirm = jest.fn();
jest.mock('@/components/ui/useConfirm', () => ({ useConfirm: () => ({ confirm: mockConfirm, confirmDialog: null }) }));
jest.mock('@/lib/hooks/useUnsavedChangesGuard', () => ({ useUnsavedChangesGuard: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/ui/Input', () => ({ __esModule: true, default: (props: object) => {
  const { TextInput } = require('react-native'); return <TextInput {...props} />;
} }));
jest.mock('./EventRegistrationQuestionEditor', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/NativeButton', () => ({ Button: ({ children, isDisabled, onPress }: any) => {
  const { Pressable, Text } = require('react-native'); return <Pressable accessibilityRole="button"
    accessibilityState={{ disabled: isDisabled }} disabled={isDisabled} onPress={onPress}><Text>{children}</Text></Pressable>;
} }));
const question = { id: 1, position: 1, stable_key: 'first', question_type: 'short_text' as const, prompt: 'First',
  purpose: 'Prepare', data_classification: 'internal' as const, is_required: false, retention_days: 30 };
const form: OrganizerRegistrationForm = { id: 3, event_id: 42, revision: 1, version_number: 1, status: 'draft',
  name: 'Form', description: null, questions: [question, { ...question, id: 2, position: 2, stable_key: 'second' }] };
beforeEach(() => jest.clearAllMocks());
it('preserves edits and reports a failed save', async () => {
  const save = jest.fn().mockRejectedValue(new Error('Lost'));
  const view = render(<Editor form={form} blocked={false} onSave={save} />);
  fireEvent.changeText(view.getByLabelText('forms.editor.name'), 'Revised');
  fireEvent.press(view.getByText('common.save'));
  await waitFor(() => expect(view.getByText('messages.form_save_error')).toBeTruthy());
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Revised' }));
  expect(view.getByLabelText('forms.editor.name').props.value).toBe('Revised');
});
it('does not save invalid new forms', () => {
  const save = jest.fn(); const view = render(<Editor form={null} blocked={false} onSave={save} />);
  fireEvent.press(view.getByText('common.save'));
  expect(save).not.toHaveBeenCalled(); expect(view.getByText('forms.editor.invalid')).toBeTruthy();
});
it.each(['published', 'blocked'] as const)('prevents mutation when %s', state => {
  const save = jest.fn(); const view = render(<Editor form={state === 'published' ? { ...form, status: 'published' } : form}
    blocked={state === 'blocked'} onSave={save} />);
  fireEvent.press(view.getByText('common.save')); expect(save).not.toHaveBeenCalled();
  expect(view.getByLabelText('forms.editor.name').props.editable).toBe(false);
});
it.each(['edit', 'blocked', 'unmount'] as const)('ignores retained removal confirmation after %s', async state => {
  const save = jest.fn().mockResolvedValue(undefined);
  const view = render(<Editor form={form} blocked={false} onSave={save} />);
  fireEvent.press(view.getAllByText('forms.editor.remove')[0]);
  const confirm = mockConfirm.mock.calls[0][0].onConfirm;
  if (state === 'edit') fireEvent.changeText(view.getByLabelText('forms.editor.name'), 'New');
  if (state === 'blocked') view.rerender(<Editor form={form} blocked onSave={save} />);
  if (state === 'unmount') view.unmount();
  await act(async () => confirm());
  if (state !== 'unmount') expect(view.getAllByText('forms.editor.remove')).toHaveLength(2);
});
it('requires confirmation to save a recovered edit as a new version of a published form', async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  const recovered = { name: 'Recovered', description: '', questions: form.questions.map(({ id: _id, position: _position, ...question }) => ({ ...question, choice_options: null })) };
  const view = render(<Editor form={{ ...form, status: 'published' }} blocked={false} recovered={recovered} createRevision onSave={save} />);
  fireEvent.press(view.getByText('forms.create_revision'));
  expect(save).not.toHaveBeenCalled();
  await act(async () => mockConfirm.mock.calls[0][0].onConfirm());
  expect(save).toHaveBeenCalledWith(recovered);
});
