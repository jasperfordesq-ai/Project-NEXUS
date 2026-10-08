// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiResponseError } from '@/lib/api/client';

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

const mockBack = jest.fn();
let mockRouteParams: Record<string, string> = { opportunityId: '19' };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: () => mockBack(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockRouteParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'shiftForm.newTitle': 'Add a shift',
        'shiftForm.editTitle': 'Change this shift',
        'shiftForm.eyebrow': 'Shift',
        'shiftForm.subtitle': 'Approved volunteers can book a place.',
        'shiftForm.editSubtitle': 'Changes only apply before the shift starts.',
        'shiftForm.dateLabel': 'Date',
        'shiftForm.datePlaceholder': 'YYYY-MM-DD',
        'shiftForm.startLabel': 'Starts',
        'shiftForm.endLabel': 'Ends',
        'shiftForm.timePlaceholder': 'HH:MM',
        'shiftForm.placesLabel': 'Places',
        'shiftForm.placesPlaceholder': 'No limit',
        'shiftForm.placesHint': 'Leave blank for no limit.',
        'shiftForm.required': 'Fill in the date, start and end.',
        'shiftForm.invalidDate': 'Enter the date as YYYY-MM-DD.',
        'shiftForm.invalidTime': 'Enter times as HH:MM, for example 09:30.',
        'shiftForm.endBeforeStart': 'The shift must end after it starts.',
        'shiftForm.invalidPlaces': 'Enter a whole number of 1 or more.',
        'shiftForm.save': 'Save shift',
        'shiftForm.created': 'Shift added.',
        'shiftForm.updated': 'Shift updated.',
        'shiftForm.saveFailed': 'Could not save the shift.',
        'shiftForm.loadFailed': 'Could not load this shift.',
        'shiftForm.notFound': 'This shift no longer exists.',
        'shiftForm.reviewTitle': 'Ready to save?',
        'shiftForm.reviewSubtitle': 'The shift is shown to approved volunteers straight away.',
        'shiftForm.reviewMissing': 'Fill in the date, start and end before saving.',
        'shiftForm.unsavedTitle': 'Discard this shift?',
        'shiftForm.unsavedMessage': 'You have unsaved details.',
        'shiftForm.discard': 'Discard',
        'common:back': 'Back',
        'common:buttons.cancel': 'Cancel',
        'common:buttons.retry': 'Retry',
        'common:errors.alertTitle': 'Error',
        'common:errors.notFound': 'Not found.',
        'common:errors.notAvailableTitle': 'Not available to you',
        'common:errors.notAvailableHint': 'This may have been removed.',
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
  useTheme: () => ({ bg: '#fff', surface: '#f8f9fa', text: '#111', textSecondary: '#666', textMuted: '#999', error: '#dc2626', success: '#16a34a', warning: '#f59e0b', border: '#ddd' }),
}));
jest.mock('@/components/ui/useConfirm', () => ({ useConfirm: () => ({ confirm: jest.fn(), confirmDialog: null }) }));
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});
const { show: mockShowToast } = (jest.requireMock('@/components/ui/AppToast') as { useAppToast: () => { show: jest.Mock } }).useAppToast();
jest.mock('@/components/ui/FormActionFooter', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return function MockFormActionFooter({ subtitle, submitLabel, onSubmit, isDisabled }: { subtitle: string; submitLabel: string; onSubmit: () => void; isDisabled?: boolean }) {
    return (
      <View>
        <Text>{subtitle}</Text>
        <Pressable accessibilityRole="button" testID="footer-submit" accessibilityState={{ disabled: !!isDisabled }} disabled={isDisabled} onPress={onSubmit}>
          <Text>{submitLabel}</Text>
        </Pressable>
      </View>
    );
  };
});

jest.mock('@/lib/api/volunteeringOrganiser', () => {
  const actual = jest.requireActual('@/lib/api/volunteeringOrganiser');
  return { ...actual, createShift: jest.fn(), updateShift: jest.fn(), getManagedShifts: jest.fn() };
});

import { createShift, getManagedShifts, updateShift } from '@/lib/api/volunteeringOrganiser';
import ShiftForm from './volunteering-shift-form';

function fill(screen: ReturnType<typeof render>, values: { date?: string; start?: string; end?: string; places?: string }) {
  if (values.date !== undefined) fireEvent.changeText(screen.getByLabelText('Date'), values.date);
  if (values.start !== undefined) fireEvent.changeText(screen.getByLabelText('Starts'), values.start);
  if (values.end !== undefined) fireEvent.changeText(screen.getByLabelText('Ends'), values.end);
  if (values.places !== undefined) fireEvent.changeText(screen.getByLabelText('Places'), values.places);
}

