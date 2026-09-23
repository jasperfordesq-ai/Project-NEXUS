// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, ScrollView } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import i18n from 'i18next';
import communications from '@/locales/en/event_communications.json';
let mockParams: { id?: string | string[] } = { id: '7' };
let mockUserId = 3;
let mockFocused = true;
const mockConfirm = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/useConfirm', () => ({ useConfirm: () => ({ confirm: mockConfirm, confirmDialog: null }) }));
jest.mock('@/lib/hooks/useUnsavedChangesGuard', () => ({ useUnsavedChangesGuard: jest.fn() }));
jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#06f', useTenant: () => ({ tenant: { id: 2 } }) }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('@/lib/api/events', () => ({ getEvent: jest.fn() }));
jest.mock('@/lib/api/eventStaff', () => ({ ...jest.requireActual('@/lib/api/eventStaff'), getEventStaff: jest.fn() }));
jest.mock('@/lib/api/eventPeople', () => ({ searchEventInviteMembers: jest.fn() }));
jest.mock('@/lib/eventStaffOperation', () => ({ loadStaffOperation: jest.fn(), executeStaffOperation: jest.fn(), recoverStaffOperation: jest.fn(), discardRejectedStaffOperation: jest.fn() }));
import Screen from './event-team';
import { getEvent } from '@/lib/api/events';
import { getEventStaff } from '@/lib/api/eventStaff';
import { searchEventInviteMembers as search } from '@/lib/api/eventPeople';
import { loadStaffOperation as load, executeStaffOperation as execute, recoverStaffOperation as recover, discardRejectedStaffOperation as discard } from '@/lib/eventStaffOperation';
import { ApiResponseError } from '@/lib/api/client';
const event = { id: 7, organizer: { id: 3 }, permissions: { manage_staff: true, transfer_ownership: false } };
const assignment = { id: 8, event_id: 7, member: { id: 9, name: 'Team member' }, role: 'check_in_staff', capabilities: ['manageAttendance'], status: 'active', effective: true, version: 1, granted_at: null, expires_at: null,
  history: [{ id: 10, version: 1, action: 'granted', actor_user_id: 3, created_at: '2026-09-23T12:00:00Z', immutable: true }] };
