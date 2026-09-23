// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
let mockParams: { id?: string | string[] } = { id: '7' };
let mockUserId = 3;
let mockTenantId = 2;
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#06f', useTenant: () => ({ tenant: { id: mockTenantId } }) }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('@/lib/api/eventFederation', () => ({ ...jest.requireActual('@/lib/api/eventFederation'), getEventFederationStatus: jest.fn() }));
import Screen from './event-federation';
import { getEventFederationStatus } from '@/lib/api/eventFederation';
import { ApiResponseError } from '@/lib/api/client';
import { setRegion } from '@/lib/utils/regionStore';
const summary = {
  contract_version: 1, event_id: 7, federation_version: 1, visibility: 'none',
  configured_partners: 0, recipient_partners: 0, health: 'not_configured',
  counts: { pending: 0, retry: 0, processing: 0, delivered: 0, dead_letter: 0 },
  partners: [], generated_at: null,
};
beforeEach(() => {
  jest.clearAllMocks(); mockParams = { id: '7' }; mockUserId = 3; mockTenantId = 2;
  jest.mocked(getEventFederationStatus).mockReset().mockResolvedValue({ data: summary } as never);
});
afterEach(() => { jest.restoreAllMocks(); setRegion('IE'); });
it('remeasures both directions of live text scaling without losing diagnostics or refetching', async () => {
  const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions');
  dimensions.mockReturnValue({ width: 360, height: 800, scale: 1, fontScale: 1 });
  const view = render(<Screen />); await view.findByText('No partners set up');
  const original = view.getByText('No partners set up');
  dimensions.mockReturnValue({ width: 360, height: 800, scale: 1, fontScale: 2 });
  view.rerender(<Screen />);
  const enlarged = view.getByText('No partners set up');
  expect(enlarged).not.toBe(original);
  expect(getEventFederationStatus).toHaveBeenCalledTimes(1);
  dimensions.mockReturnValue({ width: 360, height: 800, scale: 1, fontScale: 1 });
  view.rerender(<Screen />);
  expect(view.getByText('No partners set up')).not.toBe(enlarged);
  expect(getEventFederationStatus).toHaveBeenCalledTimes(1);
});
it('formats the update date for the active community region', async () => {
  setRegion('GB');
  const stamp = '2026-09-23T02:02:00+00:00';
  jest.mocked(getEventFederationStatus).mockResolvedValue({ data: { ...summary, generated_at: stamp } } as never);
  const view = render(<Screen />);
  await view.findByText(`Updated ${new Date(stamp).toLocaleString('en-GB')}`);
});
it.each([undefined, '0', '1e2', '-1', '9007199254740992', ['7']])('does not read invalid link %j', id => {
  mockParams = { id }; const view = render(<Screen />);
  expect(view.getByText('Invalid event ID.')).toBeTruthy();
  expect(getEventFederationStatus).not.toHaveBeenCalled();
});
it('explains the unconfigured state without offering to enable sharing', async () => {
  const view = render(<Screen />);
  await view.findByText('No partner communities configured');
  expect(view.getByText('No federation deliveries have been recorded for this event.')).toBeTruthy();
  expect(view.getByText('Not shared')).toBeTruthy();
});
it.each([401, 403, 404])('removes retained delivery data on refusal %s', async status => {
  const view = render(<Screen />); await view.findByText('No partners set up');
  jest.mocked(getEventFederationStatus).mockRejectedValueOnce(new ApiResponseError(status, 'Unavailable'));
  await act(async () => view.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh());
  expect(view.queryByText('No partners set up')).toBeNull();
  expect(view.getByText('Unable to load federation status')).toBeTruthy();
  expect(view.getByText('You may not have permission to view federation status for this event.')).toBeTruthy();
  expect(view.queryByText('Your current event role does not include access to any implemented management tools.')).toBeNull();
});
it('keeps the previous diagnostics with a visible stale notice during a transient failure', async () => {
  const view = render(<Screen />); await view.findByText('No partners set up');
  jest.mocked(getEventFederationStatus).mockRejectedValue(new Error('Offline'));
  await act(async () => view.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh());
  expect(view.getByText('No partners set up')).toBeTruthy();
  await view.findByTestId('refresh-failed-notice', {}, { timeout: 10000 });
});
it.each(['account', 'community', 'event'])('discards old diagnostics and pending responses on %s change', async identity => {
  const view = render(<Screen />); await view.findByText('No partners set up');
  let finish!: (value: unknown) => void;
  jest.mocked(getEventFederationStatus).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as (value: unknown) => void; }));
  act(() => view.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh());
  if (identity === 'account') mockUserId = 4;
  if (identity === 'community') mockTenantId = 3;
  if (identity === 'event') mockParams = { id: '8' };
  jest.mocked(getEventFederationStatus).mockResolvedValue({ data: { ...summary, health: 'withdrawn' } } as never);
  view.rerender(<Screen />);
  expect(view.queryByText('No partners set up')).toBeNull();
  await view.findByText('Withdrawn from partners');
  await act(async () => finish({ data: summary }));
  expect(view.queryByText('No partners set up')).toBeNull();
});
it.each(['TIMEOUT', 'private@email.example'])('renders partner diagnostics safely for %s', async errorCode => {
  jest.mocked(getEventFederationStatus).mockResolvedValue({ data: { ...summary, health: 'degraded', configured_partners: 1, partners: [{
    partner_id: 2, partner_name: 'Synthetic partner', partner_status: 'unexpected', events_enabled: false,
    action: 'upsert', delivery_status: 'dead_letter', attempts: 3, max_attempts: 3,
    available_at: null, next_attempt_at: null, last_attempt_at: 'invalid date', delivered_at: null, dead_lettered_at: null, error_code: errorCode,
  }] } } as never);
  const view = render(<Screen />); await view.findByText('Synthetic partner');
  expect(view.getByText('Some deliveries need attention')).toBeTruthy();
  expect(view.getByText('Unknown status')).toBeTruthy();
  expect(view.getByText('Event sharing disabled')).toBeTruthy();
  expect(view.getByText(errorCode === 'TIMEOUT' ? 'Diagnostic code: TIMEOUT' : 'Diagnostic code unavailable')).toBeTruthy();
  expect(view.queryByText('Invalid Date')).toBeNull();
  expect(view.queryByText('private@email.example')).toBeNull();
});
