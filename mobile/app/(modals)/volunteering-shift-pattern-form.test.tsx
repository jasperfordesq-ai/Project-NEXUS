// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

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
    t: (key: string, opts?: Record<string, unknown>) => {
      const o = opts ?? {};
      const map: Record<string, string> = {
        'patternForm.newTitle': 'Add repeating shifts',
        'patternForm.editTitle': 'Change repeating shifts',
        'patternForm.eyebrow': 'Repeating shifts',
        'patternForm.intro': 'The individual shifts are created for you.',
        'patternForm.editIntro': 'Changes apply to upcoming shifts now.',
        'patternForm.frequencyLabel': 'Repeats',
        'patternForm.daysLabel': 'On these days',
        'patternForm.daysHint': 'Choose at least one day.',
        'patternForm.timesSection': 'Times and places',
        'patternForm.datesSection': 'When it runs',
        'patternForm.startLabel': 'Starts',
        'patternForm.endLabel': 'Ends',
        'patternForm.timePlaceholder': 'HH:MM',
        'patternForm.placesLabel': 'Places on each shift',
        'patternForm.startDateLabel': 'First shift on or after',
        'patternForm.endDateLabel': 'Last shift (optional)',
        'patternForm.datePlaceholder': 'YYYY-MM-DD',
        'patternForm.maxLabel': 'Stop after this many shifts (optional)',
        'patternForm.maxPlaceholder': 'No limit',
        'patternForm.required': 'Fill in the start date, start and end.',
        'patternForm.invalidDate': 'Enter dates as YYYY-MM-DD.',
        'patternForm.invalidTime': 'Enter times as HH:MM.',
        'patternForm.endBeforeStart': 'The shift must end after it starts.',
        'patternForm.endDateBeforeStart': 'The last shift must be on or after the first.',
        'patternForm.invalidPlaces': 'Enter a whole number of 1 or more.',
        'patternForm.daysRequired': 'Choose at least one day.',
        'patternForm.save': 'Save repeating shifts',
        'patternForm.created': `Repeating shifts set up. ${String(o.count ?? 0)} shifts created so far.`,
        'patternForm.updated': 'Repeating shifts updated.',
        'patternForm.reconciled': `Updated. Removed: ${String(o.removed)}, kept: ${String(o.kept)}, added: ${String(o.generated)}.`,
        'patternForm.saveFailed': 'Could not save the repeating shifts.',
        'patternForm.loadFailed': 'Could not load these repeating shifts.',
        'patternForm.notFound': 'These repeating shifts no longer exist.',
        'patternForm.reviewTitle': 'Ready to save?',
        'patternForm.reviewSubtitle': 'The first shifts are created as soon as you save.',
        'patternForm.reviewMissing': 'Fill in the start date, start and end before saving.',
        'patternForm.unsavedTitle': 'Discard?',
        'patternForm.unsavedMessage': 'Unsaved.',
        'patternForm.discard': 'Discard',
        'shifts.frequency.daily': 'Every day',
        'shifts.frequency.weekly': 'Every week',
        'shifts.frequency.biweekly': 'Every two weeks',
        'shifts.frequency.monthly': 'Every month',
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
  return {
    ...actual,
    createRecurringPattern: jest.fn(),
    updateRecurringPattern: jest.fn(),
    getRecurringPatterns: jest.fn(),
    todayDateOnly: () => '2099-03-01',
  };
});

import { createRecurringPattern, getRecurringPatterns, updateRecurringPattern } from '@/lib/api/volunteeringOrganiser';
import PatternForm from './volunteering-shift-pattern-form';

