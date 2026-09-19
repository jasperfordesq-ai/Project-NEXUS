// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import EventPeopleExport from './EventPeopleExport';
import { exportEventPeople } from '@/lib/api/eventPeople';
jest.mock('@/lib/api/eventPeople', () => ({ exportEventPeople: jest.fn() }));
beforeEach(() => { jest.mocked(exportEventPeople).mockReset().mockResolvedValue(undefined); });
const props = { eventId: 7, query: { page: 3, search: 'Alex' }, total: 73, disabled: false };

it('requires review of included/excluded fields before an all-pages export', async () => {
  const screen = render(<EventPeopleExport {...props} />);
  fireEvent.press(screen.getByText('Export CSV'));
  expect(exportEventPeople).not.toHaveBeenCalled();
  expect(screen.getByText('The CSV contains all 73 people matching the current filters, across every results page.')).toBeTruthy();
  expect(screen.getByText('Always excluded for privacy')).toBeTruthy();
  expect(screen.getByText('Registration form answers and custom question responses')).toBeTruthy();
  fireEvent.press(screen.getByText('Download privacy-safe CSV'));
  await waitFor(() => expect(exportEventPeople).toHaveBeenCalledWith(7, props.query, expect.any(Function)));
});

it('allows cancellation before downloading', () => {
  const screen = render(<EventPeopleExport {...props} />);
  fireEvent.press(screen.getByText('Export CSV')); fireEvent.press(screen.getByText('Cancel'));
  expect(exportEventPeople).not.toHaveBeenCalled();
  expect(screen.queryByText('Download privacy-safe CSV')).toBeNull();
});

it('blocks duplicates and invalidates the native download guard on departure', async () => {
  let finish!: () => void;
  jest.mocked(exportEventPeople).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const screen = render(<EventPeopleExport {...props} />);
  fireEvent.press(screen.getByText('Export CSV')); fireEvent.press(screen.getByText('Download privacy-safe CSV'));
  fireEvent.press(screen.getByText('Download privacy-safe CSV'));
  expect(exportEventPeople).toHaveBeenCalledTimes(1);
  const active = jest.mocked(exportEventPeople).mock.calls[0][2];
  expect(active()).toBe(true);
  screen.unmount(); expect(active()).toBe(false);
  await act(async () => finish());
});

it('shows failed download and preserves the review for retry', async () => {
  jest.mocked(exportEventPeople).mockRejectedValueOnce(new Error('Unavailable'));
  const screen = render(<EventPeopleExport {...props} />);
  fireEvent.press(screen.getByText('Export CSV')); fireEvent.press(screen.getByText('Download privacy-safe CSV'));
  expect(await screen.findByText('The people export could not be created.')).toBeTruthy();
  expect(screen.getByText('Download privacy-safe CSV')).toBeTruthy();
});