const pending = { tenantId: 2, userId: 3, eventId: 7, schemaVersion: 1, status: 'pending', key: 'saved', intent: { action: 'revoke', assignmentId: 8 }, attempts: 1 };
beforeEach(() => {
  i18n.addResourceBundle('en', 'event_communications', communications, true, true);
  jest.clearAllMocks(); mockParams = { id: '7' }; mockUserId = 3; mockFocused = true;
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  jest.mocked(getEvent).mockReset().mockResolvedValue({ data: event } as never);
  jest.mocked(getEventStaff).mockReset().mockResolvedValue({ data: [assignment] } as never);
  jest.mocked(search).mockReset().mockResolvedValue([{ id: 3, name: 'Owner' }, { id: 10, name: 'New member' }] as never);
  jest.mocked(load).mockReset().mockResolvedValue(null);
  jest.mocked(execute).mockReset().mockResolvedValue({ data: { assignment } } as never);
  jest.mocked(recover).mockReset().mockResolvedValue({ data: { assignment } } as never);
});
async function ready() { const view = render(<Screen />); await view.findByText('Team member · Member #9'); await waitFor(() => expect(load).toHaveBeenCalled()); return view; }
async function select(view: ReturnType<typeof render>) {
  fireEvent.changeText(view.getByLabelText('Member'), 'New');
  fireEvent.press(await view.findByLabelText('Select New member · Member #10'));
}
it.each([undefined, '0', '1e2', ['7']])('rejects invalid links %j without requests', id => {
  mockParams = { id }; const view = render(<Screen />);
  expect(view.getByText('Invalid event ID.')).toBeTruthy(); expect(getEvent).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
});
it('shows capabilities and history with only subordinate roles for a delegated manager', async () => {
  const view = await ready(); expect(view.getAllByRole('radio')).toHaveLength(3);
  expect(view.getByRole('radio', { name: 'Registration manager' }).props.accessibilityState.checked).toBe(true);
  expect(view.getByText(/Role granted/)).toBeTruthy(); expect(view.getByText('This history is marked immutable by the server.')).toBeTruthy();
});
it('offers all five roles to the owner authority', async () => {
  jest.mocked(getEvent).mockResolvedValue({ data: { ...event, permissions: { manage_staff: true, transfer_ownership: true } } } as never);
  const view = await ready(); expect(view.getAllByRole('radio')).toHaveLength(5);
});
it('excludes the event owner and confirms the selected member before granting', async () => {
  const view = await ready(); await select(view); expect(view.queryByLabelText('Select Owner · Member #3')).toBeNull();
  fireEvent.press(view.getByText('Assign role')); expect(execute).not.toHaveBeenCalled();
  await act(async () => mockConfirm.mock.calls[0][0].onConfirm());
  expect(execute).toHaveBeenCalledWith({ eventId: 7, tenantId: 2, userId: 3 }, { action: 'grant', payload: { user_id: 10, role: 'registration_manager', expires_at: null } }, expect.any(Function));
  expect(view.getByLabelText('Member').props.value).toBe('');
});
it('requires confirmation for revocation and retains the assignment history', async () => {
  const view = await ready(); fireEvent.press(view.getByText('Revoke access')); expect(execute).not.toHaveBeenCalled();
  await act(async () => mockConfirm.mock.calls[0][0].onConfirm());
  expect(execute).toHaveBeenCalledWith(expect.anything(), { action: 'revoke', assignmentId: 8 }, expect.any(Function));
  expect(view.getByText('This history is marked immutable by the server.')).toBeTruthy();
});
it.each([401, 403, 404])('clears private assignments on refresh refusal %s', async status => {
  const view = await ready(); jest.mocked(getEventStaff).mockRejectedValue(new ApiResponseError(status, 'Unavailable'));
  await act(async () => view.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh());
  expect(view.queryByText('Team member · Member #9')).toBeNull(); expect(view.getByText('You may not have permission to manage the team for this event.')).toBeTruthy();
});
it('ignores an old confirmation after permission is withdrawn', async () => {
  const view = await ready(); fireEvent.press(view.getByText('Revoke access')); const confirmation = mockConfirm.mock.calls[0][0];
  jest.mocked(getEvent).mockResolvedValue({ data: { ...event, permissions: { manage_staff: false } } } as never);
  await act(async () => view.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh());
  await act(async () => confirmation.onConfirm()); expect(execute).not.toHaveBeenCalled();
});
it('does not replay a saved action on load; only explicit recovery sends it', async () => {
  jest.mocked(load).mockResolvedValue(pending as never); const view = await ready();
  const button = await view.findByText('Recover saved action'); expect(recover).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('Revoke access')); expect(mockConfirm).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(button)); expect(recover).toHaveBeenCalledTimes(1);
});
it('requires confirmation before discarding a definitively rejected local action', async () => {
  jest.mocked(load).mockResolvedValue({ ...pending, status: 'rejected', code: 'EVENT_STAFF_FORBIDDEN' } as never);
  const view = await ready(); fireEvent.press(await view.findByText('Discard saved change')); expect(discard).not.toHaveBeenCalled();
  await act(async () => mockConfirm.mock.calls[0][0].onConfirm()); expect(discard).toHaveBeenCalledWith(expect.anything(), 'saved', expect.any(Function));
});
it('explains an accepted change missing from the refreshed list and locks new mutations', async () => {
  jest.mocked(execute).mockResolvedValue({ data: { assignment: { ...assignment, version: 2 } } } as never);
  const view = await ready(); fireEvent.press(view.getByText('Revoke access'));
  await act(async () => mockConfirm.mock.calls[0][0].onConfirm());
  expect(await view.findByText('Refresh the event team')).toBeTruthy();
  mockConfirm.mockClear(); fireEvent.press(view.getByText('Revoke access')); expect(mockConfirm).not.toHaveBeenCalled();
  jest.mocked(getEventStaff).mockResolvedValue({ data: [{ ...assignment, version: 2 }] } as never);
  await act(async () => view.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh());
  expect(view.queryByText('Refresh the event team')).toBeNull();
});
it('rejects an expiry that has elapsed while the confirmation was open', async () => {
  const view = await ready(); await select(view); fireEvent.press(view.getByText('Access expires (optional)'));
  const future = new Date(Date.now() + 60000);
  act(() => view.UNSAFE_getByType(DateTimePicker).props.onChange({ type: 'set' }, future));
  fireEvent.press(view.getByText('Assign role')); const confirmation = mockConfirm.mock.calls[0][0];
  const clock = jest.spyOn(Date, 'now').mockReturnValue(future.getTime() + 1);
  await act(async () => confirmation.onConfirm()); clock.mockRestore();
  expect(execute).not.toHaveBeenCalled(); expect(view.getByText('Choose a valid future date and time.')).toBeTruthy();
});
it('does not silently add an expiry when the date picker is dismissed', async () => {
  const view = await ready(); await select(view); fireEvent.press(view.getByText('Access expires (optional)'));
  act(() => view.UNSAFE_getByType(DateTimePicker).props.onChange({ type: 'dismissed' }));
  fireEvent.press(view.getByText('Assign role')); await act(async () => mockConfirm.mock.calls[0][0].onConfirm());
  expect(execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ payload: expect.objectContaining({ expires_at: null }) }), expect.any(Function));
});
it('saves expiry at the server second precision before persisting request identity', async () => {
  const view = await ready(); await select(view); fireEvent.press(view.getByText('Access expires (optional)'));
  const future = new Date(Math.floor(Date.now() / 1000) * 1000 + 600123);
  act(() => view.UNSAFE_getByType(DateTimePicker).props.onChange({ type: 'set' }, future));
  fireEvent.press(view.getByText('Assign role')); await act(async () => mockConfirm.mock.calls[0][0].onConfirm());
  expect(execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ payload: expect.objectContaining({ expires_at: new Date(Math.floor(future.getTime() / 1000) * 1000).toISOString() }) }), expect.any(Function));
});
it('ignores an old confirmation after leaving the focused workspace', async () => {
  const view = await ready(); fireEvent.press(view.getByText('Revoke access')); const confirmation = mockConfirm.mock.calls[0][0];
  mockFocused = false; view.rerender(<Screen />); await act(async () => confirmation.onConfirm());
  expect(execute).not.toHaveBeenCalled();
});
it('ignores member search results arriving for an obsolete query', async () => {
  const view = await ready(); let finish!: (value: unknown) => void;
  jest.mocked(search).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as (value: unknown) => void; }));
  fireEvent.changeText(view.getByLabelText('Member'), 'Old'); await waitFor(() => expect(search).toHaveBeenCalledWith('Old'));
  fireEvent.changeText(view.getByLabelText('Member'), 'New'); await view.findByLabelText('Select New member · Member #10');
  await act(async () => finish([{ id: 11, name: 'Obsolete member' }]));
  expect(view.queryByLabelText('Select Obsolete member · Member #11')).toBeNull(); expect(view.getByLabelText('Select New member · Member #10')).toBeTruthy();
});
it('distinguishes privacy-limited duplicate names in selection and confirmation', async () => {
  jest.mocked(search).mockResolvedValue([{ id: 10, name: 'Same' }, { id: 11, name: 'Same' }] as never);
  const view = await ready(); fireEvent.changeText(view.getByLabelText('Member'), 'Same');
  await view.findByLabelText('Select Same · Member #10');
  fireEvent.press(view.getByLabelText('Select Same · Member #11'));
  fireEvent.press(view.getByText('Assign role'));
  expect(mockConfirm.mock.calls[0][0].message).toContain('Same · Member #11');
  await act(async () => mockConfirm.mock.calls[0][0].onConfirm());
  expect(execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ payload: expect.objectContaining({ user_id: 11 }) }), expect.any(Function));
});
it('keeps assignments visible but prevents changes after a failed refresh', async () => {
  const view = await ready(); jest.mocked(getEventStaff).mockRejectedValue(new ApiResponseError(503, 'Unavailable'));
  await act(async () => view.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh());
  await view.findByTestId('refresh-failed-notice', {}, { timeout: 10000 });
  expect(view.getByText('Team member · Member #9')).toBeTruthy(); fireEvent.press(view.getByText('Revoke access'));
  expect(mockConfirm).not.toHaveBeenCalled();
});
it('blocks changes if saved actions cannot be read and offers storage retry', async () => {
  jest.mocked(load).mockRejectedValue(new Error('storage unavailable')); const view = await ready();
  expect(await view.findByText('Saved actions unavailable')).toBeTruthy(); fireEvent.press(view.getByText('Revoke access'));
  expect(mockConfirm).not.toHaveBeenCalled(); jest.mocked(load).mockResolvedValue(null);
  await act(async () => fireEvent.press(view.getByText('Check saved actions')));
  expect(view.queryByText('Saved actions unavailable')).toBeNull();
});
