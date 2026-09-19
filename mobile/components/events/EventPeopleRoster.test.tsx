// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import EventPeopleRoster from './EventPeopleRoster';
import { getEventPeople, getEventPeopleHistory } from '@/lib/api/eventPeople';
import { ApiResponseError } from '@/lib/api/client';
import { loadEventPeopleOperation } from '@/lib/eventPeopleOperationStore';
import { executeEventPeopleOperation, recoverEventPeopleOperation } from '@/lib/eventPeopleOperation';
import i18n from 'i18next';
import communicationLabels from '@/locales/en/event_communications.json';

beforeAll(() => { i18n.addResourceBundle('en', 'event_communications', communicationLabels); });

jest.mock('@/lib/eventPeopleOperationStore', () => ({ loadEventPeopleOperation: jest.fn() }));
jest.mock('@/lib/eventPeopleOperation', () => ({ executeEventPeopleOperation: jest.fn(), recoverEventPeopleOperation: jest.fn() }));

let mockUserId = 3;
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ useTenant: () => ({ tenant: { id: 2 } }) }));
jest.mock('@/lib/api/eventPeople', () => ({ getEventPeople: jest.fn(), getEventPeopleHistory: jest.fn() }));
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
const result = {
  data: [{ member: { id: 44, display_name: 'Alex Member' }, registration: { state: 'pending' },
    waitlist: { state: 'waiting', position: 3 }, attendance: { state: 'not_checked_in' } }],
  meta: { current_page: 1, per_page: 25, total: 26, has_more: true },
};
beforeEach(() => {
  mockUserId = 3;
  jest.mocked(getEventPeople).mockReset().mockResolvedValue(result as never);
  jest.mocked(getEventPeopleHistory).mockReset().mockResolvedValue({ data: [], meta: { has_more: false } } as never);
  jest.mocked(loadEventPeopleOperation).mockReset().mockResolvedValue(null);
  jest.mocked(executeEventPeopleOperation).mockReset().mockResolvedValue({} as never);
  jest.mocked(recoverEventPeopleOperation).mockReset().mockResolvedValue({} as never);
});

it('shows registration and waitlist information without truncating member names', async () => {
  const screen = render(<EventPeopleRoster eventId={7} />);
  const name = await screen.findByText('Alex Member');
  expect(name.props.numberOfLines).toBeUndefined();
  expect(screen.getByText(/Position 3/)).toBeTruthy();
  expect(screen.getByText(/Pending/)).toBeTruthy();
});

it('resets pagination on search and applies a registration filter', async () => {
  const screen = render(<EventPeopleRoster eventId={7} />);
  await screen.findByText('Alex Member');
  fireEvent.press(screen.getByText('Next'));
  await waitFor(() => expect(getEventPeople).toHaveBeenLastCalledWith(7, { page: 2 }));
  fireEvent.changeText(screen.getByLabelText('Search people'), ' Alex ');
  fireEvent.press(screen.getByText('Search'));
  await waitFor(() => expect(getEventPeople).toHaveBeenLastCalledWith(7, { page: 1, search: 'Alex' }));
  fireEvent.press(screen.getByText('Filter'));
  fireEvent.press(screen.getByText('Confirmed'));
  await waitFor(() => expect(getEventPeople).toHaveBeenLastCalledWith(7, { page: 1, search: 'Alex', registration_state: 'confirmed' }));
});

it('clears the roster and pagination after access is refused', async () => {
  const screen = render(<EventPeopleRoster eventId={7} />);
  await screen.findByText('Alex Member');
  jest.mocked(getEventPeople).mockRejectedValueOnce(new ApiResponseError(403, 'Unavailable'));
  act(() => screen.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh());
  await screen.findByTestId('event-people-refused');
  expect(screen.queryByText('Alex Member')).toBeNull();
  expect(screen.queryByText('Next')).toBeNull();
});

it('ignores a previous account response after the account changes', async () => {
  let finish!: (value: unknown) => void;
  jest.mocked(getEventPeople).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as (value: unknown) => void; }));
  const screen = render(<EventPeopleRoster eventId={7} />);
  mockUserId = 4;
  jest.mocked(getEventPeople).mockResolvedValue({ ...result, data: [] } as never);
  screen.rerender(<EventPeopleRoster eventId={7} />);
  await act(async () => finish(result));
  expect(screen.queryByText('Alex Member')).toBeNull();
  expect(await screen.findByText('No people match these filters.')).toBeTruthy();
});

