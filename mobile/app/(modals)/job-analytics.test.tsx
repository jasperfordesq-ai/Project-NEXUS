// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({ id: '1' }),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'analytics.title': 'Job Analytics',
        'analytics.eyebrow': 'Owner analytics',
        'analytics.subtitle': 'Track role performance.',
        'analytics.no_data': 'No analytics available.',
        'owner.notYoursTitle': 'This is not your vacancy',
        'owner.notYoursHint': 'Only the person who posted it can see this.',
        'detail.notFound': 'Job not found.',
        'analytics.no_data_hint': 'Analytics appear later.',
        'analytics.total_views': 'Total views',
        'analytics.unique_viewers': 'Unique viewers',
        'analytics.total_applications': 'Applications',
        'analytics.conversion_rate': 'Conversion rate',
        'analytics.quality_signals': 'Quality signals',
        'analytics.referral_shares': 'Referral shares',
        'analytics.referral_apps': 'Referral applications',
        'analytics.referral_conversion': 'Referral conversion',
        'analytics.scorecard_value': opts ? `Scorecard average ${String(opts.value ?? 0)}%` : 'Scorecard average',
        'analytics.avg_time_to_apply': 'Average time to apply',
        'analytics.time_to_fill': 'Time to fill',
        'analytics.hours_value': opts ? `${String(opts.count ?? 0)} hrs` : '0 hrs',
        'analytics.days_value': opts ? `${String(opts.count ?? 0)} days` : '0 days',
        'analytics.views_over_time': 'Views over time',
        'analytics.weekly_trend': 'Weekly applications',
        'analytics.applications_by_stage': 'Applications by stage',
        'analytics.stage_count': opts ? `${String(opts.count ?? 0)} · ${String(opts.percentage ?? 0)}%` : '0 · 0%',
        'analytics.predictions': 'Predictions',
        'analytics.based_on': opts ? `${String(opts.count ?? 0)} similar roles` : '0 similar roles',
        'analytics.no_predictions': 'Predictions are not available yet.',
        'analytics.expected_apps': 'Expected applications',
        'analytics.current_value': opts ? `Current: ${String(opts.count ?? 0)}` : 'Current: 0',
        'analytics.conversion_comparison': 'Conversion comparison',
        'analytics.avg_value': opts ? `Average: ${String(opts.value ?? 0)}%` : 'Average: 0%',
        'analytics.not_available': 'Not available',
        'analytics.posted_days_ago': opts ? `Posted ${String(opts.days ?? 0)} days ago` : 'Posted 0 days ago',
        'analytics.salary_comparison': 'Salary comparison',
        'analytics.salary_comparison_value': opts ? `${String(opts.yours ?? '')} vs ${String(opts.market ?? '')}` : 'Salary comparison',
        'analytics.salary_difference': opts ? `${String(opts.value ?? 0)}% ${String(opts.label ?? '')}` : '0%',
        'analytics.ai_insights': 'AI insights',
        'applications.status.pending': 'Pending',
        'applications.status.interview': 'Interview',
        'retry': 'Retry',
        'detail.invalidId': 'Invalid job ID.',
        'detail.invalidIdHint': 'We could not identify this role.',
        'detail.browseJobs': 'Browse jobs',
        'common:back': 'Back',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { id: 2, slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 7 } }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    borderSubtle: '#eeeeee',
    error: '#e53e3e',
    success: '#22c55e',
    warning: '#f59e0b',
    info: '#3b82f6',
  }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/api/jobs', () => ({
  getJobAnalytics: jest.fn(),
  getJobPredictions: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ModalErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

import JobAnalyticsScreen from './job-analytics';

const analytics = {
  job_id: 1,
  total_views: 240,
  unique_viewers: 120,
  total_applications: 12,
  conversion_rate: 10,
  avg_time_to_apply_hours: 8,
  time_to_fill_days: null,
  views_by_day: [
    { date: '2026-03-01', count: 5 },
    { date: '2026-03-02', count: 10 },
  ],
  applications_by_stage: [
    { stage: 'pending', count: 7 },
    { stage: 'interview', count: 5 },
  ],
  weekly_trend: [{ week: '2026-W10', count: 12 }],
  referral_stats: { total_shares: 3, referral_applications: 2, referral_conversion_pct: 66 },
  scorecard_avg: 75,
  created_at: '2026-03-01T00:00:00Z',
  status: 'open',
};

