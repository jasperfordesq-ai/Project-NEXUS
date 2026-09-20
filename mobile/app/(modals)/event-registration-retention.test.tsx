// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import Input from '@/components/ui/Input';
import { AppState } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
let mockId: string | string[] | undefined = '42'; let mockFocused = true; let mockUser = 7;
let mockState: any; let mockOperation: any; const mockUseApi = jest.fn(); const mockUseOperation = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: mockId }) }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mockUser } }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ useTenant: () => ({ tenant: { id: 2 } }) }));
jest.mock('@/lib/hooks/useApi', () => ({ useApi: (...args: unknown[]) => { mockUseApi(...args); return mockState; } }));
jest.mock('@/lib/hooks/useRetentionOperations', () => ({ useRetentionOperations: (...args: unknown[]) => { mockUseOperation(...args); return mockOperation; } }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/withRouteGate', () => ({ withRouteGate: (screen: unknown) => screen }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import Screen from './event-registration-retention';
const run = { id: 9, event_id: 42, mode: 'dry_run', dry_run_id: null, as_of_utc: '2026-01-02T12:00:00Z', eligible_count: 2, affected_count: 0 };
beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() }); Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
  jest.clearAllMocks(); mockId = '42'; mockFocused = true; mockUser = 7;
  mockState = { isLoading: false, error: null, errorStatus: null, refresh: jest.fn(), data: { permitted: true, configured: true,
    runs: [run], schedule: { timezone: 'UTC', end_at: '2026-01-01T12:00:00Z' },
    pagination: { page: 1, last_page: 2, previous_page: null, next_page: 2 } } };
  mockOperation = { ready: true, blocked: false, busy: false, saved: null, submit: jest.fn(), recover: jest.fn(), reload: jest.fn() };
});
it('requires review then explicit confirmation before applying the chosen preview', () => {
  const view = render(<Screen />); expect(mockOperation.submit).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('retention.review'));
  fireEvent.press(view.getByText('retention.apply')); expect(mockOperation.submit).not.toHaveBeenCalled();
  expect(view.getByText('retention.warning_description')).toBeTruthy();
  fireEvent.press(view.getByText('common:buttons.confirm'));
  expect(mockOperation.submit).toHaveBeenCalledWith({ action: 'apply', dryRunId: 9 });
});
it('validates preview time before creating a durable request', () => {
  const view = render(<Screen />); const input = view.getByLabelText('retention.as_of');
  for (const value of ['invalid', '2025-12-31T12:00', '2099-01-02T12:00']) {
    fireEvent.changeText(input, value); fireEvent.press(view.getByText('retention.preview'));
  }
  expect(mockOperation.submit).not.toHaveBeenCalled();
  fireEvent.changeText(input, '2026-01-02T12:00'); fireEvent.press(view.getByText('retention.preview'));
  expect(mockOperation.submit).toHaveBeenCalledWith({ action: 'preview', asOf: '2026-01-02T12:00:00.000Z' });
});
it('requires settings for new work but preserves explicit pending recovery', () => {
  mockState.data.configured = false; mockOperation.blocked = true; mockOperation.saved = { status: 'pending', intent: { action: 'apply', dryRunId: 9 } };
  const view = render(<Screen />); expect(view.getByText('retention.settings_required')).toBeTruthy();
  expect(mockOperation.recover).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('retention.preview')); expect(mockOperation.submit).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('event_communications:recovery_button')); expect(mockOperation.recover).toHaveBeenCalledTimes(1);
});
it('clears confirmation after departure and account change', () => {
  const view = render(<Screen />); fireEvent.press(view.getByText('retention.review')); fireEvent.press(view.getByText('retention.apply'));
  act(() => jest.mocked(AppState.addEventListener).mock.calls.at(-1)?.[1]('background')); expect(view.queryByText('common:buttons.confirm')).toBeNull();
  act(() => jest.mocked(AppState.addEventListener).mock.calls.at(-1)?.[1]('active')); expect(view.queryByText('common:buttons.confirm')).toBeNull();
  fireEvent.press(view.getByText('retention.review')); fireEvent.press(view.getByText('retention.apply'));
  mockUser = 8; view.rerender(<Screen />); expect(view.queryByText('common:buttons.confirm')).toBeNull();
});
it('shows a saved receipt from another page without applying on load', () => {
  mockOperation.saved = { status: 'acknowledged', run: { ...run, id: 10, mode: 'apply', dry_run_id: 9, affected_count: 2 } };
  const view = render(<Screen />); expect(view.getByText('retention.modes.apply · 10')).toBeTruthy(); expect(mockOperation.submit).not.toHaveBeenCalled();
});
it('pages history and denies controls after permission loss', () => {
  const view = render(<Screen />); fireEvent.press(view.getByText('events:attendance.next')); expect(mockUseApi.mock.calls.at(-1)?.[1]).toEqual([42, 2]);
  mockState.data.permitted = false; view.rerender(<Screen />); expect(view.queryByText('retention.preview')).toBeNull();
});
it.each(['0', ['42', '43'], undefined])('rejects malformed route IDs', id => {
  mockId = id; render(<Screen />); expect(mockUseApi).not.toHaveBeenCalled();
});
jest.mock('@/lib/observability/report', () => ({ reportSentryMessage: jest.fn() }));

it('removes retained data and action authority after a mutation refusal', () => {
  mockOperation.errorStatus = 403;
  const view = render(<Screen />);
  expect(view.queryByText('retention.preview')).toBeNull();
  expect(view.queryByText('retention.modes.dry_run · 9')).toBeNull();
  expect(mockUseOperation.mock.calls.at(-1)?.[1]).toBe(false);
});

it('clears a date refusal when the same date becomes valid', () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-02T11:59:00Z'));
  try {
    const view = render(<Screen />);
    fireEvent.changeText(view.getByLabelText('retention.as_of'), '2026-01-02T12:00');
    fireEvent.press(view.getByText('retention.preview'));
    expect(mockOperation.submit).not.toHaveBeenCalled();
    clock.mockReturnValue(Date.parse('2026-01-02T12:01:00Z'));
    fireEvent.press(view.getByText('retention.preview'));
    expect(mockOperation.submit).toHaveBeenCalledTimes(1);
    expect(view.UNSAFE_getByType(Input).props.error).toBeUndefined();
  } finally { clock.mockRestore(); }
});

it('refreshes the list but refuses a pull during an active operation', () => {
  const view = render(<Screen />);
  const refreshControl = () => view.UNSAFE_getByType(require('react-native').RefreshControl);
  act(() => refreshControl().props.onRefresh());
  expect(mockState.refresh).toHaveBeenCalledTimes(1);
  mockOperation.busy = true; view.rerender(<Screen />);
  expect(refreshControl().props.enabled).toBe(false);
  act(() => refreshControl().props.onRefresh());
  expect(mockState.refresh).toHaveBeenCalledTimes(1);
});

it('does not refresh away an active draft', () => {
 const view=render(<Screen />); fireEvent.changeText(view.getByLabelText('retention.as_of'), '2026-09-20 05:00');
 const control=view.UNSAFE_getByType(require('react-native').RefreshControl);
 expect(control.props.enabled).toBe(false); act(() => control.props.onRefresh());
 expect(mockState.refresh).not.toHaveBeenCalled();
});