describe('PatternForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { opportunityId: '19' };
    jest.mocked(createRecurringPattern).mockResolvedValue({ data: { id: 7, shifts_generated: 4 } } as never);
    jest.mocked(updateRecurringPattern).mockResolvedValue({ data: { id: 7 } } as never);
  });

  it('🔴 refuses a weekly pattern with no chosen day — the server would refuse it too', async () => {
    const screen = render(<PatternForm />);
    fireEvent.changeText(screen.getByLabelText('Starts'), '09:00');
    fireEvent.changeText(screen.getByLabelText('Ends'), '11:00');
    fireEvent.press(screen.getByTestId('footer-submit'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Choose at least one day.', variant: 'warning' })));
    expect(createRecurringPattern).not.toHaveBeenCalled();
  });

  it('sends the chosen weekdays, sorted, with the website\'s clock-time format and reports the shifts created', async () => {
    const screen = render(<PatternForm />);
    fireEvent.changeText(screen.getByLabelText('Starts'), '9:00');
    fireEvent.changeText(screen.getByLabelText('Ends'), '11:00');
    fireEvent.changeText(screen.getByLabelText('Places on each shift'), '2');
    fireEvent.changeText(screen.getByLabelText('Last shift (optional)'), '2099-06-30');
    // Wednesday then Monday — the server wants them in order.
    fireEvent.press(screen.getByLabelText('Wednesday'));
    fireEvent.press(screen.getByLabelText('Monday'));
    fireEvent.press(screen.getByTestId('footer-submit'));

    await waitFor(() => expect(createRecurringPattern).toHaveBeenCalledWith(19, {
      frequency: 'weekly',
      days_of_week: [1, 3],
      start_time: '09:00:00',
      end_time: '11:00:00',
      capacity: 2,
      start_date: '2099-03-01',
      end_date: '2099-06-30',
      max_occurrences: null,
    }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Repeating shifts set up. 4 shifts created so far.' })));
    expect(mockBack).toHaveBeenCalled();
  });

  it('sends no weekdays at all for a daily pattern', async () => {
    const screen = render(<PatternForm />);
    fireEvent.press(screen.getByText('Every day'));
    expect(screen.queryByLabelText('Monday')).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Starts'), '09:00');
    fireEvent.changeText(screen.getByLabelText('Ends'), '11:00');
    fireEvent.press(screen.getByTestId('footer-submit'));

    await waitFor(() => expect(createRecurringPattern).toHaveBeenCalledTimes(1));
    expect(jest.mocked(createRecurringPattern).mock.calls[0]![1]).not.toHaveProperty('days_of_week');
    expect(jest.mocked(createRecurringPattern).mock.calls[0]![1]).toMatchObject({ frequency: 'daily', capacity: 1 });
  });

  it('refuses a last shift before the first', async () => {
    const screen = render(<PatternForm />);
    fireEvent.press(screen.getByText('Every day'));
    fireEvent.changeText(screen.getByLabelText('Starts'), '09:00');
    fireEvent.changeText(screen.getByLabelText('Ends'), '11:00');
    fireEvent.changeText(screen.getByLabelText('Last shift (optional)'), '2099-02-01');
    fireEvent.press(screen.getByTestId('footer-submit'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'The last shift must be on or after the first.' })));
    expect(createRecurringPattern).not.toHaveBeenCalled();
  });

  it('🔴 edits by pattern id and shows what the server did to the upcoming shifts', async () => {
    mockRouteParams = { opportunityId: '19', patternId: '7' };
    jest.mocked(getRecurringPatterns).mockResolvedValueOnce({
      data: { patterns: [{ id: 7, title: null, frequency: 'weekly', days_of_week: [1, 3], start_time: '10:00:00', end_time: '13:00:00', capacity: 4, start_date: '2099-03-01', end_date: null, max_occurrences: null, occurrences_generated: 2, is_active: true }] },
    });
    jest.mocked(updateRecurringPattern).mockResolvedValueOnce({ data: { id: 7, shifts_removed: 2, shifts_kept: 1, shifts_generated: 3 } } as never);
    const screen = render(<PatternForm />);
    expect(screen.getByTestId('pattern-form-loading')).toBeTruthy();

    await waitFor(() => expect(screen.getByLabelText('Starts').props.value).toBe('10:00'));
    expect(screen.getByLabelText('Wednesday').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Tuesday').props.accessibilityState.selected).toBe(false);

    fireEvent.press(screen.getByLabelText('Wednesday'));
    fireEvent.press(screen.getByLabelText('Friday'));
    fireEvent.press(screen.getByTestId('footer-submit'));

    await waitFor(() => expect(updateRecurringPattern).toHaveBeenCalledWith(7, expect.objectContaining({ days_of_week: [1, 5], frequency: 'weekly', capacity: 4 })));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Updated. Removed: 2, kept: 1, added: 3.' })));
    expect(createRecurringPattern).not.toHaveBeenCalled();
  });

  it('says so when the pattern is no longer there, with no live Save under it', async () => {
    mockRouteParams = { opportunityId: '19', patternId: '7' };
    jest.mocked(getRecurringPatterns).mockResolvedValueOnce({ data: { patterns: [] } });
    const screen = render(<PatternForm />);
    await waitFor(() => expect(screen.getByText('These repeating shifts no longer exist.')).toBeTruthy());
    expect(screen.queryByTestId('footer-submit')).toBeNull();
  });
});
