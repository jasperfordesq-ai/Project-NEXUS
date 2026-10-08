// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

let mockVolunteeringConfig: Record<string, unknown> = {};

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
}));
jest.mock('@/components/ui/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    visible ? <View testID="group-sheet">{children}</View> : null;
});
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'volunteeringVolunteer:group.title': 'Group sign-ups',
        'volunteeringVolunteer:group.intro': 'Reserve places on a shift for a group you run.',
        'volunteeringVolunteer:group.alpha': 'Early version.',
        'volunteeringVolunteer:group.empty': 'No group reservations yet.',
        'volunteeringVolunteer:group.reserve': 'Reserve places',
        'volunteeringVolunteer:group.leader': 'Leader',
        'volunteeringVolunteer:group.status.active': 'Active',
        'volunteeringVolunteer:group.status.confirmed': 'Confirmed',
        'volunteeringVolunteer:group.status.pending': 'Pending',
        'volunteeringVolunteer:group.status.cancelled': 'Cancelled',
        'volunteeringVolunteer:group.status.completed': 'Completed',
        'volunteeringVolunteer:group.members': `Members (${String(opts?.count ?? 0)}/${String(opts?.max ?? 0)})`,
        'volunteeringVolunteer:group.membersNoMax': `Members (${String(opts?.count ?? 0)})`,
        'volunteeringVolunteer:group.memberStatus.confirmed': 'Confirmed',
        'volunteeringVolunteer:group.memberStatus.cancelled': 'Cancelled',
        'volunteeringVolunteer:group.memberStatus.pending': 'Pending',
        'volunteeringVolunteer:group.memberStatus.declined': 'Declined',
        'volunteeringVolunteer:group.addMember': 'Add member',
        'volunteeringVolunteer:group.addMemberTitle': 'Add a member',
        'volunteeringVolunteer:group.searchPlaceholder': 'Search members by name…',
        'volunteeringVolunteer:group.searchHint': 'Type at least 2 letters.',
        'volunteeringVolunteer:group.searchEmpty': 'No members found.',
        'volunteeringVolunteer:group.searchError': 'Could not search members.',
        'volunteeringVolunteer:group.add': 'Add',
        'volunteeringVolunteer:group.addLabel': `Add ${String(opts?.name ?? '')} to the group`,
        'volunteeringVolunteer:group.addedTitle': 'Member added',
        'volunteeringVolunteer:group.addError': 'Could not add this member.',
        'volunteeringVolunteer:group.removeMember': 'Remove',
        'volunteeringVolunteer:group.removeLabel': `Remove ${String(opts?.name ?? '')} from the group`,
        'volunteeringVolunteer:group.removeConfirmTitle': `Remove ${String(opts?.name ?? '')}?`,
        'volunteeringVolunteer:group.removeConfirmMessage': 'They will lose their place.',
        'volunteeringVolunteer:group.removeError': 'Could not remove this member.',
        'volunteeringVolunteer:group.cancel': 'Cancel reservation',
        'volunteeringVolunteer:group.cancelConfirmTitle': 'Cancel this reservation?',
        'volunteeringVolunteer:group.cancelConfirmMessage': 'Every place will be released.',
        'volunteeringVolunteer:group.cancelError': 'Could not cancel this reservation.',
        'volunteeringVolunteer:group.cancelledTitle': 'Reservation cancelled',
        'volunteeringVolunteer:group.memberNotice': 'Only the group leader can take you off this reservation.',
        'volunteeringVolunteer:group.full': 'All places taken',
        'volunteeringVolunteer:group.created': `Reserved ${String(opts?.date ?? '')}`,
        'volunteeringVolunteer:group.reserveTitle': 'Reserve places',
        'volunteeringVolunteer:group.groupLabel': 'Group',
        'volunteeringVolunteer:group.noGroups': 'You do not run any groups, so you cannot reserve places.',
        'volunteeringVolunteer:group.opportunityLabel': 'Opportunity',
        'volunteeringVolunteer:group.shiftLabel': 'Shift',
        'volunteeringVolunteer:group.shiftsEmpty': 'This opportunity has no upcoming shifts.',
        'volunteeringVolunteer:group.shiftsError': 'Could not load the shifts.',
        'volunteeringVolunteer:group.slotsLabel': 'Number of places',
        'volunteeringVolunteer:group.notesLabel': 'Notes (optional)',
        'volunteeringVolunteer:group.reserveSubmit': 'Reserve',
        'volunteeringVolunteer:group.reserveValidation': 'Choose a group, shift, and number of places.',
        'volunteeringVolunteer:group.slotsInvalid': 'Enter a whole number of places (at least 1).',
        'volunteeringVolunteer:group.reservedTitle': 'Places reserved',
        'volunteeringVolunteer:group.reservedBody': 'Now add the people who are coming.',
        'volunteeringVolunteer:group.reserveError': 'Could not reserve these places.',
        'volunteeringVolunteer:group.optionsError': 'Could not load your groups and opportunities.',
        'volunteeringVolunteer:group.loadError': 'Could not load your group reservations.',
        'volunteeringVolunteer:group.spots': `${String(opts?.count ?? 0)} places free`,
        'volunteeringVolunteer:unavailable.title': 'Not available in this community',
        'volunteeringVolunteer:unavailable.body': 'Switched off here.',
        'volunteeringVolunteer:unavailable.back': 'Back to volunteering',
        'volunteeringVolunteer:common.timeRange': `${String(opts?.start ?? '')}–${String(opts?.end ?? '')}`,
        'volunteeringVolunteer:common.dateUnknown': 'Date unavailable',
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
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/Avatar', () => 'View');
const mockConfirm = jest.fn();
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({ confirm: (opts: unknown) => mockConfirm(opts), confirmDialog: null }),
}));
const mockShowToast = jest.fn();
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockShowToast, hide: jest.fn(), isToastVisible: false }),
}));
jest.mock('@/lib/api/members', () => ({ getMembers: jest.fn() }));
jest.mock('@/lib/api/volunteering', () => ({
  getOpportunities: jest.fn(),
  getOpportunityShifts: jest.fn(),
}));
jest.mock('@/lib/api/volunteeringVolunteer', () => ({
  ...jest.requireActual('@/lib/api/volunteeringVolunteer'),
  getGroupReservations: jest.fn(),
  getMyGroupsForReservation: jest.fn(),
  reserveGroupPlaces: jest.fn(),
  addGroupReservationMember: jest.fn(),
  removeGroupReservationMember: jest.fn(),
  cancelGroupReservation: jest.fn(),
}));

