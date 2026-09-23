// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import Editor from './EventAgendaEditor';
import Comparison from './EventAgendaComparison';
import { agendaDraft, agendaPayload } from '@/lib/eventAgendaDraft';
import { Button } from '@/components/ui/NativeButton';
const mockConfirm = jest.fn();
jest.mock('@/components/ui/useConfirm', () => ({ useConfirm: () => ({ confirm: mockConfirm, confirmDialog: null }) }));
jest.mock('@/lib/hooks/useUnsavedChangesGuard', () => ({ useUnsavedChangesGuard: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/ui/Input', () => ({ __esModule: true, default: (props: object) => { const { TextInput } = require('react-native'); return <TextInput {...props} />; } }));
jest.mock('@/components/ui/ChoiceChips', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/NativeButton', () => ({ Button: ({ children, isDisabled, onPress }: any) => {
  const { Pressable, Text } = require('react-native'); return <Pressable accessibilityRole="button" accessibilityState={{ disabled: isDisabled }} disabled={isDisabled} onPress={onPress}><Text>{children}</Text></Pressable>;
} }));
const event = require('../../../contracts/events/v2/event-detail.json');
const session = { ...require('../../../contracts/events/v2/event-agenda.json').sessions[0],
  start_at: event.schedule.start_at, end_at: event.schedule.end_at, timezone: event.schedule.timezone };
function props() { return { event, session, blocked: false, onSave: jest.fn().mockResolvedValue(undefined), onClose: jest.fn() }; }
beforeEach(() => jest.clearAllMocks());
it('shows comparison only for a recovered edit and updates it as the organiser corrects input', () => {
  const p = props();
  const initial = render(<Editor {...p} />);
  expect(initial.UNSAFE_queryByType(Comparison)).toBeNull();
  initial.unmount();
  const recoveredInput = { ...agendaPayload(agendaDraft(event, session), event, session)!, title: 'Saved title' };
  const v = render(<Editor {...p} recoveredInput={recoveredInput} />);
  expect(v.UNSAFE_getByType(Comparison).props.draft.title).toBe('Saved title');
  fireEvent.changeText(v.getByLabelText('manage.agenda.title_label'), 'Corrected title');
  expect(v.UNSAFE_getByType(Comparison).props.draft.title).toBe('Corrected title');
  expect(p.onSave).not.toHaveBeenCalled();
});
it('retains input after failed save and preserves linked member speakers', async () => {
  const p = props(); p.onSave.mockRejectedValue(new Error('Lost')); const v = render(<Editor {...p} />);
  fireEvent.changeText(v.getByLabelText('manage.agenda.title_label'), 'Repaired workshop');
  fireEvent.press(v.getByText('manage.agenda.save_changes'));
  await waitFor(() => expect(p.onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Repaired workshop', speakers: [{ user_id: 7, role_label: 'Facilitator' }] })));
  expect(v.getByLabelText('manage.agenda.title_label').props.value).toBe('Repaired workshop');
  expect(p.onClose).not.toHaveBeenCalled();
});
it('validates before dispatch and permits adding/removing resource input', () => {
  const p = props(); const v = render(<Editor {...p} />);
  fireEvent.press(v.getByText('manage.agenda.resources.add_resource'));
  expect(v.getAllByLabelText('manage.agenda.resources.resource_url')).toHaveLength(3);
  fireEvent.press(v.getByText('manage.agenda.save_changes'));
  expect(p.onSave).not.toHaveBeenCalled(); expect(v.getByText('manage.agenda.invalid_fields')).toBeTruthy();
  fireEvent.press(v.getAllByText('manage.agenda.resources.remove_resource')[2]);
  expect(v.getAllByLabelText('manage.agenda.resources.resource_url')).toHaveLength(2);
});
it('does not double-submit while a save is pending', async () => {
  const p = props(); let done!: () => void; p.onSave.mockImplementation(() => new Promise<void>(resolve => { done = resolve; }));
  const v = render(<Editor {...p} />);
  const button = v.UNSAFE_getAllByType(Button).find(b => b.props.children === 'manage.agenda.save_changes')!;
  act(() => { button.props.onPress(); button.props.onPress(); });
  expect(p.onSave).toHaveBeenCalledTimes(1);
  await act(async () => done());
});
it('disables edits and sends when permission is lost', () => {
  const p = props(); const v = render(<Editor {...p} blocked />);
  expect(v.getByLabelText('manage.agenda.title_label').props.editable).toBe(false);
  fireEvent.press(v.getByText('manage.agenda.save_changes')); expect(p.onSave).not.toHaveBeenCalled();
});
it('requires explicit discard and ignores a stale close confirmation after further edits', () => {
  const p = props(); const v = render(<Editor {...p} />);
  fireEvent.changeText(v.getByLabelText('manage.agenda.title_label'), 'First');
  fireEvent.press(v.getByText('manage.agenda.close_editor'));
  expect(p.onClose).not.toHaveBeenCalled();
  fireEvent.changeText(v.getByLabelText('manage.agenda.title_label'), 'Second');
  act(() => mockConfirm.mock.calls[0][0].onConfirm()); expect(p.onClose).not.toHaveBeenCalled();
  fireEvent.press(v.getByText('manage.agenda.close_editor'));
  act(() => mockConfirm.mock.calls[1][0].onConfirm()); expect(p.onClose).toHaveBeenCalledTimes(1);
});