describe('ShiftForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { opportunityId: '19' };
    jest.mocked(createShift).mockResolvedValue({ data: { id: 50 } } as never);
    jest.mocked(updateShift).mockResolvedValue({ data: { id: 44 } } as never);
  });

  it('keeps Save disabled until the date, start and end are filled in', () => {
    const screen = render(<ShiftForm />);
    expect(screen.getByTestId('footer-submit').props.accessibilityState.disabled).toBe(true);
    fill(screen, { date: '2099-03-15', start: '10:00', end: '13:00' });
    expect(screen.getByTestId('footer-submit').props.accessibilityState.disabled).toBe(false);
  });

  it.each([
    ['an end before the start', { date: '2099-03-15', start: '13:00', end: '10:00' }, 'The shift must end after it starts.'],
    ['a date that is not a date', { date: '2099-02-31', start: '10:00', end: '13:00' }, 'Enter the date as YYYY-MM-DD.'],
    ['a time that is not a time', { date: '2099-03-15', start: 'ten', end: '13:00' }, 'Enter times as HH:MM, for example 09:30.'],
    ['places below one', { date: '2099-03-15', start: '10:00', end: '13:00', places: '0' }, 'Enter a whole number of 1 or more.'],
  ])('refuses %s before anything is sent', async (_label, values, message) => {
    const screen = render(<ShiftForm />);
    fill(screen, values);
    fireEvent.press(screen.getByTestId('footer-submit'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: message, variant: 'warning' })));
    expect(createShift).not.toHaveBeenCalled();
  });

  it('🔴 sends the website\'s exact payload: local wall-clock times, and null places for no limit', async () => {
    const screen = render(<ShiftForm />);
    fill(screen, { date: '2099-03-15', start: '9:30', end: '13:00' });
    fireEvent.press(screen.getByTestId('footer-submit'));

    await waitFor(() => expect(createShift).toHaveBeenCalledWith(19, { start_time: '2099-03-15 09:30:00', end_time: '2099-03-15 13:00:00', capacity: null }));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Shift added.', variant: 'success' }));
  });

  it('loads the shift being edited from the opportunity\'s list and sends the changed places', async () => {
    mockRouteParams = { opportunityId: '19', shiftId: '44' };
    jest.mocked(getManagedShifts).mockResolvedValueOnce({
      data: [{ id: 44, start_time: '2099-03-15 10:00:00', end_time: '2099-03-15 13:00:00', capacity: 4, signup_count: 1, spots_available: 3 }],
    });
    const screen = render(<ShiftForm />);
    expect(screen.getByTestId('shift-form-loading')).toBeTruthy();

    await waitFor(() => expect(screen.getByLabelText('Date').props.value).toBe('2099-03-15'));
    expect(screen.getByLabelText('Starts').props.value).toBe('10:00');
    expect(screen.getByLabelText('Places').props.value).toBe('4');

    fill(screen, { places: '6' });
    fireEvent.press(screen.getByTestId('footer-submit'));
    await waitFor(() => expect(updateShift).toHaveBeenCalledWith(44, { start_time: '2099-03-15 10:00:00', end_time: '2099-03-15 13:00:00', capacity: 6 }));
    expect(createShift).not.toHaveBeenCalled();
  });

  it('shows the server\'s refusal in its own words when a change is not allowed', async () => {
    mockRouteParams = { opportunityId: '19', shiftId: '44' };
    jest.mocked(getManagedShifts).mockResolvedValueOnce({
      data: [{ id: 44, start_time: '2099-03-15 10:00:00', end_time: '2099-03-15 13:00:00', capacity: 4, signup_count: 3, spots_available: 1 }],
    });
    jest.mocked(updateShift).mockRejectedValueOnce(new ApiResponseError(422, 'Places cannot be fewer than the 3 already taken.', undefined, 'VALIDATION_ERROR'));
    const screen = render(<ShiftForm />);
    await waitFor(() => expect(screen.getByLabelText('Places').props.value).toBe('4'));

    fill(screen, { places: '2' });
    fireEvent.press(screen.getByTestId('footer-submit'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Places cannot be fewer than the 3 already taken.', variant: 'danger' })));
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('🔴 never shows an empty form under a live Save when the shift could not be loaded', async () => {
    mockRouteParams = { opportunityId: '19', shiftId: '44' };
    jest.mocked(getManagedShifts).mockRejectedValueOnce(new ApiResponseError(403, 'Forbidden', undefined, 'FORBIDDEN'));
    const screen = render(<ShiftForm />);
    await waitFor(() => expect(screen.getByTestId('shift-form-load-failed')).toBeTruthy());
    expect(screen.getByText('Not available to you')).toBeTruthy();
    expect(screen.queryByTestId('footer-submit')).toBeNull();
  });

  it('says so when the shift is no longer in the list', async () => {
    mockRouteParams = { opportunityId: '19', shiftId: '44' };
    jest.mocked(getManagedShifts).mockResolvedValueOnce({ data: [] });
    const screen = render(<ShiftForm />);
    await waitFor(() => expect(screen.getByText('This shift no longer exists.')).toBeTruthy());
  });
});
