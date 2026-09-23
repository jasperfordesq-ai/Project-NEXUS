// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
let mockParams: { id?: string | string[]; section?: string } = { id: '7' };
let mockUserId = 3;
let mockTenantId = 2;

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  router: { push: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#06f', useTenant: () => ({ tenant: { id: mockTenantId } }) }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('@/lib/api/events', () => ({ getEvent: jest.fn() }));

import EventManageScreen from './event-manage';
import { getEvent } from '@/lib/api/events';
import { ApiResponseError } from '@/lib/api/client';
import { router } from 'expo-router';

const eventResponse = {
  data: { id: 7, title: 'Synthetic event', permissions: { edit: true }, series: { recurrence: false } },
};

describe('event management load lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: '7' };
    mockUserId = 3;
    mockTenantId = 2;
    jest.mocked(getEvent).mockReset().mockResolvedValue(eventResponse as never);
  });

  it('opens federation diagnostics from the permitted visible management action', async () => {
    jest.mocked(getEvent).mockResolvedValue({ data: { ...eventResponse.data, permissions: { edit: false, manage_agenda: true } } } as never);
    const screen = render(<EventManageScreen />);
    fireEvent.press(await screen.findByText('Review federation delivery'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/(modals)/event-federation', params: { id: '7' } });
  });

  it('does not expose federation diagnostics without event management permission', async () => {
    jest.mocked(getEvent).mockResolvedValue({ data: { ...eventResponse.data, permissions: { edit: true, manage_agenda: false } } } as never);
    const screen = render(<EventManageScreen />);
    await act(async () => {});
    expect(screen.queryByText('Review federation delivery')).toBeNull();
  });

  it.each(['account', 'community', 'event'])('clears loaded actions when the %s changes', async identity => {
    const screen = render(<EventManageScreen />);
    await screen.findByText('Edit event');
    let finish!: (value: unknown) => void;
    jest.mocked(getEvent).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as (value: unknown) => void; }));
    if (identity === 'account') mockUserId = 4;
    if (identity === 'community') mockTenantId = 3;
    if (identity === 'event') mockParams = { id: '8' };
    screen.rerender(<EventManageScreen />);
    expect(screen.queryByText('Edit event')).toBeNull();
    expect(getEvent).toHaveBeenCalledTimes(2);
    await act(async () => finish({ data: { ...eventResponse.data, id: Number(mockParams.id), permissions: {} } }));
    expect(screen.queryByText('Edit event')).toBeNull();
  });

  it.each(['account', 'community'])('ignores a late event response after the %s changes', async identity => {
    let finishOld!: (value: unknown) => void;
    jest.mocked(getEvent).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve as (value: unknown) => void; }));
    const screen = render(<EventManageScreen />);
    jest.mocked(getEvent).mockResolvedValue({ data: { ...eventResponse.data, permissions: {} } } as never);
    if (identity === 'account') mockUserId = 4;
    if (identity === 'community') mockTenantId = 3;
    screen.rerender(<EventManageScreen />);
    await act(async () => finishOld(eventResponse));
    expect(screen.queryByText('Edit event')).toBeNull();
    expect(getEvent).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, '', '0', '-1', '1.5', 'Infinity', 'NaN', '9007199254740992', '1e2', '0x10', ['7'], ['7', '8']])('rejects malformed event link %j without a load or redirect', id => {
    mockParams = { id, section: 'communications' };
    const screen = render(<EventManageScreen />);
    expect(getEvent).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByText('Invalid event ID.')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it.each(['people', 'check-in', 'agenda', 'safety', 'analytics', 'tickets', 'communications', 'registration', 'templates', 'series-definitions', 'team', 'federation'])('does not redirect an unauthorized %s link', async section => {
    mockParams = { id: '7', section };
    jest.mocked(getEvent).mockResolvedValue({ data: { ...eventResponse.data, permissions: {} } } as never);
    render(<EventManageScreen />);
    await act(async () => {});
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each([
    ['people', 'manage_people'], ['check-in', 'check_in'], ['agenda', 'manage_agenda'],
    ['safety', 'edit'], ['analytics', 'edit'], ['tickets', 'manage_finance'],
    ['tickets', 'reconcile_tickets'], ['communications', 'broadcast'], ['registration', 'manage_registration'],
    ['templates', 'edit'], ['team', 'manage_staff'], ['federation', 'manage_agenda'],
  ])('opens an authorized %s link with %s permission', async (section, permission) => {
    mockParams = { id: '7', section };
    jest.mocked(getEvent).mockResolvedValue({ data: { ...eventResponse.data, permissions: { [permission]: true } } } as never);
    render(<EventManageScreen />);
    await act(async () => {});
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404])('removes retained management actions after %s and during retry', async status => {
    const screen = render(<EventManageScreen />);
    await screen.findByText('Edit event');
    const refresh = () => screen.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh();
    jest.mocked(getEvent).mockRejectedValueOnce(new ApiResponseError(status, 'Unavailable'));
    act(refresh);
    await screen.findByTestId('event-manage-refused');
    expect(screen.queryByText('Edit event')).toBeNull();
    let finish!: (value: unknown) => void;
    jest.mocked(getEvent).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as (value: unknown) => void; }));
    act(refresh);
    expect(screen.queryByText('Edit event')).toBeNull();
    await act(async () => finish(eventResponse));
    expect(await screen.findByText('Edit event')).toBeTruthy();
  });

  it('retains the workspace through a temporary refresh failure and clears the notice after retry', async () => {
    const screen = render(<EventManageScreen />);
    await screen.findByText('Edit event');
    jest.mocked(getEvent).mockRejectedValueOnce(new ApiResponseError(500, 'Temporary error'))
      .mockRejectedValueOnce(new ApiResponseError(500, 'Temporary error'));
    act(() => screen.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh());
    await screen.findByTestId('refresh-failed-notice', {}, { timeout: 5000 });
    expect(screen.getByText('Edit event')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Retry'));
    await act(async () => {});
    expect(screen.queryByTestId('refresh-failed-notice')).toBeNull();
    expect(screen.getByText('Edit event')).toBeTruthy();
    expect(getEvent).toHaveBeenCalledTimes(4);
  });
});
