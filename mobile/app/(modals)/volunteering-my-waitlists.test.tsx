// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

let mockVolunteeringConfig: Record<string, unknown> = {};

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'volunteeringVolunteer:waitlist.title': 'Waiting lists',
        'volunteeringVolunteer:waitlist.intro': 'When a shift is full you can wait for a place.',
        'volunteeringVolunteer:waitlist.empty': 'You are not on any waiting lists.',
        'volunteeringVolunteer:waitlist.emptyHint': 'Join one from a full shift.',
        'volunteeringVolunteer:waitlist.position': `Position ${String(opts?.position ?? '')}`,
        'volunteeringVolunteer:waitlist.spotAvailable': 'A place is free',
        'volunteeringVolunteer:waitlist.claimHint': 'Claim it soon.',
        'volunteeringVolunteer:waitlist.claim': 'Claim place',
        'volunteeringVolunteer:waitlist.claimLabel': `Claim your place on ${String(opts?.title ?? '')}`,
        'volunteeringVolunteer:waitlist.claimedTitle': 'Place claimed',
        'volunteeringVolunteer:waitlist.claimedBody': 'You are now signed up.',
        'volunteeringVolunteer:waitlist.claimError': 'Could not claim this place.',
        'volunteeringVolunteer:waitlist.leave': 'Leave list',
        'volunteeringVolunteer:waitlist.leaveLabel': `Leave the waiting list for ${String(opts?.title ?? '')}`,
        'volunteeringVolunteer:waitlist.leaveConfirmTitle': 'Leave this waiting list?',
        'volunteeringVolunteer:waitlist.leaveConfirmMessage': 'You will lose your position.',
        'volunteeringVolunteer:waitlist.leaveError': 'Could not leave this waiting list.',
        'volunteeringVolunteer:waitlist.joined': `Joined ${String(opts?.date ?? '')}`,
        'volunteeringVolunteer:waitlist.capacity': `${String(opts?.count ?? 0)} places`,
        'volunteeringVolunteer:waitlist.loadError': 'Could not load your waiting lists.',
        'volunteeringVolunteer:unavailable.title': 'Not available in this community',
        'volunteeringVolunteer:unavailable.body': 'Switched off here.',
        'volunteeringVolunteer:unavailable.back': 'Back to volunteering',
        'volunteeringVolunteer:common.timeRange': `${String(opts?.start ?? '')}–${String(opts?.end ?? '')}`,
        'volunteeringVolunteer:common.dateUnknown': 'Date unavailable',
        'volunteering:viewOpportunity': 'View',
        'common:buttons.cancel': 'Cancel',
        'common:buttons.retry': 'Retry',
        'common:errors.alertTitle': 'Error',
        'common:back': 'Back',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true, tenant: { id: 2, slug: 'e2e', volunteering_config: mockVolunteeringConfig } }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#fff', surface: '#f8f9fa', text: '#000', textSecondary: '#666', textMuted: '#999',
    border: '#ddd', borderSubtle: '#eee', error: '#e53e3e', success: '#16a34a', warning: '#f59e0b',
  }),
}));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 7 } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

const mockShowToast = jest.fn();
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockShowToast, hide: jest.fn(), isToastVisible: false }),
}));

const mockConfirm = jest.fn();
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({ confirm: (opts: unknown) => mockConfirm(opts), confirmDialog: null }),
}));

jest.mock('@/lib/api/volunteeringVolunteer', () => ({
  ...jest.requireActual('@/lib/api/volunteeringVolunteer'),
  getMyWaitlists: jest.fn(),
  leaveWaitlist: jest.fn(),
  claimWaitlistPlace: jest.fn(),
}));

import MyWaitlistsScreen from './volunteering-my-waitlists';
import { claimWaitlistPlace, getMyWaitlists, leaveWaitlist } from '@/lib/api/volunteeringVolunteer';
import { ApiResponseError } from '@/lib/api/client';

