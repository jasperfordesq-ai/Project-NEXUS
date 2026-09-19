// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import EventPeopleHistory from './EventPeopleHistory';
import { getEventPeopleHistory } from '@/lib/api/eventPeople';
import { ApiResponseError } from '@/lib/api/client';
jest.mock('@/lib/api/eventPeople', () => ({ getEventPeopleHistory: jest.fn() }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 3 } }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ useTenant: () => ({ tenant: { id: 2 } }) }));
const response = { data: [{ axis: 'registration', entry_id: 1, version: 2, from_state: 'pending', to_state: 'confirmed',
  actor: { display_name: 'Organiser' }, reason: 'Approved after review', created_at: '2026-09-19 12:00:00' }],
  meta: { current_page: 1, has_more: true } };
beforeEach(() => { jest.mocked(getEventPeopleHistory).mockReset().mockResolvedValue(response as never); });

it('renders state change, actor, version and reason and requests the next page', async () => {
  const screen = render(<EventPeopleHistory eventId={7} userId={44} name="Alex" onClose={jest.fn()} />);
  expect(await screen.findByText('Approved after review')).toBeTruthy();
  expect(screen.getByText('Registration · Pending to Confirmed')).toBeTruthy();
  expect(screen.getByText('Version 2')).toBeTruthy();
  expect(screen.getByText(/Organiser ·/)).toBeTruthy();
  fireEvent.press(screen.getByText('Next'));
  await waitFor(() => expect(getEventPeopleHistory).toHaveBeenLastCalledWith(7, 44, 2));
});

it('does not show an old person response after the selected person changes', async () => {
  let finish!: (value: unknown) => void;
  jest.mocked(getEventPeopleHistory).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as (value: unknown) => void; }));
  const screen = render(<EventPeopleHistory eventId={7} userId={44} name="Alex" onClose={jest.fn()} />);
  jest.mocked(getEventPeopleHistory).mockResolvedValue({ data: [], meta: { current_page: 1, has_more: false } } as never);
  screen.rerender(<EventPeopleHistory eventId={7} userId={45} name="Sam" onClose={jest.fn()} />);
  await screen.findByText('No history entries were returned.');
  await act(async () => finish(response));
  expect(screen.queryByText('Approved after review')).toBeNull();
  expect(screen.getByText('History for Sam')).toBeTruthy();
});

it('removes the previous page and stops offering pagination when access is refused', async () => {
  const screen = render(<EventPeopleHistory eventId={7} userId={44} name="Alex" onClose={jest.fn()} />);
  await screen.findByText('Approved after review');
  jest.mocked(getEventPeopleHistory).mockRejectedValueOnce(new ApiResponseError(403, 'No access'));
  fireEvent.press(screen.getByText('Next'));
  await waitFor(() => expect(screen.queryByText('Next')).toBeNull());
  expect(screen.queryByText('Approved after review')).toBeNull();
  expect(screen.queryByText('Retry')).toBeNull();
});

it('does not query malformed person IDs and keeps close available', () => {
  const close = jest.fn();
  const screen = render(<EventPeopleHistory eventId={7} userId={0} name="Alex" onClose={close} />);
  expect(getEventPeopleHistory).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Close history')); expect(close).toHaveBeenCalledTimes(1);
});
