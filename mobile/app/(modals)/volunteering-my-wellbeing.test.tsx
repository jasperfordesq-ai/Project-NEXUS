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
        'volunteeringVolunteer:wellbeing.outcomeTold': `We have told ${String(opts?.count ?? 0)} other people. Someone will be in touch.`,
        'volunteeringVolunteer:wellbeing.outcomeSelfOnly': 'You are the only member of your community team, so nobody else has been told. See the support below.',
        'volunteeringVolunteer:wellbeing.noData': 'Not enough activity yet to score your wellbeing.',
        'volunteeringVolunteer:wellbeing.outcomeAlreadyTold': 'Your community was already told today.',
        'volunteeringVolunteer:wellbeing.outcomeNobody': 'Nobody could be told yet. We will try again with your next check-in. See the support below.',
        'volunteeringVolunteer:wellbeing.outcomePrivate': 'Only you can see this check-in.',
        'volunteeringVolunteer:wellbeing.supportHeading': 'If you need support now',
        'volunteeringVolunteer:wellbeing.lastTold': `Your community team was last told on ${String(opts?.date ?? '')}.`,
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

const englishCatalogue = require('../../locales/en/volunteeringVolunteer.json') as { wellbeing: Record<string, string> };

const dashboard = {
  score: 72,
  hours_this_week: 4,
  hours_this_month: 15,
  streak_days: 3,
  burnout_risk: 'low',
  warnings: ['You volunteered six days in a row.'],
  suggested_rest_days: ['2026-10-12'],
  recent_checkins: [{ id: 9, mood: 4, note: 'Grand', shared: false, created_at: '2026-10-06T10:00:00Z' }],
  support: { text: 'Ring the office any weekday.', links: [{ label: 'Our office', url: 'tel:+353100' }, { label: 'Contact the team', url: '/contact' }], is_default: false },
  last_team_notified_at: '2026-10-20T12:05:22Z',
  last_told_count: 2,
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

  // 20 Oct 2026: the member is told honestly what happened after a shared check-in.
  it('says how many people were told after a shared check-in', async () => {
    jest.mocked(submitWellbeingCheckin).mockResolvedValue({ data: { id: 11, mood: 1, note: null, shared: true, team_notified: true, told_count: 2, told_at: '2026-10-20T12:05:22Z', outcome: 'told' } });
    const { getByTestId, getByText } = render(<MyWellbeingScreen />);
    await waitFor(() => expect(getByTestId('wellbeing-submit')).toBeTruthy());
    fireEvent.press(getByText('Struggling'));
    fireEvent.press(getByTestId('wellbeing-submit'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'We have told 2 other people. Someone will be in touch.' })));
  });

  // 21 Oct 2026: a lone staff member checking in is the only person on the team, so the
  // only person "told" was themself. That is a warning, not a thank-you.
  it('warns when the volunteer is the only member of the team, and keeps the support card on screen', async () => {
    jest.mocked(submitWellbeingCheckin).mockResolvedValue({ data: { id: 11, mood: 1, note: null, shared: true, team_notified: false, told_count: 0, told_at: null, outcome: 'told_self_only' } });
    const { getByTestId, getByText } = render(<MyWellbeingScreen />);
    await waitFor(() => expect(getByTestId('wellbeing-submit')).toBeTruthy());
    fireEvent.press(getByText('Struggling'));
    fireEvent.press(getByTestId('wellbeing-submit'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning', description: expect.stringMatching(/only member of your community team/i) })));
    expect(getByTestId('wellbeing-support')).toBeTruthy();
  });

  // 21 Oct 2026: with no activity and no check-in the API scores 100 by default. That is
  // not a result, so the number and "Excellent" are not shown; the form still works.
  it('does not show a score when there is nothing to score, and still lets the member check in', async () => {
    jest.mocked(getWellbeing).mockResolvedValue({ data: { ...dashboard, score: 100, score_basis: 'no_data', warnings: [], recent_checkins: [] } });
    const { getByTestId, getByText, queryByTestId, queryByText } = render(<MyWellbeingScreen />);
    await waitFor(() => expect(getByTestId('wellbeing-no-data')).toBeTruthy());
    expect(getByText('Not enough activity yet to score your wellbeing.')).toBeTruthy();
    expect(queryByTestId('wellbeing-score')).toBeNull();
    expect(queryByText(/Excellent/)).toBeNull();
    expect(getByTestId('wellbeing-submit')).toBeTruthy();
  });

  it('shows the score as usual when the API says it is based on activity', async () => {
    jest.mocked(getWellbeing).mockResolvedValue({ data: { ...dashboard, score: 85, score_basis: 'activity' } });
    const { getByText, queryByTestId } = render(<MyWellbeingScreen />);
    await waitFor(() => expect(getByText('85/100 · Excellent')).toBeTruthy());
    expect(queryByTestId('wellbeing-no-data')).toBeNull();
  });

  // The member reads the real English catalogue, not this file's mock, so pin the wording
  // the audit asked for there too.
  describe('English wording', () => {
    const w = englishCatalogue.wellbeing;
    it('counts the OTHER people told, in both plural forms', () => {
      expect(w.outcomeTold_one).toMatch(/{{count}} other person/);
      expect(w.outcomeTold_other).toMatch(/{{count}} other people/);
    });
    it('promises no timeframe', () => {
      for (const key of ['teamNotified', 'outcomeTold_one', 'outcomeTold_other', 'outcomeSelfOnly', 'outcomeAlreadyTold']) {
        expect(w[key]).not.toMatch(/day or two|within (a|one|d+) (day|hour)|24 hours/i);
      }
    });
    it('names every recipient of a shared check-in', () => {
      expect(w.shareOn).toMatch(/community'?s team/i);
      expect(w.shareOn).toMatch(/network/i);
      expect(w.shareOn).toMatch(/contact address/i);
      expect(w.shareOn).toMatch(/organisations you volunteer with/i);
      expect(w.shareOn).toMatch(/never your note/i);
    });
    it('has the lone-team-member and no-data messages', () => {
      expect(w.outcomeSelfOnly).toMatch(/only member/i);
      expect(w.noData).toMatch(/not enough activity/i);
    });
  });

  it('says when nobody could be told, as a warning, and keeps the support card on screen', async () => {
    jest.mocked(submitWellbeingCheckin).mockResolvedValue({ data: { id: 11, mood: 1, note: null, shared: true, team_notified: false, told_count: 0, told_at: null, outcome: 'nobody_available' } });
    const { getByTestId, getByText } = render(<MyWellbeingScreen />);
    await waitFor(() => expect(getByTestId('wellbeing-submit')).toBeTruthy());
    fireEvent.press(getByText('Struggling'));
    fireEvent.press(getByTestId('wellbeing-submit'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning', description: expect.stringMatching(/nobody could be told yet/i) })));
    expect(getByTestId('wellbeing-support')).toBeTruthy();
  });

  it('shows the community support card with its links, and when the team was last told', async () => {
    const { getByTestId, getByText } = render(<MyWellbeingScreen />);
    await waitFor(() => expect(getByTestId('wellbeing-support')).toBeTruthy());
    expect(getByText('If you need support now')).toBeTruthy();
    expect(getByText('Ring the office any weekday.')).toBeTruthy();
    expect(getByText('Our office')).toBeTruthy();
    expect(getByText('Contact the team')).toBeTruthy();
    expect(getByText(/was last told on/)).toBeTruthy();
  });
});
