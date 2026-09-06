// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import GoalDetailScreen from './goal-detail';
import {
  deleteGoalReminder,
  getGoal,
  getGoalHistory,
  getGoalInsights,
  getGoalReminder,
  setGoalReminder,
  updateGoalProgress,
} from '@/lib/api/goals';

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { back: jest.fn(), canGoBack: jest.fn(() => false), replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: '1' }),
}));

const mockGoalDetailT = (key: string, opts?: Record<string, unknown>) => {
  const map: Record<string, string> = {
    'detail.title': 'Goal detail',
    'detail.loadError': 'Could not load this goal.',
    'detail.notFound': 'Goal not found',
    'detail.notFoundHint': 'This goal may have been removed.',
    'detail.insights': 'Insights',
    'detail.progressUpdate': 'Update progress',
    'detail.progressIncrement': 'Progress to add',
    'detail.progressPlaceholder': 'e.g. 1.5',
    'detail.saveProgress': 'Save progress',
    'detail.saving': 'Saving...',
    'detail.progressError': 'Could not update progress.',
    'detail.reminder': 'Reminder',
    'detail.reminderOn': 'Reminder is enabled for this goal.',
    'detail.reminderOff': 'No reminder is set for this goal.',
    'detail.enableReminder': 'Enable',
    'detail.disableReminder': 'Disable',
    'detail.reminderError': 'Could not update the reminder.',
    'detail.nextReminder': `Next reminder ${opts?.date ?? ''}`,
    'detail.milestones': 'Milestones',
    'detail.noMilestones': 'No milestones have been generated yet.',
    'detail.completedOn': `Completed ${opts?.date ?? ''}`,
    'detail.pendingMilestone': 'Pending',
    'detail.history': 'Progress history',
    'detail.noHistory': 'No progress history yet.',
    'detail.summary.progress': 'Progress',
    'detail.summary.checkins': 'Check-ins',
    'detail.summary.streak': 'Streak',
    'detail.summary.milestones': 'Milestones',
    'detail.frequency.daily': 'Daily',
    'detail.frequency.weekly': 'Weekly',
    'detail.frequency.biweekly': 'Every 2 weeks',
    'detail.frequency.monthly': 'Monthly',
    'status.active': 'Active',
    'status.completed': 'Completed',
    progress: `${opts?.current ?? 0} / ${opts?.target ?? 0} hrs`,
    noTarget: `${opts?.current ?? 0} hrs logged`,
    percent: `${opts?.percent ?? 0}%`,
    due: `Due ${opts?.date ?? ''}`,
    buddy: `Buddy: ${opts?.name ?? ''}`,
    'visibility.public': 'Public',
    'common:buttons.back': 'Back',
    // Read by <SourceRepositoryLink /> from the 'common' namespace.
    attribution: 'AGPL attribution',
    'sourceRepo.builtOn': 'Built on Project NEXUS by Jasper Ford',
    'sourceRepo.accessibilityLabel': 'Opens the source code repository on GitHub.',
    'common:errors.alertTitle': 'Error',
  };
  return map[key] ?? key;
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockGoalDetailT,
    i18n: { language: 'en' },
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    success: '#22c55e',
    error: '#ef4444',
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/api/goals', () => ({
  getGoal: jest.fn(),
  getGoalHistory: jest.fn(),
  getGoalInsights: jest.fn(),
  getGoalReminder: jest.fn(),
  updateGoalProgress: jest.fn(),
  setGoalReminder: jest.fn(),
  deleteGoalReminder: jest.fn(),
}));

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