import MyGroupSignupsScreen from './volunteering-my-group-signups';
import {
  addGroupReservationMember,
  cancelGroupReservation,
  getGroupReservations,
  getMyGroupsForReservation,
  removeGroupReservationMember,
  reserveGroupPlaces,
} from '@/lib/api/volunteeringVolunteer';
import { getOpportunities, getOpportunityShifts } from '@/lib/api/volunteering';
import { getMembers } from '@/lib/api/members';
import { ApiResponseError } from '@/lib/api/client';

const led = {
  id: 8, group_name: 'Walking Club', status: 'active', is_leader: true,
  shift: { id: 44, start_time: '2026-11-07T09:00:00Z', end_time: '2026-11-07T12:00:00Z' },
  opportunity: { id: 10, title: 'Garden tidy', location: 'Dublin' },
  organization: { id: 4, name: 'Green Spaces', logo_url: null },
  members: [{ id: 21, name: 'Ada Member', avatar_url: null, status: 'confirmed' }],
  max_members: 3, created_at: '2026-10-01T10:00:00Z',
};
const joined = {
  ...led, id: 9, group_name: 'Choir', is_leader: false,
  members: [{ id: 7, name: 'Me', avatar_url: null, status: 'confirmed' }, { id: 22, name: 'Bo', avatar_url: null, status: 'confirmed' }],
  max_members: 2,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockVolunteeringConfig = { 'volunteering.tab_group_signups': true };
  jest.mocked(getGroupReservations).mockResolvedValue({ data: [led, joined] });
  jest.mocked(getMyGroupsForReservation).mockResolvedValue({ data: [{ id: 3, name: 'Walking Club', owner_id: 7 }, { id: 4, name: 'Not mine', viewer_membership: { role: 'member', status: 'active' } }] });
  jest.mocked(getOpportunities).mockResolvedValue({ data: [{ id: 10, title: 'Garden tidy' }], meta: { has_more: false, cursor: null } } as never);
  jest.mocked(getOpportunityShifts).mockResolvedValue({ data: [
    { id: 44, start_time: '2999-11-07T09:00:00Z', end_time: '2999-11-07T12:00:00Z', capacity: 10, signup_count: 2, spots_available: 8 },
    { id: 45, start_time: '2000-01-01T09:00:00Z', end_time: '2000-01-01T12:00:00Z', capacity: 10, signup_count: 2, spots_available: 8 },
  ] });
  jest.mocked(reserveGroupPlaces).mockResolvedValue({ data: { id: 12 } });
  jest.mocked(addGroupReservationMember).mockResolvedValue({ data: {} });
  jest.mocked(removeGroupReservationMember).mockResolvedValue(undefined);
  jest.mocked(cancelGroupReservation).mockResolvedValue(undefined);
  jest.mocked(getMembers).mockResolvedValue({ data: [{ id: 30, name: 'Cy Member', first_name: 'Cy', tagline: null }], meta: { total_items: 1, per_page: 20, offset: 0, has_more: false } } as never);
});

