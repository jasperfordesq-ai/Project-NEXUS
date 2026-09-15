// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import * as ReactNative from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

jest.mock('@/components/ui/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ visible, children, footer, testID }: { visible: boolean; children: React.ReactNode; footer?: React.ReactNode; testID?: string }) =>
      visible ? <View testID={testID}>{children}{footer}</View> : null,
  };
});

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
        'owner.reject': 'Reject',
        'owner.rejectConfirmTitle': 'Reject this applicant?',
        'owner.rejectConfirmMessage': 'They will be told.',
        'owner.hiringActions': 'Interview and offer',
        'owner.scheduleInterview': 'Schedule interview',
        'owner.cancelInterview': 'Cancel interview',
        'owner.sendOffer': 'Send offer',
        'owner.withdrawOffer': 'Withdraw offer',
        'owner.scheduleInterviewFor': 'Interview with Ava Candidate',
        'owner.sendOfferTo': 'Offer for Ava Candidate',
        'owner.interviewDateTime': 'Date and time',
        'owner.interviewType': 'Interview type',
        'owner.interviewDuration': 'Duration',
        'owner.interviewLocationNotes': 'Joining details',
        'owner.interviewLocationPlaceholder': 'Meeting details',
        'owner.sendInterview': 'Send invitation',
        'owner.offerMessage': 'Offer message',
        'owner.offerMessagePlaceholder': 'Explain the offer',
        'owner.offerSalary': 'Salary (optional)',
        'owner.offerSalaryPlaceholder': 'Amount',
        'owner.offerStartDate': 'Start date (optional)',
        'owner.addStartDate': 'Choose start date',
        'owner.checkActionTitle': 'Check the details',
        'owner.offerMessageRequired': 'Add a message explaining the offer.',
        'owner.interviewCreated': 'Interview invitation sent',
        'owner.offerCreated': 'Offer sent',
        'owner.interviewCreateError': 'Could not send invitation.',
        'owner.offerCreateError': 'Could not send offer.',
        'owner.sendingAction': 'Sending…',
        'owner.interviewTypes.video': 'Video call',
        'owner.interviewTypes.phone': 'Phone call',
        'owner.interviewTypes.in_person': 'In person',
        'owner.notYoursTitle': 'This is not your vacancy',
        'owner.notYoursHint': 'Only the person who posted it can see this.',
        'detail.notFound': 'Job not found.',
        'common:buttons.cancel': 'Cancel',
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

let mockTenantSlug = 'hour-timebank';
let mockCurrentUserId = 2;
let mockJobConfig: Record<string, unknown> = {};
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: mockTenantSlug, currency: 'EUR', job_config: mockJobConfig }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));
jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: mockCurrentUserId } }),
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
  proposeJobInterview: jest.fn().mockResolvedValue({ data: { id: 81 } }),
  createJobOffer: jest.fn().mockResolvedValue({ data: { id: 91 } }),
  cancelJobInterview: jest.fn().mockResolvedValue(undefined),
  withdrawJobOffer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/jobHiringActionOperation', () => ({
  reserveJobHiringActionOperation: jest.fn().mockResolvedValue({ storageKey: 'job-op', key: 'job-key-123', createdAt: 1 }),
  completeJobHiringActionOperation: jest.fn().mockResolvedValue(undefined),
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

jest.mock('@/components/ui/ConfirmDialog', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({ visible, title, cancelLabel, confirmLabel, cancelTestID, confirmTestID, onClose, onConfirm }: Record<string, unknown>) =>
      visible ? (
        <View>
          <Text>{title as string}</Text>
          <Pressable testID={cancelTestID as string} onPress={onClose as () => void}><Text>{cancelLabel as string}</Text></Pressable>
          <Pressable testID={confirmTestID as string} onPress={onConfirm as () => void}><Text>{confirmLabel as string}</Text></Pressable>
        </View>
      ) : null,
  };
});

import JobPipelineScreen from './job-pipeline';
import {
  cancelJobInterview,
  createJobOffer,
  getJobApplications,
  proposeJobInterview,
  updateJobApplication,
  withdrawJobOffer,
} from '@/lib/api/jobs';
import { ApiResponseError } from '@/lib/api/client';
import * as Haptics from '@/lib/haptics';

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
  mockTenantSlug = 'hour-timebank';
  mockCurrentUserId = 2;
  mockJobConfig = {};
  jest.clearAllMocks();
  mockUseApi.mockReturnValue({
    data: { data: applications },
    isLoading: false,
    error: null,
    refresh: jest.fn(),
  });
});

