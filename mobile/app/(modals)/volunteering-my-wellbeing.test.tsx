// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

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
        'volunteeringVolunteer:wellbeing.title': 'Wellbeing',
        'volunteeringVolunteer:wellbeing.intro': 'A quick check on how volunteering is going for you.',
        'volunteeringVolunteer:wellbeing.score': 'Wellbeing score',
        'volunteeringVolunteer:wellbeing.scoreOutOf': `${String(opts?.score ?? '')}/100 · ${String(opts?.label ?? '')}`,
        'volunteeringVolunteer:wellbeing.scoreLabels.excellent': 'Excellent',
        'volunteeringVolunteer:wellbeing.scoreLabels.good': 'Good',
        'volunteeringVolunteer:wellbeing.scoreLabels.fair': 'Fair',
        'volunteeringVolunteer:wellbeing.scoreLabels.attention': 'Needs attention',
        'volunteeringVolunteer:wellbeing.scoreLabels.critical': 'Critical',
        'volunteeringVolunteer:wellbeing.thisWeek': 'This week',
        'volunteeringVolunteer:wellbeing.thisMonth': 'This month',
        'volunteeringVolunteer:wellbeing.streak': 'Day streak',
        'volunteeringVolunteer:wellbeing.hours': `${String(opts?.count ?? 0)}h`,
        'volunteeringVolunteer:wellbeing.risk.low': 'Low risk',
        'volunteeringVolunteer:wellbeing.risk.moderate': 'Moderate risk',
        'volunteeringVolunteer:wellbeing.risk.high': 'High risk',
        'volunteeringVolunteer:wellbeing.warningsHeading': 'Things to watch',
        'volunteeringVolunteer:wellbeing.restDays': 'Suggested rest days',
        'volunteeringVolunteer:wellbeing.checkinHeading': 'How are you feeling today?',
        'volunteeringVolunteer:wellbeing.moods.struggling': 'Struggling',
        'volunteeringVolunteer:wellbeing.moods.low': 'Low',
        'volunteeringVolunteer:wellbeing.moods.okay': 'Okay',
        'volunteeringVolunteer:wellbeing.moods.good': 'Good',
        'volunteeringVolunteer:wellbeing.moods.great': 'Great',
        'volunteeringVolunteer:wellbeing.moodLabel': `Mood: ${String(opts?.label ?? '')}`,
        'volunteeringVolunteer:wellbeing.noteLabel': 'Add a note (optional)',
        'volunteeringVolunteer:wellbeing.notePlaceholder': "How's your energy level?",
        'volunteeringVolunteer:wellbeing.shareLabel': 'Let someone get in touch with me',
        'volunteeringVolunteer:wellbeing.shareOn': 'Your community team will see this.',
        'volunteeringVolunteer:wellbeing.shareOff': 'Only you will see this check-in.',
        'volunteeringVolunteer:wellbeing.submit': 'Record check-in',
        'volunteeringVolunteer:wellbeing.recordedTitle': 'Check-in recorded',
        'volunteeringVolunteer:wellbeing.recorded': 'Mood check-in recorded.',
        'volunteeringVolunteer:wellbeing.teamNotified': 'Thank you for telling us. Someone will be in touch.',
        'volunteeringVolunteer:wellbeing.submitError': 'Could not record this check-in.',
        'volunteeringVolunteer:wellbeing.historyHeading': 'Recent check-ins',
        'volunteeringVolunteer:wellbeing.historyEmpty': 'No check-ins yet.',
        'volunteeringVolunteer:wellbeing.shared': 'Shared with your community team',
        'volunteeringVolunteer:wellbeing.lowScoreTitle': 'You might need a break',
        'volunteeringVolunteer:wellbeing.lowScoreBody': 'It is fine to say no to a shift.',
        'volunteeringVolunteer:wellbeing.loadError': 'Could not load your wellbeing summary.',
        'volunteeringVolunteer:unavailable.title': 'Not available in this community',
        'volunteeringVolunteer:unavailable.body': 'Switched off here.',
        'volunteeringVolunteer:unavailable.back': 'Back to volunteering',
        'volunteeringVolunteer:common.dateUnknown': 'Date unavailable',
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
const mockShowToast = jest.fn();
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockShowToast, hide: jest.fn(), isToastVisible: false }),
}));
jest.mock('@/lib/api/volunteeringVolunteer', () => ({
  ...jest.requireActual('@/lib/api/volunteeringVolunteer'),
  getWellbeing: jest.fn(),
  submitWellbeingCheckin: jest.fn(),
}));