describe('MyGroupSignupsScreen', () => {
  it('🔴 is refused by default: the switch is off unless the community opted in', () => {
    mockVolunteeringConfig = {};
    const { getByText } = render(<MyGroupSignupsScreen />);
    expect(getByText('Not available in this community')).toBeTruthy();
    expect(getGroupReservations).not.toHaveBeenCalled();
  });

  it('lists reservations; leader tools only on the ones the member leads', async () => {
    const { getByText, getByTestId, queryByTestId } = render(<MyGroupSignupsScreen />);
    await waitFor(() => expect(getByText('Walking Club')).toBeTruthy());
    expect(getByText('Members (1/3)')).toBeTruthy();
    expect(getByTestId('group-add-member-8')).toBeTruthy();
    expect(getByTestId('group-cancel-8')).toBeTruthy();
    expect(queryByTestId('group-add-member-9')).toBeNull();
    expect(queryByTestId('group-cancel-9')).toBeNull();
    // No "leave": the server has no such endpoint and refuses a member removing themselves.
    expect(queryByTestId('group-leave-9')).toBeNull();
    expect(getByText('Only the group leader can take you off this reservation.')).toBeTruthy();
  });

  it('reserves places on a future shift for a group the member runs', async () => {
    const { getByTestId, queryByTestId } = render(<MyGroupSignupsScreen />);
    await waitFor(() => expect(getByTestId('group-reserve')).toBeTruthy());
    fireEvent.press(getByTestId('group-reserve'));
    await waitFor(() => expect(getByTestId('group-pick-group-3')).toBeTruthy());
    // The group the member merely belongs to is not offered.
    expect(queryByTestId('group-pick-group-4')).toBeNull();
    fireEvent.press(getByTestId('group-pick-group-3'));
    fireEvent.press(getByTestId('group-pick-opportunity-10'));
    await waitFor(() => expect(getOpportunityShifts).toHaveBeenCalledWith(10));
    await waitFor(() => expect(getByTestId('group-pick-shift-44')).toBeTruthy());
    // The shift in the past is not offered.
    expect(queryByTestId('group-pick-shift-45')).toBeNull();
    fireEvent.press(getByTestId('group-pick-shift-44'));
    fireEvent.changeText(getByTestId('group-slots'), '4');
    fireEvent.changeText(getByTestId('group-notes'), 'Bring gloves');
    fireEvent.press(getByTestId('group-reserve-submit'));
    await waitFor(() => expect(reserveGroupPlaces).toHaveBeenCalledWith(44, { group_id: 3, reserved_slots: 4, notes: 'Bring gloves' }));
    await waitFor(() => expect(getGroupReservations).toHaveBeenCalledTimes(2));
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Places reserved' }));
  });

  it('refuses a reservation with no shift chosen or a bad number of places', async () => {
    const { getByTestId } = render(<MyGroupSignupsScreen />);
    await waitFor(() => expect(getByTestId('group-reserve')).toBeTruthy());
    fireEvent.press(getByTestId('group-reserve'));
    await waitFor(() => expect(getByTestId('group-pick-group-3')).toBeTruthy());
    fireEvent.press(getByTestId('group-reserve-submit'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Choose a group, shift, and number of places.' })));
    fireEvent.press(getByTestId('group-pick-group-3'));
    fireEvent.press(getByTestId('group-pick-opportunity-10'));
    await waitFor(() => expect(getByTestId('group-pick-shift-44')).toBeTruthy());
    fireEvent.press(getByTestId('group-pick-shift-44'));
    fireEvent.changeText(getByTestId('group-slots'), '0');
    fireEvent.press(getByTestId('group-reserve-submit'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Enter a whole number of places (at least 1).' })));
    expect(reserveGroupPlaces).not.toHaveBeenCalled();
  });

  it('adds a member found by name', async () => {
    const { getByTestId } = render(<MyGroupSignupsScreen />);
    await waitFor(() => expect(getByTestId('group-add-member-8')).toBeTruthy());
    fireEvent.press(getByTestId('group-add-member-8'));
    await waitFor(() => expect(getByTestId('group-member-search')).toBeTruthy());
    fireEvent.changeText(getByTestId('group-member-search'), 'Cy');
    await waitFor(() => expect(getMembers).toHaveBeenCalledWith(0, 'Cy'));
    await waitFor(() => expect(getByTestId('group-member-pick-30')).toBeTruthy());
    fireEvent.press(getByTestId('group-member-pick-30'));
    await waitFor(() => expect(addGroupReservationMember).toHaveBeenCalledWith(8, 30));
    await waitFor(() => expect(getGroupReservations).toHaveBeenCalledTimes(2));
  });

  it('asks before removing a member, then removes them', async () => {
    const { getByTestId } = render(<MyGroupSignupsScreen />);
    await waitFor(() => expect(getByTestId('group-remove-8-21')).toBeTruthy());
    fireEvent.press(getByTestId('group-remove-8-21'));
    expect(removeGroupReservationMember).not.toHaveBeenCalled();
    const options = mockConfirm.mock.calls[0]![0] as { title: string; onConfirm: () => Promise<void> };
    expect(options.title).toBe('Remove Ada Member?');
    await act(async () => { await options.onConfirm(); });
    expect(removeGroupReservationMember).toHaveBeenCalledWith(8, 21);
  });

  it('asks before cancelling, then cancels', async () => {
    const { getByTestId } = render(<MyGroupSignupsScreen />);
    await waitFor(() => expect(getByTestId('group-cancel-8')).toBeTruthy());
    fireEvent.press(getByTestId('group-cancel-8'));
    const options = mockConfirm.mock.calls[0]![0] as { title: string; onConfirm: () => Promise<void> };
    expect(options.title).toBe('Cancel this reservation?');
    await act(async () => { await options.onConfirm(); });
    expect(cancelGroupReservation).toHaveBeenCalledWith(8);
  });

  it('shows the server\'s refusal when a reservation is declined', async () => {
    jest.mocked(reserveGroupPlaces).mockRejectedValueOnce(new ApiResponseError(409, 'Already reserved for this shift'));
    const { getByTestId } = render(<MyGroupSignupsScreen />);
    await waitFor(() => expect(getByTestId('group-reserve')).toBeTruthy());
    fireEvent.press(getByTestId('group-reserve'));
    await waitFor(() => expect(getByTestId('group-pick-group-3')).toBeTruthy());
    fireEvent.press(getByTestId('group-pick-group-3'));
    fireEvent.press(getByTestId('group-pick-opportunity-10'));
    await waitFor(() => expect(getByTestId('group-pick-shift-44')).toBeTruthy());
    fireEvent.press(getByTestId('group-pick-shift-44'));
    fireEvent.press(getByTestId('group-reserve-submit'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Already reserved for this shift', variant: 'danger' })));
  });

  it('shows the empty state and a retry on failure', async () => {
    jest.mocked(getGroupReservations).mockResolvedValueOnce({ data: [] });
    const { getByText, unmount } = render(<MyGroupSignupsScreen />);
    await waitFor(() => expect(getByText('No group reservations yet.')).toBeTruthy());
    unmount();
    jest.mocked(getGroupReservations).mockRejectedValueOnce(new ApiResponseError(422, 'down'));
    const { getByTestId } = render(<MyGroupSignupsScreen />);
    await waitFor(() => expect(getByTestId('group-error')).toBeTruthy());
  });
});