const waiting = {
  id: 1, position: 3, status: 'waiting', notified_at: null,
  shift: { id: 44, start_time: '2026-11-02T09:00:00Z', end_time: '2026-11-02T12:00:00Z', capacity: 6 },
  opportunity: { id: 10, title: 'Garden tidy', location: 'Dublin' },
  organization: { id: 4, name: 'Green Spaces', logo_url: null },
  joined_at: '2026-10-01T10:00:00Z',
};
const notified = {
  ...waiting, id: 2, position: 1, status: 'notified', notified_at: '2026-10-05T10:00:00Z',
  shift: { ...waiting.shift, id: 45 }, opportunity: { id: 11, title: 'Soup kitchen', location: null },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockVolunteeringConfig = {};
  jest.mocked(getMyWaitlists).mockResolvedValue({ data: [waiting, notified] });
  jest.mocked(leaveWaitlist).mockResolvedValue(undefined);
  jest.mocked(claimWaitlistPlace).mockResolvedValue({ data: { message: 'ok' } });
});

describe('MyWaitlistsScreen', () => {
  it('shows each entry with its position, and a claim button only once a place is free', async () => {
    const { getByText, queryByTestId, getByTestId } = render(<MyWaitlistsScreen />);
    await waitFor(() => expect(getByText('Garden tidy')).toBeTruthy());
    expect(getByText('Position 3')).toBeTruthy();
    expect(getByText('A place is free')).toBeTruthy();
    expect(queryByTestId('waitlist-claim-1')).toBeNull();
    expect(getByTestId('waitlist-claim-2')).toBeTruthy();
  });

  it('claims the free place against the SHIFT id and reloads', async () => {
    const { getByTestId } = render(<MyWaitlistsScreen />);
    await waitFor(() => expect(getByTestId('waitlist-claim-2')).toBeTruthy());
    fireEvent.press(getByTestId('waitlist-claim-2'));
    await waitFor(() => expect(claimWaitlistPlace).toHaveBeenCalledWith(45));
    await waitFor(() => expect(getMyWaitlists).toHaveBeenCalledTimes(2));
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Place claimed', variant: 'success' }));
  });

  it('surfaces a refused claim and still reloads, because the place may have gone', async () => {
    jest.mocked(claimWaitlistPlace).mockRejectedValueOnce(new ApiResponseError(400, 'The place has been taken'));
    const { getByTestId } = render(<MyWaitlistsScreen />);
    await waitFor(() => expect(getByTestId('waitlist-claim-2')).toBeTruthy());
    fireEvent.press(getByTestId('waitlist-claim-2'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'The place has been taken', variant: 'danger' })));
    expect(getMyWaitlists).toHaveBeenCalledTimes(2);
  });

  it('asks before leaving, then leaves against the shift id', async () => {
    const { getByTestId } = render(<MyWaitlistsScreen />);
    await waitFor(() => expect(getByTestId('waitlist-leave-1')).toBeTruthy());
    fireEvent.press(getByTestId('waitlist-leave-1'));
    expect(leaveWaitlist).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Leave this waiting list?' }));
    const options = mockConfirm.mock.calls[0]![0] as { onConfirm: () => Promise<void> };
    await act(async () => { await options.onConfirm(); });
    expect(leaveWaitlist).toHaveBeenCalledWith(44);
  });

  it('shows the empty state when the member is on no list', async () => {
    jest.mocked(getMyWaitlists).mockResolvedValue({ data: [] });
    const { getByText } = render(<MyWaitlistsScreen />);
    await waitFor(() => expect(getByText('You are not on any waiting lists.')).toBeTruthy());
  });

  it('offers a retry when the list cannot be loaded', async () => {
    // 422, not 503: useApi retries a transient failure after two seconds, and the point
    // here is the surfaced failure, not the retry.
    jest.mocked(getMyWaitlists).mockRejectedValueOnce(new ApiResponseError(422, 'down'));
    const { getByTestId } = render(<MyWaitlistsScreen />);
    await waitFor(() => expect(getByTestId('waitlist-error')).toBeTruthy());
  });

  it('refuses the screen when the community has switched waiting lists off', () => {
    mockVolunteeringConfig = { 'volunteering.tab_waitlist': false };
    const { getByText } = render(<MyWaitlistsScreen />);
    expect(getByText('Not available in this community')).toBeTruthy();
    expect(getMyWaitlists).not.toHaveBeenCalled();
  });
});
