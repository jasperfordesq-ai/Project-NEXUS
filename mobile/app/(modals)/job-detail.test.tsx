// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

// --- Mocks ---

let mockJobId = '1';
jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({ id: mockJobId }),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'title': 'Jobs',
        'detailTitle': 'Job Details',
        'detail.invalidId': 'Invalid job ID.',
        'detail.notFound': 'Job not found.',
        'detail.notFoundHint': 'This role may have been removed.',
        'detail.goBack': 'Go back',
        'detail.browseJobs': 'Browse jobs',
        'detail.share': 'Share',
        'detail.edit': 'Edit',
        'detail.analytics': 'Analytics',
        'detail.kanban_board': 'Pipeline',
        'detail.close_vacancy': 'Close',
        'detail.reopen_vacancy': 'Reopen',
        'detail.save': 'Save',
        'detail.saved': 'Saved',
        'detail.apply': 'Apply Now',
        'detail.applied': 'Applied',
        'detail.closedBadge': 'Closed',
        'detail.closesToday': 'Closes today',
        'detail.skills': 'Skills Required',
        'detail.description': 'Description',
        'detail.about': 'About',
        'detail.postedBy': 'Posted by',
        'detail.keyDetails': 'Role details',
        'detail.views': opts ? `${String(opts.count ?? 0)} views` : '0 views',
        'detail.matchPercentage': opts ? `${String(opts.percentage ?? 0)}% match` : '0% match',
        'detail.closesIn': opts ? `Closes in ${String(opts.count ?? 0)} days` : 'Closes in 0 days',
        'detail.timeCredits': opts ? `${String(opts.count ?? 0)} time credits` : '0 time credits',
        'detail.salaryAnnual': 'year',
        'detail.salaryMonthly': 'month',
        'detail.salaryHourly': 'hour',
        'detail.saveError': 'Could not update saved state.',
        'owner.applicationsTitle': 'Applications',
        'owner.toolsTitle': 'Owner tools',
        'owner.hasApplicants': opts ? `${String(opts.count ?? 0)} people have applied.` : '0 people have applied.',
        'owner.noApplicants': 'No applicants yet.',
        'owner.openToolError': 'Could not open tool.',
        'owner.statusUpdateError': 'Could not update status.',
        'owner.status.open': 'Open',
        'owner.status.closed': 'Closed',
        'owner.status.filled': 'Filled',
        'owner.status.draft': 'Draft',
        'owner.applicationsSubtitle': 'Review candidates.',
        'owner.applicationsCount': opts ? `${String(opts.count ?? 0)} applications` : '0 applications',
        'owner.noApplications': 'No applications yet',
        'owner.noApplicationsHint': 'Applications will appear here.',
        'owner.unknownApplicant': 'Applicant',
        'owner.appliedOn': opts ? `Applied ${String(opts.date ?? '')}` : 'Applied',
        'owner.markReviewed': 'Reviewed',
        'owner.shortlist': 'Shortlist',
        'owner.reject': 'Reject',
        'owner.moveToInterview': 'Interview',
        'owner.updateError': 'Could not update application.',
        'apply.title': opts ? `Apply: ${String(opts.jobTitle ?? '')}` : 'Apply',
        'apply.success': 'Application Sent!',
        'apply.successMessage': 'The employer will be in touch.',
        'apply.messageLabel': 'Cover Message',
        'apply.cvLabel': 'CV or résumé',
        'apply.cvNone': 'No CV attached. Applications sent from this app include only your message unless you add one.',
        'apply.cvSavedNotice': `You have ${String(opts?.name ?? '')} saved to your jobs profile. It is not attached for you.`,
        'apply.cvProfileLoading': 'Checking your saved jobs profile…',
        'apply.cvProfileError': 'We could not check your saved CV or cover letter.',
        'apply.cvAttach': 'Attach a CV',
        'apply.cvReplace': 'Choose a different file',
        'apply.cvRemove': 'Remove',
        'apply.cvTooLarge': `That file is larger than ${String(opts?.maxMb ?? '')} MB.`,
        'apply.cvUnsupported': 'Attach a PDF or a Word document (.pdf, .doc or .docx).',
        'apply.messagePlaceholder': 'Why are you a great fit?',
        'apply.submit': 'Submit Application',
        'apply.error': 'Application failed.',
        'apply.noAnswerFromServer': 'We did not get a reply in time. Your application may already have been sent.',
        'card.applications': opts ? `${String(opts.count ?? 0)} applications` : '0 applications',
        'card.remote': 'Remote',
        'applications.status.pending': 'Pending',
        'applications.status.reviewed': 'Reviewed',
        'applications.status.shortlisted': 'Shortlisted',
        'applications.status.interview': 'Interview',
        'applications.status.rejected': 'Rejected',
        'filters.type.paid': 'Paid',
        'filters.type.volunteer': 'Volunteer',
        'filters.type.timebank': 'Timebank',
        'filters.commitment.full_time': 'Full Time',
        'filters.commitment.part_time': 'Part Time',
        'filters.commitment.flexible': 'Flexible',
        'filters.commitment.one_off': 'One-off',
        'saved_profile.use': 'Use Saved Cover Letter',
        'common:errors.alertTitle': 'Error',
        'common:back': 'Back',
        'common:close': 'Close',
        'common:buttons.retry': 'Retry',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ tenant: { slug: 'hour-timebank' } }),
}));

