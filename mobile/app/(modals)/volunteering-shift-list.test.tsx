// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import * as ReactNative from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiResponseError } from '@/lib/api/client';

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

const mockPush = jest.fn();
let mockRouteParams: Record<string, string> = { opportunityId: '19', title: 'Garden Helper' };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: (...args: unknown[]) => mockPush(...args), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockRouteParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const o = opts ?? {};
      const map: Record<string, string> = {
        'shifts.title': 'Shifts',
        'shifts.intro': 'Volunteers sign up to a shift once approved.',
        'shifts.addShift': 'Add a shift',
        'shifts.addRepeating': 'Add repeating shifts',
        'shifts.loadError': 'Could not load the shifts.',
        'shifts.notYoursTitle': 'You do not manage this opportunity',
        'shifts.notYoursHint': 'Only the people who run it can see its shifts.',
        'shifts.upcomingHeading': 'Upcoming shifts',
        'shifts.noUpcoming': 'No upcoming shifts yet.',
        'shifts.showPast': `Show ${String(o.count ?? 0)} past shifts`,
        'shifts.hidePast': 'Hide past shifts',
        'shifts.signedUp': `Signed up: ${String(o.n ?? 0)}`,
        'shifts.placesOf': `${String(o.taken ?? 0)} of ${String(o.capacity ?? 0)} places taken`,
        'shifts.placesPerShift': `${String(o.count ?? 0)} places per shift`,
        'shifts.repeatingChip': 'Repeating',
        'shifts.startedChip': 'Started',
        'shifts.roster': "Who's coming",
        'shifts.rosterLabel': `See who is coming on ${String(o.shift ?? '')}`,
        'shifts.edit': 'Edit',
        'shifts.editLabel': `Change the shift on ${String(o.shift ?? '')}`,
        'shifts.remove': 'Remove',
        'shifts.removeLabel': `Remove the shift on ${String(o.shift ?? '')}`,
        'shifts.removeTitle': 'Remove this shift?',
        'shifts.removeBody': `${String(o.count ?? 0)} volunteers hold a place on it.`,
        'shifts.removeBodyNone': 'Nobody is signed up to it yet.',
        'shifts.removeConfirm': 'Remove shift',
        'shifts.removed': 'Shift removed.',
        'shifts.removedAffected': `Shift removed. ${String(o.count ?? 0)} volunteers have been told.`,
        'shifts.removeFailed': 'Could not remove the shift.',
        'shifts.patternsHeading': 'Repeating shifts',
        'shifts.patternEdit': 'Change',
        'shifts.patternEditLabel': `Change the repeating shifts: ${String(o.pattern ?? '')}`,
        'shifts.stopPattern': 'Stop repeating',
        'shifts.stopPatternLabel': `Stop the repeating shifts: ${String(o.pattern ?? '')}`,
        'shifts.stopTitle': 'Stop these repeating shifts?',
        'shifts.stopBody': 'Upcoming shifts will be removed.',
        'shifts.stopConfirm': 'Stop and remove upcoming shifts',
        'shifts.patternStopped': `Repeating shifts stopped. ${String(o.count ?? 0)} upcoming shifts removed.`,
        'shifts.stopFailed': 'Could not stop the repeating shifts.',
        'shifts.frequency.daily': 'Every day',
        'shifts.frequency.weekly': 'Every week',
        'shifts.frequency.biweekly': 'Every two weeks',
        'shifts.frequency.monthly': 'Every month',
        'shifts.until': `Until ${String(o.date ?? '')}`,
        'common:back': 'Back',
        'common:buttons.cancel': 'Cancel',
        'common:buttons.retry': 'Retry',
        'common:errors.alertTitle': 'Error',
        'common:errors.notFound': 'Not found.',
        'common:errors.refreshFailedTitle': 'Couldn’t refresh',
        'common:errors.refreshFailedSubtitle': 'You’re still seeing what loaded earlier.',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { id: 2, slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', surface: '#f8f9fa', text: '#111', textSecondary: '#666', textMuted: '#999', error: '#dc2626', errorBg: '#fee2e2', success: '#16a34a', warning: '#f59e0b', border: '#ddd' }),
}));
jest.mock('@/components/ui/ConfirmDialog', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({ visible, title, message, cancelLabel, confirmLabel, cancelTestID, confirmTestID, onClose, onConfirm }: Record<string, unknown>) =>
      visible ? (
        <View>
          <Text>{title as string}</Text>
          <Text>{message as string}</Text>
          <Pressable testID={cancelTestID as string} onPress={onClose as () => void}><Text>{cancelLabel as string}</Text></Pressable>
          <Pressable testID={confirmTestID as string} onPress={onConfirm as () => void}><Text>{confirmLabel as string}</Text></Pressable>
        </View>
      ) : null,
  };
});
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});
const { show: mockShowToast } = (jest.requireMock('@/components/ui/AppToast') as { useAppToast: () => { show: jest.Mock } }).useAppToast();

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({ useApi: (...args: unknown[]) => mockUseApi(...args) }));