const predictions = {
  expected_applications: { value: 20, current: 12, label: 'On track' },
  estimated_time_to_fill: { value: 18, days_posted: 9, label: 'Typical' },
  conversion_rate: { yours: 10, average: 8, label: 'Strong' },
  salary_comparison: { your_salary: 30000, market_avg: 32000, diff_percent: -6, label: 'below market' },
  similar_jobs_analyzed: 42,
  ai_insights: ['Improve the title for better discovery.'],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseApi
    .mockReturnValueOnce({ data: { data: analytics }, isLoading: false, error: null, refresh: jest.fn() })
    .mockReturnValueOnce({ data: { data: predictions }, isLoading: false, error: null, refresh: jest.fn() });
});

describe('JobAnalyticsScreen', () => {
  it('renders analytics metrics and predictions', () => {
    const { getByText } = render(<JobAnalyticsScreen />);

    expect(getByText('Owner analytics')).toBeTruthy();
    expect(getByText('Total views')).toBeTruthy();
    expect(getByText('240')).toBeTruthy();
    expect(getByText('Applications by stage')).toBeTruthy();
    expect(getByText('Predictions')).toBeTruthy();
    expect(getByText('42 similar roles')).toBeTruthy();
  });

  it('refreshes analytics and predictions from the top action', () => {
    const refreshAnalytics = jest.fn();
    const refreshPredictions = jest.fn();
    mockUseApi.mockReset();
    mockUseApi
      .mockReturnValueOnce({ data: { data: analytics }, isLoading: false, error: null, refresh: refreshAnalytics })
      .mockReturnValueOnce({ data: { data: predictions }, isLoading: false, error: null, refresh: refreshPredictions });

    const { getByLabelText } = render(<JobAnalyticsScreen />);
    fireEvent.press(getByLabelText('Retry'));

    expect(refreshAnalytics).toHaveBeenCalled();
    expect(refreshPredictions).toHaveBeenCalled();
  });

  it('shows a prediction failure and offers a direct retry instead of claiming there is no data yet', () => {
    const retryPredictions = jest.fn();
    mockUseApi.mockReset();
    mockUseApi
      .mockReturnValueOnce({ data: { data: analytics }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: null, isLoading: false, error: 'Prediction service unavailable', refresh: retryPredictions });

    const { getByTestId, getByLabelText, queryByText } = render(<JobAnalyticsScreen />);
    expect(getByTestId('job-predictions-error')).toBeTruthy();
    expect(queryByText('Predictions are not available yet.')).toBeNull();
    fireEvent.press(getByLabelText('common:buttons.retry'));
    expect(retryPredictions).toHaveBeenCalledTimes(1);
  });
  it('🔴 says the vacancy is not yours rather than offering a Retry that cannot work', () => {
    // A 403 was rendered as "could not load" with a Retry that would fail identically
    // for ever (E/F-9).
    mockUseApi.mockReset();
    mockUseApi.mockReturnValue({
      data: null,
      isLoading: false,
      error: 'Forbidden',
      errorStatus: 403,
      errorCode: null,
      refresh: jest.fn(),
    });

    const { getByTestId, queryByText } = render(<JobAnalyticsScreen />);

    expect(getByTestId('job-analytics-refused')).toBeTruthy();
    expect(queryByText('Retry')).toBeNull();
  });

  it('still offers a Retry when the failure really is transient', () => {
    mockUseApi.mockReset();
    mockUseApi.mockReturnValue({
      data: null,
      isLoading: false,
      error: 'Server error',
      errorStatus: 500,
      errorCode: null,
      refresh: jest.fn(),
    });

    const { getByTestId } = render(<JobAnalyticsScreen />);

    expect(getByTestId('job-analytics-error')).toBeTruthy();
  });
});