let mockCurrentUserId = 3;

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: mockCurrentUserId, name: 'Current User' } }),
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
    errorBg: '#fff5f5',
    success: '#22c55e',
    warning: '#f59e0b',
  }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/api/jobs', () => ({
  getJobDetail: jest.fn(),
  getJobApplications: jest.fn(),
  applyToJob: jest.fn().mockResolvedValue(undefined),
  updateJobApplication: jest.fn().mockResolvedValue({ data: { message: 'Updated' } }),
  updateJobStatus: jest.fn().mockResolvedValue({ data: { id: 1 } }),
  saveJob: jest.fn().mockResolvedValue(undefined),
  unsaveJob: jest.fn().mockResolvedValue(undefined),
  getSavedProfile: jest.fn().mockResolvedValue(null),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('@/lib/haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/BottomSheet', () => ({
  __esModule: true,
  // The apply button lives in the sheet's sticky `footer`, so the mock must render it too.
  default: ({ visible, title, children, footer, onClose }: { visible: boolean; title?: string; children: React.ReactNode; footer?: React.ReactNode; onClose: () => void }) => {
    const { Text, View, Pressable } = require('react-native');
    return visible ? <View><Pressable testID="job-sheet-close" onPress={onClose} />{title ? <Text>{title}</Text> : null}{children}{footer}</View> : null;
  },
}));

const mockShowToast = jest.fn();
const mockPickCvFile = jest.fn();
jest.mock('@/lib/media/pickCvFile', () => ({
  CV_MAX_MB: 5,
  pickCvFile: (...args: unknown[]) => mockPickCvFile(...args),
}));
jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const hide = jest.fn();
  return { useAppToast: () => ({ show: mockShowToast, hide, isToastVisible: false }) };
});

// --- Tests ---

// A 3-button Android nav bar: the raw safe-area hook reports 0 inside modal routes,
// so the root-recorded value is what the screen must honour.
jest.mock('@/lib/ui/rootInsets', () => ({
  useBottomInset: () => 48,
  getRootBottomInset: () => 48,
  setRootBottomInset: jest.fn(),
}));

import { StyleSheet } from 'react-native';
import JobDetailScreen from './job-detail';
import { ApiResponseError } from '@/lib/api/client';
import { router } from 'expo-router';
import { applyToJob, getSavedProfile, updateJobApplication, updateJobStatus } from '@/lib/api/jobs';

const mockJob = {
  id: 1,
  title: 'Community Coordinator',
  description: 'Lead and coordinate community activities across the region.',
  location: 'Dublin',
  is_remote: false,
  type: 'paid' as const,
  commitment: 'full_time' as const,
  category: 'Community',
  skills_required: ['Communication', 'Leadership'],
  hours_per_week: 40,
  time_credits: null,
  salary_min: 30000,
  salary_max: 40000,
  salary_currency: '€',
  salary_type: 'annual' as const,
  salary_negotiable: false,
  deadline: null,
  status: 'open' as const,
  views_count: 50,
  applications_count: 3,
  is_featured: false,
  created_at: '2026-03-01T00:00:00Z',
  creator: { id: 2, name: 'Hour Timebank', avatar_url: null },
  organization: { id: 3, name: 'Dublin Community Hub', logo_url: null },
  is_saved: false,
  has_applied: false,
  match_percentage: null,
};