describe('JobPipelineScreen', () => {
  it('resets candidate state when the active account is replaced on the same route', () => {
    const screen = render(<JobPipelineScreen />);
    fireEvent.press(screen.getByTestId('pipeline-stage-interview'));
    expect(screen.getByText('Mika Interview')).toBeTruthy();
    expect(screen.queryByText('Ava Candidate')).toBeNull();

    mockCurrentUserId = 77;
    screen.rerender(<JobPipelineScreen />);

    expect(screen.getByText('Ava Candidate')).toBeTruthy();
    expect(screen.queryByText('Mika Interview')).toBeNull();
  });

  it('does not deliver an old candidate decision after account replacement', async () => {
    let resolve!: (value: { data: { message: string } }) => void;
    (updateJobApplication as jest.Mock).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const screen = render(<JobPipelineScreen />);
    fireEvent.press(screen.getByTestId('pipeline-advance-44'));

    mockCurrentUserId = 77;
    screen.rerender(<JobPipelineScreen />);
    await act(async () => { resolve({ data: { message: 'Updated' } }); });

    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('sends only one candidate move for rapid conflicting actions', async () => {
    const screen = render(<JobPipelineScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('pipeline-advance-44'));
      fireEvent.press(screen.getByTestId('pipeline-move-shortlisted-44'));
    });
    expect(updateJobApplication).toHaveBeenCalledTimes(1);
    expect(updateJobApplication).toHaveBeenCalledWith(44, { status: 'screening', expected_status: 'pending' });
  });
  it.each(['accepted', 'rejected', 'withdrawn'])('keeps %s candidates in their terminal stage without decision actions', (status) => {
    mockUseApi.mockReturnValue({ data: { data: [{ ...applications[0], status: 'pending', stage: status }] }, isLoading: false, error: null, refresh: jest.fn() });
    const screen = render(<JobPipelineScreen />);
    expect(screen.queryByText('Ava Candidate')).toBeNull();
    fireEvent.press(screen.getByTestId(`pipeline-stage-${status}`));
    expect(screen.getByText('Ava Candidate')).toBeTruthy();
    expect(screen.queryByTestId('pipeline-advance-44')).toBeNull();
    expect(screen.queryByTestId('pipeline-move-screening-44')).toBeNull();
    expect(screen.queryByTestId('pipeline-reject-44')).toBeNull();
  });
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
      expect(updateJobApplication).toHaveBeenCalledWith(44, { status: 'screening', expected_status: 'pending' });
    });
  });
  it('🔴 can make an offer, accept and reject once a candidate reaches interview', () => {
    // The card rendered `PIPELINE_COLUMNS.filter(…).slice(0, 4)`, which always takes the
    // four LOWEST-indexed remaining stages — so Offer, Accepted and Rejected were
    // unreachable for anyone past Shortlisted, and an employer had no way to progress a
    // candidate they had moved to Interview (E/F-4).
    const { getByTestId } = render(<JobPipelineScreen />);

    fireEvent.press(getByTestId('pipeline-stage-interview'));

    expect(getByTestId('pipeline-advance-45')).toBeTruthy();
    expect(getByTestId('pipeline-move-accepted-45')).toBeTruthy();
    expect(getByTestId('pipeline-reject-45')).toBeTruthy();
  });

  it('exposes real interview and offer actions separately from pipeline stage labels', () => {
    const screen = render(<JobPipelineScreen />);

    expect(screen.getByTestId('pipeline-schedule-interview-44')).toBeTruthy();
    expect(screen.getByTestId('pipeline-create-offer-44')).toBeTruthy();
  });

  it('hides employer actions disabled by the community configuration', () => {
    mockJobConfig = {
      'jobs.enable_interview_scheduling': false,
      'jobs.enable_offers': false,
    };
    const screen = render(<JobPipelineScreen />);

    expect(screen.queryByTestId('pipeline-schedule-interview-44')).toBeNull();
    expect(screen.queryByTestId('pipeline-create-offer-44')).toBeNull();
  });

  it('shows current hiring actions and confirms cancellation or withdrawal', async () => {
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({
      data: {
        data: [{
          ...applications[0],
          interview: {
            id: 81,
            scheduled_at: '2026-10-01T10:00:00Z',
            interview_type: 'video',
            status: 'proposed',
            duration_mins: 60,
            location_notes: null,
          },
          offer: {
            id: 91,
            salary_offered: null,
            salary_currency: null,
            salary_type: null,
            start_date: null,
            message: 'Please join us.',
            status: 'pending',
          },
        }],
      },
      isLoading: false,
      error: null,
      refresh,
    });
    const screen = render(<JobPipelineScreen />);

    fireEvent.press(screen.getByTestId('pipeline-cancel-interview-44'));
    fireEvent.press(screen.getByTestId('pipeline-confirm-cancel-interview-44'));
    await waitFor(() => expect(cancelJobInterview).toHaveBeenCalledWith(81));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    fireEvent.press(screen.getByTestId('pipeline-withdraw-offer-44'));
    fireEvent.press(screen.getByTestId('pipeline-confirm-withdraw-offer-44'));
    await waitFor(() => expect(withdrawJobOffer).toHaveBeenCalledWith(91));
  });

  it('sends an interview through the safe-area action sheet with a durable receipt key', async () => {
    const screen = render(<JobPipelineScreen />);
    fireEvent.press(screen.getByTestId('pipeline-schedule-interview-44'));
    fireEvent.press(await screen.findByTestId('hiring-action-submit'));

    await waitFor(() => expect(proposeJobInterview).toHaveBeenCalledWith(44, expect.objectContaining({
      interview_type: 'video',
      duration_mins: 60,
      idempotency_key: 'job-key-123',
    })));
  });

  it('stacks hiring sheet actions at large text so labels remain readable', () => {
    const dimensions = jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({
      width: 360,
      height: 800,
      scale: 1,
      fontScale: 2,
    });
    try {
      const screen = render(<JobPipelineScreen />);
      fireEvent.press(screen.getByTestId('pipeline-schedule-interview-44'));

      expect(screen.getByTestId('hiring-action-cancel')).toHaveStyle({ flexBasis: '100%' });
      expect(screen.getByTestId('hiring-action-submit')).toHaveStyle({ flexBasis: '100%' });
    } finally {
      dimensions.mockRestore();
    }
  });

  it('requires terms before sending a formal offer', async () => {
    const screen = render(<JobPipelineScreen />);
    fireEvent.press(screen.getByTestId('pipeline-create-offer-44'));
    fireEvent.press(await screen.findByTestId('hiring-action-submit'));
    expect(createJobOffer).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByLabelText('Offer message'), 'We would like you to join us.');
    fireEvent.press(screen.getByTestId('hiring-action-submit'));
    await waitFor(() => expect(createJobOffer).toHaveBeenCalledWith(44, expect.objectContaining({
      message: 'We would like you to join us.',
      idempotency_key: 'job-key-123',
    })));
  });

  it('🔴 asks before rejecting an applicant', async () => {
    const { getByTestId } = render(<JobPipelineScreen />);

    fireEvent.press(getByTestId('pipeline-reject-44'));
    expect(updateJobApplication).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('pipeline-confirm-reject-44'));
    await waitFor(() =>
      expect(updateJobApplication).toHaveBeenCalledWith(44, { status: 'rejected', expected_status: 'pending' }),
    );
  });

  it('accepts a candidate move after response loss only when authoritative readback proves it', async () => {
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({ data: { data: applications }, isLoading: false, error: null, refresh });
    (updateJobApplication as jest.Mock).mockRejectedValueOnce(new ApiResponseError(0, 'Response lost'));
    (getJobApplications as jest.Mock).mockResolvedValueOnce({
      data: applications.map((application) => application.id === 44
        ? { ...application, status: 'screening', stage: 'screening' }
        : application),
    });
    const screen = render(<JobPipelineScreen />);

    await act(async () => { fireEvent.press(screen.getByTestId('pipeline-advance-44')); });

    expect(getJobApplications).toHaveBeenCalledWith(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes a stale candidate after another owner wins the decision', async () => {
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({ data: { data: applications }, isLoading: false, error: null, refresh });
    (updateJobApplication as jest.Mock).mockRejectedValueOnce(
      new ApiResponseError(409, 'This application changed while you were reviewing it.', undefined, 'DECISION_CONFLICT'),
    );
    const screen = render(<JobPipelineScreen />);

    await act(async () => { fireEvent.press(screen.getByTestId('pipeline-advance-44')); });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('🔴 says the vacancy is not yours rather than offering a Retry that cannot work', () => {
    mockUseApi.mockReturnValue({
      data: null,
      isLoading: false,
      error: 'Forbidden',
      errorStatus: 403,
      errorCode: null,
      refresh: jest.fn(),
    });

    const { getByTestId, queryByText } = render(<JobPipelineScreen />);

    expect(getByTestId('job-pipeline-refused')).toBeTruthy();
    expect(queryByText('Retry')).toBeNull();
  });

  it('still offers a Retry when the failure really is transient', () => {
    mockUseApi.mockReturnValue({
      data: null,
      isLoading: false,
      error: 'Server error',
      errorStatus: 500,
      errorCode: null,
      refresh: jest.fn(),
    });

    const { getByTestId, getByText } = render(<JobPipelineScreen />);

    expect(getByTestId('job-pipeline-error')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
  });
});