it('accepts 100 Unicode characters and bounds pasted search input', async () => {
  const screen = render(<EventPeopleRoster eventId={7} />);
  await screen.findByText('Alex Member');
  const input = screen.getByLabelText('Search people');
  expect(input.props.maxLength).toBeUndefined();
  fireEvent.changeText(input, '😀'.repeat(101));
  expect(screen.getByLabelText('Search people').props.value).toBe('😀'.repeat(100));
  fireEvent.press(screen.getByText('Search'));
  await waitFor(() => expect(getEventPeople).toHaveBeenLastCalledWith(7, { page: 1, search: '😀'.repeat(100) }));
});

it('never requests a page beyond the API addressable limit', async () => {
  jest.mocked(getEventPeople).mockResolvedValue({ ...result, meta: { ...result.meta, current_page: 400, total: 10001 } } as never);
  const screen = render(<EventPeopleRoster eventId={7} />);
  await screen.findByText('Alex Member');
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  fireEvent.press(screen.getByText('Next'));
  expect(getEventPeople).toHaveBeenCalledTimes(1);
});

it('does not replace a newer search with an older response', async () => {
  let finish!: (value: unknown) => void;
  const screen = render(<EventPeopleRoster eventId={7} />);
  await screen.findByText('Alex Member');
  jest.mocked(getEventPeople).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as (value: unknown) => void; }));
  fireEvent.changeText(screen.getByLabelText('Search people'), 'Old query');
  fireEvent.press(screen.getByText('Search'));
  await waitFor(() => expect(getEventPeople).toHaveBeenLastCalledWith(7, { page: 1, search: 'Old query' }));
  expect(screen.queryByText('Alex Member')).toBeNull();
  jest.mocked(getEventPeople).mockResolvedValue({ ...result, data: [] } as never);
  fireEvent.changeText(screen.getByLabelText('Search people'), 'New query');
  fireEvent.press(screen.getByText('Search'));
  await screen.findByText('No people match these filters.');
  await act(async () => finish(result));
  expect(screen.queryByText('Alex Member')).toBeNull();
  expect(screen.getByText('No people match these filters.')).toBeTruthy();
});

const manageable = { ...result, data: [{ ...result.data[0], registration: { state: 'pending', version: 2 },
  management_actions: { approve: true, reject: true, cancel: false } }],
  meta: { ...result.meta, projection: 'full', capabilities: { manage_registration: true } } };