jest.mock('@/lib/api/volunteeringOrganiser', () => {
  const actual = jest.requireActual('@/lib/api/volunteeringOrganiser');
  return {
    ...actual,
    // Each fetcher answers with a TAG so the useApi mock can tell them apart whatever the call order.
    getManagedShifts: jest.fn(() => 'shifts'),
    getRecurringPatterns: jest.fn(() => 'patterns'),
    deleteShift: jest.fn(),
    deactivateRecurringPattern: jest.fn(),
  };
});

import { deactivateRecurringPattern, deleteShift } from '@/lib/api/volunteeringOrganiser';
import ShiftList from './volunteering-shift-list';

type ApiState = { data: unknown; isLoading: boolean; error: string | null; errorStatus: number | null; errorCode: string | null; refresh: jest.Mock };
const ok = (data: unknown, refresh = jest.fn()): ApiState => ({ data, isLoading: false, error: null, errorStatus: null, errorCode: null, refresh });

const FUTURE = '2099-03-15 10:00:00';
const FUTURE_END = '2099-03-15 13:00:00';
const PAST = '2001-01-05 09:00:00';
const PAST_END = '2001-01-05 11:00:00';

function mockApis(states: Partial<Record<'shifts' | 'patterns', ApiState>> = {}) {
  const defaults: Record<string, ApiState> = {
    shifts: ok({
      data: [
        { id: 44, start_time: FUTURE, end_time: FUTURE_END, capacity: 4, signup_count: 1, reserved_count: 1, spots_available: 2, recurring_pattern_id: 7 },
        { id: 45, start_time: PAST, end_time: PAST_END, capacity: null, signup_count: 3, spots_available: null, recurring_pattern_id: null },
      ],
    }),
    patterns: ok({
      data: {
        patterns: [
          { id: 7, title: null, frequency: 'weekly', days_of_week: [1, 3], start_time: '10:00:00', end_time: '13:00:00', capacity: 4, start_date: '2099-03-01', end_date: '2099-06-30', max_occurrences: null, occurrences_generated: 2, is_active: true },
          { id: 8, title: null, frequency: 'daily', days_of_week: [], start_time: '08:00:00', end_time: '09:00:00', capacity: 1, start_date: '2099-03-01', end_date: null, max_occurrences: null, occurrences_generated: 0, is_active: false },
        ],
      },
    }),
  };
  mockUseApi.mockImplementation((fetchFn: () => unknown, _deps: unknown[], options?: { enabled?: boolean }) => {
    if (options?.enabled === false) return ok(null);
    const tag = fetchFn() as string;
    return states[tag as 'shifts'] ?? defaults[tag];
  });
}