const mockGetGoal = getGoal as jest.MockedFunction<typeof getGoal>;
const mockGetGoalHistory = getGoalHistory as jest.MockedFunction<typeof getGoalHistory>;
const mockGetGoalInsights = getGoalInsights as jest.MockedFunction<typeof getGoalInsights>;
const mockGetGoalReminder = getGoalReminder as jest.MockedFunction<typeof getGoalReminder>;
const mockUpdateGoalProgress = updateGoalProgress as jest.MockedFunction<typeof updateGoalProgress>;
const mockSetGoalReminder = setGoalReminder as jest.MockedFunction<typeof setGoalReminder>;
const mockDeleteGoalReminder = deleteGoalReminder as jest.MockedFunction<typeof deleteGoalReminder>;

const goal = {
  id: 1,
  title: 'Help five neighbours',
  description: 'Make useful local connections.',
  status: 'active' as const,
  target_hours: 10,
  progress_hours: 4,
  due_date: '2026-06-01',
  created_at: '2026-05-01T10:00:00Z',
  is_owner: true,
  is_public: true,
  buddy_name: 'Mina Patel',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetGoal.mockResolvedValue({ data: goal });
  mockGetGoalHistory.mockResolvedValue({
    data: [{ id: 10, goal_id: 1, event_type: 'progress_update', description: 'Progress increased', created_at: '2026-05-05T10:00:00Z' }],
    meta: { has_more: false, cursor: null },
  });
  mockGetGoalInsights.mockResolvedValue({
    data: {
      checkin_count: 2,
      streak_count: 3,
      milestones: [
        { id: 1, title: 'Quarter way', target_percent: 25, completed_at: '2026-05-03T10:00:00Z' },
        { id: 2, title: 'Half way', target_percent: 50, completed_at: null },
      ],
      milestone_count: 2,
    },
  });
  mockGetGoalReminder.mockResolvedValue({ data: { id: 2, frequency: 'weekly', enabled: true, next_reminder_at: '2026-05-10T10:00:00Z' } });
  mockUpdateGoalProgress.mockResolvedValue({ data: { ...goal, progress_hours: 5 } });
  mockSetGoalReminder.mockResolvedValue({ data: { id: 2, frequency: 'daily', enabled: true, next_reminder_at: '2026-05-10T10:00:00Z' } });
  mockDeleteGoalReminder.mockResolvedValue(undefined);
});

describe('GoalDetailScreen', () => {
  it('renders goal detail, insights, milestones, reminder, and history', async () => {
    const { getByText } = render(<GoalDetailScreen />);

    await waitFor(() => expect(getByText('Help five neighbours')).toBeTruthy());
    expect(getByText('Make useful local connections.')).toBeTruthy();
    expect(getByText('Insights')).toBeTruthy();
    expect(getByText('Quarter way')).toBeTruthy();
    expect(getByText('Progress increased')).toBeTruthy();
    expect(getByText('Reminder')).toBeTruthy();
  });

  it('updates progress through the goal progress endpoint', async () => {
    const { getByText, getByPlaceholderText } = render(<GoalDetailScreen />);
    await waitFor(() => expect(getByText('Save progress')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('e.g. 1.5'), '1.5');
    await act(async () => {
      fireEvent.press(getByText('Save progress'));
    });

    await waitFor(() => expect(mockUpdateGoalProgress).toHaveBeenCalledWith(1, 1.5));
  });

  it('updates and disables reminders', async () => {
    const { getByText } = render(<GoalDetailScreen />);
    await waitFor(() => expect(getByText('Daily')).toBeTruthy());

    fireEvent.press(getByText('Daily'));
    await act(async () => {
      fireEvent.press(getByText('Disable'));
    });
    await waitFor(() => expect(mockDeleteGoalReminder).toHaveBeenCalledWith(1));

    mockGetGoalReminder.mockResolvedValueOnce({ data: null });
    const second = render(<GoalDetailScreen />);
    await waitFor(() => expect(second.getByText('Enable')).toBeTruthy());
    fireEvent.press(second.getByText('Daily'));
    await act(async () => {
      fireEvent.press(second.getByText('Enable'));
    });
    await waitFor(() => expect(mockSetGoalReminder).toHaveBeenCalledWith(1, { frequency: 'daily', enabled: true }));
  });
});