import MyWellbeingScreen from './volunteering-my-wellbeing';
import { getWellbeing, submitWellbeingCheckin } from '@/lib/api/volunteeringVolunteer';
import { ApiResponseError } from '@/lib/api/client';

const dashboard = {
  score: 72,
  hours_this_week: 4,
  hours_this_month: 15,
  streak_days: 3,
  burnout_risk: 'low',
  warnings: ['You volunteered six days in a row.'],
  suggested_rest_days: ['2026-10-12'],
  recent_checkins: [{ id: 9, mood: 4, note: 'Grand', shared: false, created_at: '2026-10-06T10:00:00Z' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockVolunteeringConfig = {};
  jest.mocked(getWellbeing).mockResolvedValue({ data: dashboard });
  jest.mocked(submitWellbeingCheckin).mockResolvedValue({ data: { id: 10, mood: 3, note: null, shared: false, team_notified: false } });
});

describe('MyWellbeingScreen', () => {
  it('shows the score, risk, warnings and recent check-ins', async () => {
    const { getByText } = render(<MyWellbeingScreen />);
    await waitFor(() => expect(getByText('72/100 · Good')).toBeTruthy());
    expect(getByText('Low risk')).toBeTruthy();
    expect(getByText('You volunteered six days in a row.')).toBeTruthy();
    expect(getByText('Grand')).toBeTruthy();
  });

  it('records an "okay" check-in with the opt-in forced off, and says it was recorded', async () => {
    const { getByTestId } = render(<MyWellbeingScreen />);
    await waitFor(() => expect(getByTestId('wellbeing-submit')).toBeTruthy());
    fireEvent.changeText(getByTestId('wellbeing-note'), 'Bit tired');
    fireEvent.press(getByTestId('wellbeing-submit'));
    await waitFor(() => expect(submitWellbeingCheckin).toHaveBeenCalledWith({ mood: 3, note: 'Bit tired', share_with_team: false }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Mood check-in recorded.' })));
    expect(getWellbeing).toHaveBeenCalledTimes(2);
  });

  it('offers "let someone get in touch" only at a low mood, ticked by default, and thanks the member when the team is told', async () => {
    jest.mocked(submitWellbeingCheckin).mockResolvedValue({ data: { id: 11, mood: 2, note: null, shared: true, team_notified: true } });
    const { getByTestId, queryByTestId, getByText } = render(<MyWellbeingScreen />);
    await waitFor(() => expect(getByTestId('wellbeing-submit')).toBeTruthy());
    expect(queryByTestId('wellbeing-share')).toBeNull();
    fireEvent.press(getByText('Low'));
    await waitFor(() => expect(getByTestId('wellbeing-share')).toBeTruthy());
    fireEvent.press(getByTestId('wellbeing-submit'));
    await waitFor(() => expect(submitWellbeingCheckin).toHaveBeenCalledWith({ mood: 2, note: '', share_with_team: true }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Thank you for telling us. Someone will be in touch.' })));
  });

  it('surfaces a refused check-in', async () => {
    jest.mocked(submitWellbeingCheckin).mockRejectedValueOnce(new ApiResponseError(429, 'Too many check-ins'));
    const { getByTestId } = render(<MyWellbeingScreen />);
    await waitFor(() => expect(getByTestId('wellbeing-submit')).toBeTruthy());
    fireEvent.press(getByTestId('wellbeing-submit'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Too many check-ins', variant: 'danger' })));
  });

  it('still lets the member check in when the summary cannot be loaded', async () => {
    jest.mocked(getWellbeing).mockRejectedValueOnce(new ApiResponseError(422, 'No summary'));
    const { getByTestId } = render(<MyWellbeingScreen />);
    await waitFor(() => expect(getByTestId('wellbeing-error')).toBeTruthy());
    expect(getByTestId('wellbeing-submit')).toBeTruthy();
  });

  it('refuses the screen when the community has wellbeing off', () => {
    mockVolunteeringConfig = { 'volunteering.tab_wellbeing': false };
    const { getByText } = render(<MyWellbeingScreen />);
    expect(getByText('Not available in this community')).toBeTruthy();
    expect(getWellbeing).not.toHaveBeenCalled();
  });
});