it('selects eligible people on the page and toggles the selection off', async () => {
  jest.mocked(getEventPeople).mockResolvedValue({ ...manageable, data: [...manageable.data,
    { ...manageable.data[0], member: { id: 45, display_name: 'Read only' }, management_actions: { approve: false, reject: false, cancel: false } }] } as never);
  const screen = render(<EventPeopleRoster eventId={7} />);
  fireEvent.press(await screen.findByText('Select everyone on this page'));
  expect(screen.getByText('1 selected')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Select everyone on this page' }).props.accessibilityState.selected).toBe(true);
  fireEvent.press(screen.getByText('Select everyone on this page'));
  expect(screen.queryByText('1 selected')).toBeNull();
});

it('submits selected registration versions only after explicit confirmation', async () => {
  jest.mocked(getEventPeople).mockResolvedValue(manageable as never);
  const screen = render(<EventPeopleRoster eventId={7} />);
  fireEvent.press(await screen.findByText('Select Alex Member'));
  expect(screen.getByRole('button', { name: 'Cancel registration' })).toBeDisabled();
  fireEvent.press(screen.getByText('Approve'));
  expect(await screen.findByText('Approve registrations?')).toBeTruthy();
  expect(executeEventPeopleOperation).not.toHaveBeenCalled();
  fireEvent.press(screen.getAllByText('Approve')[1]);
  await waitFor(() => expect(executeEventPeopleOperation).toHaveBeenCalledWith(
    { tenantId: 2, userId: 3, eventId: 7 }, { action: 'approve', targets: [{ userId: 44, version: 2 }], reason: null }, expect.any(Function)));
  await waitFor(() => expect(screen.queryByText('Approve registrations?')).toBeNull());
});

it('shows pending recovery without replaying automatically or allowing another selection', async () => {
  jest.mocked(getEventPeople).mockResolvedValue(manageable as never);
  jest.mocked(loadEventPeopleOperation).mockResolvedValue({ status: 'pending' } as never);
  const screen = render(<EventPeopleRoster eventId={7} />);
  await screen.findByText('Previous action needs recovery');
  expect(recoverEventPeopleOperation).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Select Alex Member' })).toBeDisabled();
  fireEvent.press(screen.getByText('Recover saved action'));
  await waitFor(() => expect(recoverEventPeopleOperation).toHaveBeenCalledTimes(1));
});

it('keeps mutations disabled if saved requests cannot be read', async () => {
  jest.mocked(getEventPeople).mockResolvedValue(manageable as never);
  jest.mocked(loadEventPeopleOperation).mockRejectedValueOnce(new Error('Locked storage'));
  const screen = render(<EventPeopleRoster eventId={7} />);
  await screen.findByText('Saved actions unavailable');
  expect(screen.getByRole('button', { name: 'Select Alex Member' })).toBeDisabled();
  fireEvent.press(screen.getByText('Check saved actions'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Select Alex Member' })).not.toBeDisabled());
});

it('displays partial outcomes against the affected member instead of claiming every item succeeded', async () => {
  jest.mocked(getEventPeople).mockResolvedValue(manageable as never);
  jest.mocked(loadEventPeopleOperation).mockResolvedValue({ status: 'acknowledged', outcomes: [
    { userId: 44, success: false, code: 'VERSION_CONFLICT' }, { userId: 45, success: true },
  ] } as never);
  const screen = render(<EventPeopleRoster eventId={7} />);
  expect(await screen.findByText('1 record(s) updated.')).toBeTruthy();
  expect(screen.getByText('Alex Member: The people records could not be updated.')).toBeTruthy();
});

it('blocks an older roster row after a newer registration receipt', async () => {
  jest.mocked(getEventPeople).mockResolvedValue(manageable as never);
  jest.mocked(loadEventPeopleOperation).mockResolvedValue({ status: 'acknowledged', outcomes: [
    { userId: 44, success: true, version: 3 },
  ] } as never);
  const screen = render(<EventPeopleRoster eventId={7} />);
  await screen.findByText('Select Alex Member');
  expect(screen.getByRole('button', { name: 'Select Alex Member' })).toBeDisabled();
});

it('hides saved management results when the current projection lacks registration authority', async () => {
  jest.mocked(loadEventPeopleOperation).mockResolvedValue({ status: 'acknowledged', outcomes: [
    { userId: 999, success: false, code: 'VERSION_CONFLICT' },
  ] } as never);
  const screen = render(<EventPeopleRoster eventId={7} />);
  await screen.findByText('Alex Member');
  expect(screen.queryByText(/Member #999/)).toBeNull();
  expect(screen.queryByText(/record\(s\) updated/)).toBeNull();
});

it('announces failed recovery while keeping the uncertain request available', async () => {
  jest.mocked(getEventPeople).mockResolvedValue(manageable as never);
  jest.mocked(loadEventPeopleOperation).mockResolvedValue({ status: 'pending' } as never);
  jest.mocked(recoverEventPeopleOperation).mockRejectedValue(new Error('Lost response'));
  const screen = render(<EventPeopleRoster eventId={7} />);
  fireEvent.press(await screen.findByText('Recover saved action'));
  expect(await screen.findByText('The people records could not be updated.')).toBeTruthy();
  expect(screen.getByText('Previous action needs recovery')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Select Alex Member' })).toBeDisabled();
  expect(screen.queryByText('Lost response')).toBeNull();
});

it('opens and removes person history using the actual view_history capability', async () => {
  jest.mocked(getEventPeople).mockResolvedValue({ ...manageable, meta: { ...manageable.meta,
    capabilities: { ...manageable.meta.capabilities, view_history: true } } } as never);
  const screen = render(<EventPeopleRoster eventId={7} />);
  fireEvent.press(await screen.findByText('History'));
  await screen.findByText('History for Alex Member');
  expect(getEventPeopleHistory).toHaveBeenCalledWith(7, 44, 1);
  jest.mocked(getEventPeople).mockResolvedValue({ ...manageable, meta: { ...manageable.meta,
    capabilities: { ...manageable.meta.capabilities, view_history: false } } } as never);
  await act(async () => screen.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh());
  expect(getEventPeople).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(screen.queryByText('History for Alex Member')).toBeNull());
  expect(screen.queryByText('History')).toBeNull();
});
