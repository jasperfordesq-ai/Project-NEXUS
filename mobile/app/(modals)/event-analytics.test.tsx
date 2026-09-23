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
jest.mock('@/lib/api/eventAnalytics', () => ({ getEventAnalytics: jest.fn() }));
jest.mock('@/components/events/EventAnalyticsCard', () => ({ EventAnalyticsCard: ({ summary }: any) => {
  const { Text } = require('react-native');
  return summary ? <Text>{summary.event_title}</Text> : null;
} }));
import Screen from './event-analytics';
import { getEventAnalytics } from '@/lib/api/eventAnalytics';
import { ApiResponseError } from '@/lib/api/client';
const response = { data: { event_id: 7, event_title: 'Synthetic analytics' }, meta: { base_url: '' } };
beforeEach(() => {
  jest.clearAllMocks(); mockParams = { id: '7' }; mockUserId = 3; mockTenantId = 2;
  jest.mocked(getEventAnalytics).mockReset().mockResolvedValue(response as never);
});
it.each([undefined, '0', '1e2', '-1', '9007199254740992', ['7']])('does not load invalid event link %j', id => {
  mockParams = { id }; const view = render(<Screen />);
  expect(view.getByText('Invalid event ID.')).toBeTruthy();
  expect(getEventAnalytics).not.toHaveBeenCalled();
});
it.each(['account', 'community', 'event'])('clears analytics and ignores an old response on %s change', async identity => {
  const view = render(<Screen />); await view.findByText('Synthetic analytics');
  let finish!: (value: unknown) => void;
  jest.mocked(getEventAnalytics).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as (value: unknown) => void; }));
  act(() => view.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh());
  if (identity === 'account') mockUserId = 4;
  if (identity === 'community') mockTenantId = 3;
  if (identity === 'event') mockParams = { id: '8' };
  jest.mocked(getEventAnalytics).mockResolvedValue({ data: { event_id: Number(mockParams.id), event_title: 'Current analytics' } } as never);
  view.rerender(<Screen />);
  expect(view.queryByText('Synthetic analytics')).toBeNull();
  await view.findByText('Current analytics');
  await act(async () => finish(response));
  expect(view.queryByText('Synthetic analytics')).toBeNull();
});
it.each([401, 403, 404])('clears retained analytics on refusal %s', async status => {
  const view = render(<Screen />); await view.findByText('Synthetic analytics');
  jest.mocked(getEventAnalytics).mockRejectedValueOnce(new ApiResponseError(status, 'Unavailable'));
  await act(async () => view.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh());
  expect(view.queryByText('Synthetic analytics')).toBeNull();
});
it('keeps a visibly stale summary on network refresh failure', async () => {
  const view = render(<Screen />); await view.findByText('Synthetic analytics');
  jest.mocked(getEventAnalytics).mockRejectedValue(new Error('Offline'));
  await act(async () => view.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh());
  expect(view.getByText('Synthetic analytics')).toBeTruthy();
  expect(await view.findByTestId('refresh-failed-notice', {}, { timeout: 10000 })).toBeTruthy();
});
it('never renders a response for another event', async () => {
  jest.mocked(getEventAnalytics).mockResolvedValue({ data: { event_id: 8, event_title: 'Wrong event' } } as never);
  const view = render(<Screen />); await act(async () => {});
  expect(view.queryByText('Wrong event')).toBeNull();
});