describe('ShiftList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { opportunityId: '19', title: 'Garden Helper' };
    mockApis();
  });

  it('lists upcoming shifts with their places, keeps past ones behind a toggle, and shows the active patterns', () => {
    const screen = render(<ShiftList />);

    expect(screen.getByTestId('managed-shift-44')).toBeTruthy();
    expect(screen.getByText('2 of 4 places taken')).toBeTruthy();
    expect(screen.getByText('Repeating')).toBeTruthy();
    expect(screen.queryByTestId('managed-shift-45')).toBeNull();

    fireEvent.press(screen.getByTestId('shift-list-toggle-past'));
    expect(screen.getByTestId('managed-shift-45')).toBeTruthy();
    expect(screen.getByText('Signed up: 3')).toBeTruthy();
    // A started shift can only be looked at, not changed or removed.
    expect(screen.queryByTestId('managed-shift-45-edit')).toBeNull();
    expect(screen.queryByTestId('managed-shift-45-remove')).toBeNull();

    expect(screen.getByTestId('managed-pattern-7')).toBeTruthy();
    expect(screen.queryByTestId('managed-pattern-8')).toBeNull();
    expect(screen.getByText('4 places per shift', { exact: false })).toBeTruthy();
  });

  it('opens the add, edit, repeating and roster screens for this opportunity', () => {
    const screen = render(<ShiftList />);

    fireEvent.press(screen.getByTestId('shift-list-add'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/(modals)/volunteering-shift-form', params: { opportunityId: '19' } });
    fireEvent.press(screen.getByTestId('managed-shift-44-edit'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/(modals)/volunteering-shift-form', params: { opportunityId: '19', shiftId: '44' } });
    fireEvent.press(screen.getByTestId('shift-list-add-repeating'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/(modals)/volunteering-shift-pattern-form', params: { opportunityId: '19' } });
    fireEvent.press(screen.getByTestId('managed-pattern-7-edit'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/(modals)/volunteering-shift-pattern-form', params: { opportunityId: '19', patternId: '7' } });
    fireEvent.press(screen.getByTestId('managed-shift-44-roster'));
    expect(mockPush).toHaveBeenLastCalledWith(expect.objectContaining({
      pathname: '/(modals)/volunteering-shift-roster',
      params: expect.objectContaining({ shiftId: '44', started: '0' }),
    }));
  });

  it('🔴 removes a shift only after the organiser confirms, and says how many volunteers were told', async () => {
    const refresh = jest.fn();
    mockApis({ shifts: ok({ data: [{ id: 44, start_time: FUTURE, end_time: FUTURE_END, capacity: 4, signup_count: 2, spots_available: 2 }] }, refresh) });
    jest.mocked(deleteShift).mockResolvedValueOnce({ data: { deleted: true, affected_volunteers: 2 } });
    const screen = render(<ShiftList />);

    fireEvent.press(screen.getByTestId('managed-shift-44-remove'));
    expect(deleteShift).not.toHaveBeenCalled();
    expect(screen.getByText('2 volunteers hold a place on it.', { exact: false })).toBeTruthy();

    await act(async () => { fireEvent.press(screen.getByTestId('shift-remove-confirm')); });
    expect(deleteShift).toHaveBeenCalledWith(44);
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Shift removed. 2 volunteers have been told.' })));
    expect(refresh).toHaveBeenCalled();
  });

  it('shows the server\'s own refusal when a shift cannot be removed', async () => {
    jest.mocked(deleteShift).mockRejectedValueOnce(new ApiResponseError(422, 'This shift has already started.', undefined, 'VALIDATION_ERROR'));
    const screen = render(<ShiftList />);

    fireEvent.press(screen.getByTestId('managed-shift-44-remove'));
    await act(async () => { fireEvent.press(screen.getByTestId('shift-remove-confirm')); });

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'This shift has already started.', variant: 'danger' })));
  });

  it('stops a repeating pattern after confirmation and reports the upcoming shifts removed', async () => {
    jest.mocked(deactivateRecurringPattern).mockResolvedValueOnce({ data: { future_shifts_removed: 3 } });
    const screen = render(<ShiftList />);

    fireEvent.press(screen.getByTestId('managed-pattern-7-stop'));
    expect(deactivateRecurringPattern).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByTestId('pattern-stop-confirm')); });

    expect(deactivateRecurringPattern).toHaveBeenCalledWith(7);
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Repeating shifts stopped. 3 upcoming shifts removed.' })));
  });

  it('hides the repeating half quietly when the community has it switched off', () => {
    mockApis({ patterns: { data: null, isLoading: false, error: 'Disabled', errorStatus: 403, errorCode: 'FEATURE_DISABLED', refresh: jest.fn() } });
    const screen = render(<ShiftList />);
    expect(screen.queryByTestId('shift-list-add-repeating')).toBeNull();
    expect(screen.queryByText('Repeating shifts')).toBeNull();
    expect(screen.getByTestId('managed-shift-44')).toBeTruthy();
  });

  it('says the opportunity is not theirs instead of offering a retry that cannot work', () => {
    mockApis({ shifts: { data: null, isLoading: false, error: 'Forbidden', errorStatus: 403, errorCode: 'FORBIDDEN', refresh: jest.fn() } });
    const screen = render(<ShiftList />);
    expect(screen.getByTestId('shift-list-refused')).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('offers a retry on a load failure and never claims there are no shifts', () => {
    const refresh = jest.fn();
    mockApis({ shifts: { data: null, isLoading: false, error: 'Network down', errorStatus: 500, errorCode: null, refresh } });
    const screen = render(<ShiftList />);
    expect(screen.getByTestId('shift-list-error')).toBeTruthy();
    expect(screen.queryByTestId('shift-list-empty')).toBeNull();
    fireEvent.press(screen.getByText('Retry'));
    expect(refresh).toHaveBeenCalled();
  });

  it('stacks the shift actions at large text', () => {
    const dimensions = jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({ width: 360, height: 800, scale: 1, fontScale: 2 });
    const screen = render(<ShiftList />);
    expect(screen.getByTestId('managed-shift-44-actions').props.className).not.toContain('flex-row');
    dimensions.mockRestore();
  });
});
