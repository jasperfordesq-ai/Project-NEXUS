// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import EventPeopleInvitations from './EventPeopleInvitations';
import { searchEventInviteMembers } from '@/lib/api/eventPeople';
import { ApiResponseError } from '@/lib/api/client';
jest.mock('@/lib/api/eventPeople', () => ({ searchEventInviteMembers: jest.fn() }));
beforeEach(() => { jest.mocked(searchEventInviteMembers).mockReset().mockResolvedValue([{ id: 44, name: 'Alex Member' }]); });

it('retries the same failed search without requiring edited text', async () => {
  jest.mocked(searchEventInviteMembers).mockRejectedValueOnce(new ApiResponseError(422, 'Search unavailable'));
  const screen = render(<EventPeopleInvitations blocked={false} onInvite={jest.fn()} />);
  fireEvent.changeText(screen.getByLabelText('Find members'), 'Alex'); fireEvent.press(screen.getByText('Search'));
  await screen.findByText('Member search is unavailable. Please try again.');
  fireEvent.press(screen.getByText('Search'));
  await screen.findByText('Select Alex Member');
  expect(searchEventInviteMembers).toHaveBeenCalledTimes(2);
});

it('searches by name only on demand, selects the returned identity and submits version zero', async () => {
  const invite = jest.fn().mockResolvedValue(undefined);
  const screen = render(<EventPeopleInvitations blocked={false} onInvite={invite} />);
  expect(searchEventInviteMembers).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('Find members'), 'A');
  expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  fireEvent.changeText(screen.getByLabelText('Find members'), ' Alex ');
  fireEvent.press(screen.getByText('Search'));
  fireEvent.press(await screen.findByText('Select Alex Member'));
  fireEvent.press(screen.getByText('Invite selected (1)'));
  await waitFor(() => expect(invite).toHaveBeenCalledWith({ action: 'invite', reason: null, targets: [{ userId: 44, version: 0 }] }));
  expect(searchEventInviteMembers).toHaveBeenCalledWith('Alex');
});

it('retains selected names after a failed request and blocks duplicate submission', async () => {
  let reject!: (error: Error) => void;
  const invite = jest.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
  const screen = render(<EventPeopleInvitations blocked={false} onInvite={invite} />);
  fireEvent.changeText(screen.getByLabelText('Find members'), 'Alex'); fireEvent.press(screen.getByText('Search'));
  fireEvent.press(await screen.findByText('Select Alex Member'));
  fireEvent.press(screen.getByText('Invite selected (1)')); fireEvent.press(screen.getByText('Invite selected (1)'));
  expect(invite).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('Uncertain response')));
  expect(screen.getByText('The invitations could not be processed.')).toBeTruthy();
  expect(screen.getByText('Invite selected (1)')).toBeTruthy();
  screen.rerender(<EventPeopleInvitations blocked onInvite={invite} />);
  expect(screen.getByRole('button', { name: 'Invite selected (1)' })).toBeDisabled();
});

it('clears candidate results when search is cleared and ignores the late previous query', async () => {
  let finish!: (value: { id: number; name: string }[]) => void;
  jest.mocked(searchEventInviteMembers).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const screen = render(<EventPeopleInvitations blocked={false} onInvite={jest.fn()} />);
  fireEvent.changeText(screen.getByLabelText('Find members'), 'Alex'); fireEvent.press(screen.getByText('Search'));
  await waitFor(() => expect(searchEventInviteMembers).toHaveBeenCalled());
  fireEvent.changeText(screen.getByLabelText('Find members'), '');
  await act(async () => finish([{ id: 44, name: 'Alex Member' }]));
  expect(screen.queryByText('Select Alex Member')).toBeNull();
});