beforeEach(() => {
  mockJobId = '1';
  mockCurrentUserId = 3;
  mockUseApi.mockReturnValue({ data: null, isLoading: false, error: null, refresh: jest.fn() });
  jest.clearAllMocks();
});

describe('JobDetailScreen', () => {
  it('renders without crashing when data is loaded', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockJob },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { toJSON } = render(<JobDetailScreen />);
    expect(toJSON()).toBeTruthy();
  });

  // Same fault as the member profile (owner report, 2026-09-05): an absolutely
  // positioned action bar gets none of the SafeAreaView's padding, and inside a
  // modal route that padding is 0 on Android anyway.
  it('keeps the action bar clear of the Android navigation bar', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockJob },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByTestId } = render(<JobDetailScreen />);

    const footer = StyleSheet.flatten(getByTestId('job-detail-footer').props.style);
    expect(footer.paddingBottom).toBe(48 + 12);
  });

  it('renders the job title', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockJob },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<JobDetailScreen />);
    expect(getByText('Community Coordinator')).toBeTruthy();
  });

  it('renders the organisation name', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockJob },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<JobDetailScreen />);
    expect(getByText('Dublin Community Hub')).toBeTruthy();
  });

  it('renders the Apply Now button for open jobs', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockJob },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<JobDetailScreen />);
    expect(getByText('Apply Now')).toBeTruthy();
  });

  it('prevents opening an application when the server marks an open vacancy expired', () => {
    mockUseApi.mockReturnValue({ data: { data: { ...mockJob, status: 'open', accepting_applications: false } }, isLoading: false, error: null, refresh: jest.fn() });
    const screen = render(<JobDetailScreen />);
    fireEvent.press(screen.getByText('Apply Now'));
    expect(screen.queryByTestId('job-sheet-close')).toBeNull();
    expect(applyToJob).not.toHaveBeenCalled();
  });

  it('opens the edit route for the job owner', () => {
    mockCurrentUserId = 2;
    mockUseApi.mockReturnValue({
      data: { data: mockJob },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getAllByText, queryByText } = render(<JobDetailScreen />);
    expect(queryByText('Apply Now')).toBeNull();
    fireEvent.press(getAllByText('Edit')[0]);

    expect(router.push).toHaveBeenCalledWith({ pathname: '/(modals)/edit-job', params: { id: '1' } });
  });

  it('opens the native analytics route for the job owner', () => {
    mockCurrentUserId = 2;
    mockUseApi.mockReturnValue({
      data: { data: mockJob },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<JobDetailScreen />);
    fireEvent.press(getByText('Analytics'));

    expect(router.push).toHaveBeenCalledWith({ pathname: '/(modals)/job-analytics', params: { id: '1' } });
  });

  it('opens the native pipeline route for the job owner', () => {
    mockCurrentUserId = 2;
    mockUseApi.mockReturnValue({
      data: { data: mockJob },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<JobDetailScreen />);
    fireEvent.press(getByText('Pipeline'));

    expect(router.push).toHaveBeenCalledWith({ pathname: '/(modals)/job-pipeline', params: { id: '1' } });
  });

  it('renders owner applications and updates candidate status', async () => {
    mockCurrentUserId = 2;
    mockUseApi
      .mockReturnValueOnce({
        data: { data: mockJob },
        isLoading: false,
        error: null,
        refresh: jest.fn(),
      })
      .mockReturnValueOnce({
        data: {
          data: [{
            id: 44,
            vacancy_id: 1,
            applicant: { id: 9, name: 'Ava Candidate', avatar_url: null, email: 'ava@example.org' },
            message: 'I would love to help.',
            status: 'pending',
            created_at: '2026-03-11T00:00:00Z',
          }],
        },
        isLoading: false,
        error: null,
        refresh: jest.fn(),
      });

    const { getByText } = render(<JobDetailScreen />);

    expect(getByText('Applications')).toBeTruthy();
    expect(getByText('Ava Candidate')).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByText('Shortlist'));
      fireEvent.press(getByText('Reject'));
    });

    await waitFor(() => {
      expect(updateJobApplication).toHaveBeenCalledWith(44, { status: 'shortlisted' });
    });
    expect(updateJobApplication).toHaveBeenCalledTimes(1);
  });

  it.each(['accepted', 'rejected', 'withdrawn'])('does not offer progression actions for a %s application', (status) => {
    mockCurrentUserId = 2;
    mockUseApi.mockReturnValueOnce({ data: { data: mockJob }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: [{ id: 44, vacancy_id: 1, applicant: { id: 9, name: 'Ava Candidate' }, status, stage: status, created_at: '2026-03-11T00:00:00Z' }] }, isLoading: false, error: null, refresh: jest.fn() });
    const screen = render(<JobDetailScreen />);
    expect(screen.getByText('Ava Candidate')).toBeTruthy();
    expect(screen.queryByText('Shortlist')).toBeNull();
    expect(screen.queryByText('Reject')).toBeNull();
  });

  it('closes an open owner vacancy from owner tools', async () => {
    mockCurrentUserId = 2;
    const refresh = jest.fn();
    mockUseApi
      .mockReturnValueOnce({
        data: { data: mockJob },
        isLoading: false,
        error: null,
        refresh,
      })
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
        error: null,
        refresh: jest.fn(),
      });

    const { getByText } = render(<JobDetailScreen />);
    fireEvent.press(getByText('Close'));

    await waitFor(() => {
      expect(updateJobStatus).toHaveBeenCalledWith(1, 'closed');
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('renders the job description', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockJob },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<JobDetailScreen />);
    expect(getByText('Lead and coordinate community activities across the region.')).toBeTruthy();
  });

  it('renders loading state without crashing', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: true, error: null, refresh: jest.fn() });

    expect(() => render(<JobDetailScreen />)).not.toThrow();
  });

  it('renders not found state when data is null after loading', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<JobDetailScreen />);
    expect(getByText('Job not found.')).toBeTruthy();
    expect(getByText('Browse jobs')).toBeTruthy();
  });

  /**
   * 🔴 An application made from the phone went out with a covering message and nothing
   * else. `POST /v2/jobs/{id}/apply` has always accepted a `cv` part; the phone never sent
   * one, and a member who had saved a CV to their jobs profile was told nothing — the
   * server does NOT attach it for them, so the application arrived with nothing to read.
   */
  it('says plainly that no CV is attached, and mentions a saved one by name', async () => {
    (getSavedProfile as jest.Mock).mockResolvedValueOnce({ cv_filename: 'aoife-cv.pdf' });
    mockUseApi.mockReturnValue({ data: { data: mockJob }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<JobDetailScreen />);
    fireEvent.press(getByText('Apply Now'));
    await waitFor(() => expect(getSavedProfile).toHaveBeenCalled());

    expect(getByText('You have aoife-cv.pdf saved to your jobs profile. It is not attached for you.')).toBeTruthy();
  });

  it('says no CV is attached when the member has none saved either', async () => {
    (getSavedProfile as jest.Mock).mockResolvedValueOnce(null);
    mockUseApi.mockReturnValue({ data: { data: mockJob }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<JobDetailScreen />);
    fireEvent.press(getByText('Apply Now'));
    await waitFor(() => expect(getSavedProfile).toHaveBeenCalled());

    expect(getByText('No CV attached. Applications sent from this app include only your message unless you add one.')).toBeTruthy();
  });

  it('shows saved-profile loading instead of claiming there is no CV before the lookup finishes', async () => {
    let resolve!: (value: unknown) => void;
    (getSavedProfile as jest.Mock).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    mockUseApi.mockReturnValue({ data: { data: mockJob }, isLoading: false, error: null, refresh: jest.fn() });

    const screen = render(<JobDetailScreen />);
    fireEvent.press(screen.getByText('Apply Now'));
    expect(screen.getByText('Checking your saved jobs profile…')).toBeTruthy();
    expect(screen.queryByText('No CV attached. Applications sent from this app include only your message unless you add one.')).toBeNull();

    await act(async () => { resolve(null); });
    expect(screen.getByText('No CV attached. Applications sent from this app include only your message unless you add one.')).toBeTruthy();
  });

  it('shows a saved-profile failure and lets the member retry it', async () => {
    (getSavedProfile as jest.Mock)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({ cv_filename: 'retry-cv.pdf' });
    mockUseApi.mockReturnValue({ data: { data: mockJob }, isLoading: false, error: null, refresh: jest.fn() });

    const screen = render(<JobDetailScreen />);
    fireEvent.press(screen.getByText('Apply Now'));
    await waitFor(() => expect(screen.getByText('We could not check your saved CV or cover letter.')).toBeTruthy());
    expect(screen.queryByText('No CV attached. Applications sent from this app include only your message unless you add one.')).toBeNull();

    fireEvent.press(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('You have retry-cv.pdf saved to your jobs profile. It is not attached for you.')).toBeTruthy());
    expect(getSavedProfile).toHaveBeenCalledTimes(2);
  });

  it('locks the submitted cover message until a rejected request restores editing', async () => {
    mockUseApi.mockReturnValue({ data: { data: mockJob }, isLoading: false, error: null, refresh: jest.fn() });
    let reject!: (error: Error) => void;
    (applyToJob as jest.Mock).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const screen = render(<JobDetailScreen />);
    fireEvent.press(screen.getByText('Apply Now'));
    await waitFor(() => expect(getSavedProfile).toHaveBeenCalled());
    fireEvent.changeText(screen.getByLabelText('Cover Message'), 'I would like to help.');
    fireEvent.press(screen.getByText('Submit Application'));
    expect(screen.getByLabelText('Cover Message').props.editable).toBe(false);
    await act(async () => { reject(new Error('Offline')); });
    expect(screen.getByLabelText('Cover Message').props.editable).toBe(true);
    expect(screen.getByLabelText('Cover Message').props.value).toBe('I would like to help.');
  });

  it('preserves the draft when a vacancy closes after the application sheet opens', async () => {
    mockUseApi.mockReturnValue({ data: { data: mockJob }, isLoading: false, error: null, refresh: jest.fn() });
    (applyToJob as jest.Mock).mockRejectedValueOnce(new ApiResponseError(400, 'This vacancy is no longer accepting applications.'));
    const screen = render(<JobDetailScreen />);
    fireEvent.press(screen.getByText('Apply Now'));
    await waitFor(() => expect(getSavedProfile).toHaveBeenCalled());
    fireEvent.changeText(screen.getByLabelText('Cover Message'), 'My carefully written application.');
    fireEvent.press(screen.getByText('Submit Application'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'This vacancy is no longer accepting applications.' })));
    expect(screen.getByLabelText('Cover Message').props.value).toBe('My carefully written application.');
    expect(screen.getByLabelText('Cover Message').props.editable).toBe(true);
    fireEvent.press(screen.getByTestId('job-sheet-close'));
    await act(async () => { fireEvent.press(screen.getByText('Apply Now')); });
    expect(screen.getByLabelText('Cover Message').props.value).toBe('My carefully written application.');
    expect(applyToJob).toHaveBeenCalledTimes(1);
  });

  it('waits for the CV picker before sending the application', async () => {
    mockUseApi.mockReturnValue({ data: { data: mockJob }, isLoading: false, error: null, refresh: jest.fn() });
    let resolve!: (result: unknown) => void;
    mockPickCvFile.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const screen = render(<JobDetailScreen />);
    fireEvent.press(screen.getByText('Apply Now'));
    await waitFor(() => expect(getSavedProfile).toHaveBeenCalled());
    fireEvent.changeText(screen.getByLabelText('Cover Message'), 'Please see my CV.');
    fireEvent.press(screen.getByTestId('job-apply-attach-cv'));
    fireEvent.press(screen.getByText('Submit Application'));
    expect(applyToJob).not.toHaveBeenCalled();
    const file = { uri: 'file:///tmp/cv.pdf', name: 'cv.pdf', mimeType: 'application/pdf', size: 1024 };
    await act(async () => { resolve({ status: 'picked', file }); });
    await act(async () => { fireEvent.press(screen.getByText('Submit Application')); });
    expect(applyToJob).toHaveBeenCalledWith(1, 'Please see my CV.', file);
  });

  it('recovers from a rejected CV picker without losing the covering message', async () => {
    mockUseApi.mockReturnValue({ data: { data: mockJob }, isLoading: false, error: null, refresh: jest.fn() });
    mockPickCvFile.mockRejectedValueOnce(new Error('Picker unavailable'));
    const screen = render(<JobDetailScreen />);
    fireEvent.press(screen.getByText('Apply Now'));
    await waitFor(() => expect(getSavedProfile).toHaveBeenCalled());
    fireEvent.changeText(screen.getByLabelText('Cover Message'), 'Please see my CV.');
    await act(async () => { fireEvent.press(screen.getByTestId('job-apply-attach-cv')); });
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
    expect(screen.getByLabelText('Cover Message').props.value).toBe('Please see my CV.');
    const file = { uri: 'file:///tmp/retry.pdf', name: 'retry.pdf', mimeType: 'application/pdf', size: 1024 };
    mockPickCvFile.mockResolvedValueOnce({ status: 'picked', file });
    await act(async () => { fireEvent.press(screen.getByTestId('job-apply-attach-cv')); });
    expect(screen.getByText('retry.pdf')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByText('Submit Application')); });
    expect(applyToJob).toHaveBeenCalledWith(1, 'Please see my CV.', file);
  });

  it('keeps the covering message when a failed application sheet is reopened', async () => {
    mockUseApi.mockReturnValue({ data: { data: mockJob }, isLoading: false, error: null, refresh: jest.fn() });
    (applyToJob as jest.Mock).mockRejectedValueOnce(new Error('Offline'));
    const screen = render(<JobDetailScreen />);
    fireEvent.press(screen.getByText('Apply Now'));
    await waitFor(() => expect(getSavedProfile).toHaveBeenCalled());
    fireEvent.changeText(screen.getByLabelText('Cover Message'), 'My application draft.');
    await act(async () => { fireEvent.press(screen.getByText('Submit Application')); });
    fireEvent.press(screen.getByTestId('job-sheet-close'));
    await act(async () => { fireEvent.press(screen.getByText('Apply Now')); });
    expect(screen.getByLabelText('Cover Message').props.value).toBe('My application draft.');
  });

  it('does not carry an application draft into another job', async () => {
    mockUseApi.mockReturnValue({ data: { data: mockJob }, isLoading: false, error: null, refresh: jest.fn() });
    const screen = render(<JobDetailScreen />);
    fireEvent.press(screen.getByText('Apply Now'));
    await waitFor(() => expect(getSavedProfile).toHaveBeenCalled());
    fireEvent.changeText(screen.getByLabelText('Cover Message'), 'Only for the first job.');
    fireEvent.press(screen.getByTestId('job-sheet-close'));
    mockJobId = '2';
    mockUseApi.mockReturnValue({ data: { data: { ...mockJob, id: 2 } }, isLoading: false, error: null, refresh: jest.fn() });
    screen.rerender(<JobDetailScreen />);
    await act(async () => { fireEvent.press(screen.getByText('Apply Now')); });
    expect(screen.getByLabelText('Cover Message').props.value).toBe('');
  });

  it('does not apply an old submission response to the newly opened job', async () => {
    mockUseApi.mockReturnValue({ data: { data: mockJob }, isLoading: false, error: null, refresh: jest.fn() });
    let resolve!: () => void;
    (applyToJob as jest.Mock).mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    const screen = render(<JobDetailScreen />);
    fireEvent.press(screen.getByText('Apply Now'));
    await waitFor(() => expect(getSavedProfile).toHaveBeenCalled());
    fireEvent.changeText(screen.getByLabelText('Cover Message'), 'First job application.');
    fireEvent.press(screen.getByText('Submit Application'));
    mockJobId = '2';
    mockUseApi.mockReturnValue({ data: { data: { ...mockJob, id: 2 } }, isLoading: false, error: null, refresh: jest.fn() });
    screen.rerender(<JobDetailScreen />);
    await act(async () => { resolve(); });
    expect(screen.getByText('Apply Now')).toBeTruthy();
    expect(screen.queryByTestId('job-sheet-close')).toBeNull();
    expect(applyToJob).toHaveBeenCalledTimes(1);
    expect(applyToJob).toHaveBeenCalledWith(1, 'First job application.', null);
  });

  it('sends the CV the member attached, not just the message', async () => {
    mockPickCvFile.mockResolvedValueOnce({
      status: 'picked',
      file: { uri: 'file:///tmp/aoife-cv.pdf', name: 'aoife-cv.pdf', mimeType: 'application/pdf', size: 1024 },
    });
    mockUseApi.mockReturnValue({ data: { data: mockJob }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByLabelText, getByText, getByTestId, findByTestId } = render(<JobDetailScreen />);
    fireEvent.press(getByText('Apply Now'));
    await waitFor(() => expect(getSavedProfile).toHaveBeenCalled());

    fireEvent.press(getByTestId('job-apply-attach-cv'));
    expect(await findByTestId('job-apply-cv-attached')).toBeTruthy();

    fireEvent.changeText(getByLabelText('Cover Message'), 'I would like to help.');
    fireEvent.press(getByText('Submit Application'));

    await waitFor(() => expect(applyToJob).toHaveBeenCalledWith(1, 'I would like to help.', expect.objectContaining({
      name: 'aoife-cv.pdf',
      mimeType: 'application/pdf',
    })));
  });

  it('refuses a file the API would refuse, before the member fills in a message', async () => {
    mockPickCvFile.mockResolvedValueOnce({ status: 'too_large', maxMb: 5 });
    mockUseApi.mockReturnValue({ data: { data: mockJob }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText, getByTestId, queryByTestId } = render(<JobDetailScreen />);
    fireEvent.press(getByText('Apply Now'));
    await waitFor(() => expect(getSavedProfile).toHaveBeenCalled());

    fireEvent.press(getByTestId('job-apply-attach-cv'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' })));
    expect(queryByTestId('job-apply-cv-attached')).toBeNull();
  });

  it('uses the saved cover profile when submitting an application', async () => {
    (getSavedProfile as jest.Mock).mockResolvedValueOnce({ cover_text: 'I can support this role with community coordination experience.' });
    mockUseApi.mockReturnValue({
      data: { data: mockJob },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<JobDetailScreen />);

    fireEvent.press(getByText('Apply Now'));

    await waitFor(() => expect(getSavedProfile).toHaveBeenCalled());

    fireEvent.press(getByText('Use Saved Cover Letter'));
    fireEvent.press(getByText('Submit Application'));

    await waitFor(() => {
      expect(applyToJob).toHaveBeenCalledWith(1, 'I can support this role with community coordination experience.', null);
    });
  });
  /**
   * 🔴 A timeout here does NOT mean nothing happened.
   *
   * The endpoint writes the application row in its first second and then spends several
   * more sending two emails — measured at 9.5s against a 15s mutation timeout on
   * 2026-08-23. Saying "Application failed" sends the member back to try again, where the
   * server refuses them as a duplicate, so they conclude the platform is broken while the
   * employer already has their application.
   */
  it('tells a member their application may already have been sent when the server does not answer', async () => {
    (applyToJob as jest.Mock).mockRejectedValueOnce(new ApiResponseError(0, 'timeout'));
    (getSavedProfile as jest.Mock).mockResolvedValueOnce({ cover_text: 'Cover text.' });
    mockUseApi.mockReturnValue({ data: { data: mockJob }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<JobDetailScreen />);
    fireEvent.press(getByText('Apply Now'));
    await waitFor(() => expect(getSavedProfile).toHaveBeenCalled());
    fireEvent.press(getByText('Use Saved Cover Letter'));
    fireEvent.press(getByText('Submit Application'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
        description: expect.stringContaining('may already have been sent'),
        variant: 'danger',
      }));
    });
  });

  it('shows the server’s own refusal rather than a generic failure', async () => {
    (applyToJob as jest.Mock).mockRejectedValueOnce(
      new ApiResponseError(409, 'You have already applied to this vacancy'),
    );
    (getSavedProfile as jest.Mock).mockResolvedValueOnce({ cover_text: 'Cover text.' });
    mockUseApi.mockReturnValue({ data: { data: mockJob }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<JobDetailScreen />);
    fireEvent.press(getByText('Apply Now'));
    await waitFor(() => expect(getSavedProfile).toHaveBeenCalled());
    fireEvent.press(getByText('Use Saved Cover Letter'));
    fireEvent.press(getByText('Submit Application'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
        description: 'You have already applied to this vacancy',
      }));
    });
  });
});
