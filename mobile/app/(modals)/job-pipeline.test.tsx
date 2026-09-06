// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

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
        'kanban.pipeline_title': 'Application Pipeline',
        'kanban.eyebrow': 'Hiring pipeline',
        'kanban.subtitle': 'Review candidates by stage.',
        'kanban.load_error_hint': 'Could not load applications.',
        'kanban.active_stage_count': opts ? `${String(opts.count ?? 0)} in this stage` : '0 in this stage',
        'kanban.empty_stage': 'No applications in this stage',
        'kanban.empty_stage_hint': 'Move candidates as applications arrive.',
        'owner.applicationsCount': opts ? `${String(opts.count ?? 0)} applications` : '0 applications',
        'owner.unknownApplicant': 'Applicant',
        'owner.updateError': 'Could not update application.',
        'owner.moveToInterview': 'Interview',
        'applications.status.pending': 'Pending',
        'applications.status.screening': 'Screening',
        'applications.status.reviewed': 'Reviewed',
        'applications.status.shortlisted': 'Shortlisted',
        'applications.status.interview': 'Interview',
        'applications.status.offer': 'Offer',
        'applications.status.accepted': 'Accepted',
        'applications.status.rejected': 'Rejected',
        'retry': 'Retry',
        'detail.invalidId': 'Invalid job ID.',
        'detail.invalidIdHint': 'We could not identify this role.',
        'detail.browseJobs': 'Browse jobs',
        'common:back': 'Back',
        'common:errors.alertTitle': 'Error',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
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
  }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/api/jobs', () => ({
  getJobApplications: jest.fn(),
  updateJobApplication: jest.fn().mockResolvedValue({ data: { message: 'Updated' } }),
}));

jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success' },
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

import JobPipelineScreen from './job-pipeline';
import { updateJobApplication } from '@/lib/api/jobs';

const applications = [
  {
    id: 44,
    vacancy_id: 1,
    applicant: { id: 9, name: 'Ava Candidate', avatar_url: null, email: 'ava@example.org' },
    message: 'I would love to help.',
    status: 'pending',
    created_at: '2026-03-11T00:00:00Z',
  },
  {
    id: 45,
    vacancy_id: 1,
    applicant: { id: 10, name: 'Mika Interview', avatar_url: null, email: 'mika@example.org' },
    message: 'Available next week.',
    status: 'interview',
    created_at: '2026-03-12T00:00:00Z',
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockUseApi.mockReturnValue({
    data: { data: applications },
    isLoading: false,
    error: null,
    refresh: jest.fn(),
  });
});

describe('JobPipelineScreen', () => {
  it('renders pipeline stages and current-stage applications', () => {
    const { getByText } = render(<JobPipelineScreen />);

    expect(getByText('Hiring pipeline')).toBeTruthy();
    expect(getByText('2 applications')).toBeTruthy();
    expect(getByText('Ava Candidate')).toBeTruthy();
  });

  it('moves an application to screening', async () => {
    const { getAllByText } = render(<JobPipelineScreen />);

    const screeningActions = getAllByText('Screening');
    fireEvent.press(screeningActions[screeningActions.length - 1]);

    await waitFor(() => {
      expect(updateJobApplication).toHaveBeenCalledWith(44, { status: 'screening' });
    });
  });
});
