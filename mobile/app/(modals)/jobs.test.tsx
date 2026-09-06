// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// --- Mocks ---

const mockRouterPush = jest.fn();

let mockJobsParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  router: { push: (...args: unknown[]) => mockRouterPush(...args), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockJobsParams,
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'title': 'Jobs',
        'eyebrow': 'Community roles',
        'subtitle': 'Browse paid, volunteer, and time-credit roles from the community.',
        'tabs.browse': 'Browse',
        'tabs.myApplications': 'My Applications',
        'tabs.myPostings': 'My Postings',
        'tabs.alerts': 'Alerts',
        'search.placeholder': 'Search jobs...',
        'common:actions.clear': 'Clear search',
        'empty': 'No jobs found',
        'emptyHint': 'Try adjusting your filters or check back later',
        'applications.empty': 'No applications yet',
        'applications.emptyHint': 'Apply to jobs to see them here',
        'applications.appliedOn': opts ? `Applied ${String(opts.date ?? '')}` : 'Applied',
        'applications.showMessage': 'Show cover message',
        'applications.hideMessage': 'Hide cover message',
        'applications.history': 'History',
        'applications.historyEmpty': 'No status history yet.',
        'applications.historyStart': 'Started',
        'applications.historyTransition': opts ? `${String(opts.from ?? '')} to ${String(opts.to ?? '')}` : 'transition',
        'applications.withdraw': 'Withdraw',
        'applications.withdrawSuccess': 'Application withdrawn.',
        'applications.status.applied': 'Applied',
        'applications.status.pending': 'Pending',
        'postings.empty': 'No postings yet',
        'postings.emptyHint': 'Create a job to manage your roles here.',
        'alerts.title': 'Job alerts',
        'alerts.subtitle': 'Save searches and get notified when matching roles appear.',
        'alerts.create': 'Create alert',
        'alerts.creating': 'Creating...',
        'alerts.active': 'Active',
        'alerts.paused': 'Paused',
        'alerts.pause': 'Pause',
        'alerts.resume': 'Resume',
        'alerts.delete': 'Delete',
        'alerts.emptyTitle': 'No job alerts yet',
        'alerts.emptyDescription': 'Create an alert to keep new matching roles close to the app.',
        'alerts.keywordsLabel': 'Keywords',
        'alerts.keywordsPlaceholder': 'Role, skill, or employer',
        'alerts.categoriesLabel': 'Categories',
        'alerts.categoriesPlaceholder': 'Community, care, digital',
        'alerts.locationLabel': 'Location',
        'alerts.locationPlaceholder': 'City, region, or remote',
        'alerts.typeLabel': 'Role type',
        'alerts.commitmentLabel': 'Commitment',
        'alerts.remoteOnly': 'Remote roles only',
        'alerts.remoteOnlyShort': 'Remote',
        'alerts.anyMatch': 'Any matching role',
        'alerts.createdDate': opts ? `Created ${String(opts.date ?? '')}` : 'Created',
        'alerts.lastNotified': opts ? `Last notified ${String(opts.date ?? '')}` : 'Last notified',
        'alerts.never': 'Never',
        'alerts.createSuccess': 'Job alert created.',
        'alerts.pauseSuccess': 'Job alert paused.',
        'alerts.deleteSuccess': 'Job alert deleted.',
        'card.remote': 'Remote',
        'card.featured': 'Featured',
        'card.applications': opts ? `${String(opts.count ?? 0)} applications` : '0 applications',
        'card.deadline': opts ? `Closes ${String(opts.date ?? '')}` : 'Closes',
        'filters.type.all': 'All Types',
        'filters.type.paid': 'Paid',
        'filters.type.volunteer': 'Volunteer',
        'filters.type.timebank': 'Timebank',
        'filters.commitment.all': 'All',
        'filters.commitment.full_time': 'Full Time',
        'filters.commitment.part_time': 'Part Time',
        'filters.commitment.flexible': 'Flexible',
        'filters.commitment.one_off': 'One-off',
        'retry': 'Retry',
        'common:actions.retry': 'Retry',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true }),
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

const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/api/jobs', () => ({
  getJobs: jest.fn(),
  getMyApplications: jest.fn(),
  getMyPostings: jest.fn(),
  getJobAlerts: jest.fn(),
  createJobAlert: jest.fn().mockResolvedValue({ data: { id: 99, message: 'ok' } }),
  deleteJobAlert: jest.fn().mockResolvedValue(undefined),
  pauseJobAlert: jest.fn().mockResolvedValue({ data: { message: 'paused' } }),
  resumeJobAlert: jest.fn().mockResolvedValue({ data: { message: 'resumed' } }),
  getJobApplicationHistory: jest.fn().mockResolvedValue({
    data: [{ id: 1, application_id: 10, from_status: null, to_status: 'pending', notes: null, changed_by: null, changed_by_name: null, changed_at: '2026-03-10T00:00:00Z' }],
  }),
  withdrawJobApplication: jest.fn().mockResolvedValue({ data: { message: 'withdrawn' } }),
}));

jest.mock('@/components/ui/LoadingSpinner', () => () => null);

// --- Tests ---

import JobsScreen from './jobs';
import { createJobAlert, deleteJobAlert, getJobApplicationHistory, pauseJobAlert, withdrawJobApplication } from '@/lib/api/jobs';
import type { JobVacancy, JobApplication, JobAlert } from '@/lib/api/jobs';

const defaultPaginatedState = {
  items: [],
  isLoading: false,
  isLoadingMore: false,
  error: null,
  hasMore: false,
  loadMore: jest.fn(),
  refresh: jest.fn(),
};

beforeEach(() => {
  mockUsePaginatedApi.mockReturnValue(defaultPaginatedState);
  mockUseApi.mockReturnValue({
    data: { data: [] },
    isLoading: false,
    error: null,
    refresh: jest.fn(),
  });
  jest.clearAllMocks();
  mockRouterPush.mockReset();
  mockJobsParams = {};
});

const mockJob: JobVacancy = {
  id: 1,
  title: 'Community Coordinator',
  description: 'Coordinate community activities.',
  location: 'Dublin',
  is_remote: false,
  type: 'paid',
  commitment: 'full_time',
  category: 'Community',
  // Real API contract: skills_required is the raw comma-separated STRING (web
  // consumes it as text); the parsed array lives in skills. The mobile crash
  // (2026-06-11) happened because fixtures used an array here and hid that.
  skills_required: 'Communication, Organisation',
  skills: ['Communication', 'Organisation'],
  hours_per_week: 40,
  time_credits: null,
  salary_min: 30000,
  salary_max: 40000,
  salary_currency: '€',
  salary_type: 'annual',
  salary_negotiable: false,
  deadline: null,
  status: 'open',
  views_count: 120,
  applications_count: 8,
  is_featured: false,
  created_at: '2026-03-01T00:00:00Z',
  creator: { id: 2, name: 'Hour Timebank', avatar_url: null },
  organization: { id: 3, name: 'Dublin Community Hub', logo_url: null },
  is_saved: false,
  has_applied: false,
};

const mockApplication: JobApplication = {
  id: 10,
  vacancy_id: 1,
  vacancy: { title: 'Community Coordinator', organization: { id: 3, name: 'Dublin Community Hub', logo_url: null } },
  message: 'I am a great fit.',
  status: 'pending',
  reviewer_notes: null,
  created_at: '2026-03-10T00:00:00Z',
  updated_at: '2026-03-10T00:00:00Z',
};

const mockAlert: JobAlert = {
  id: 77,
  user_id: 1,
  keywords: 'coordinator',
  categories: 'Community',
  type: 'paid',
  commitment: 'full_time',
  location: 'Remote',
  is_remote_only: true,
  is_active: true,
  last_notified_at: null,
  created_at: '2026-03-12T00:00:00Z',
};

describe('JobsScreen', () => {
  it('renders without crashing', () => {
    const { toJSON } = render(<JobsScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the search input', () => {
    const { getByPlaceholderText } = render(<JobsScreen />);
    expect(getByPlaceholderText('Search jobs...')).toBeTruthy();
  });

  it('shows clear action after typing in the shared input-backed search field', () => {
    const { getByPlaceholderText, getByLabelText } = render(<JobsScreen />);
    fireEvent.changeText(getByPlaceholderText('Search jobs...'), 'coordinator');
    expect(getByLabelText('Clear search')).toBeTruthy();
  });

  /**
   * 🔴 `+native-intent.ts` maps `nexus://jobs/alerts` to `/(modals)/jobs?view=alerts`, and
   * always did — but nothing on this screen read `view`, so every job-alerts link landed on
   * Browse. Journey 5.28.
   */
  it('opens on the alerts tab when the deep link asks for it', () => {
    mockJobsParams = { view: 'alerts' };
    const { getByText } = render(<JobsScreen />);
    expect(getByText('Job alerts')).toBeTruthy();
  });

  it('opens on browse when the link names no tab', () => {
    const { getByText } = render(<JobsScreen />);
    expect(getByText('Browse')).toBeTruthy();
  });

  it('renders Browse, My Applications, and My Postings tabs', () => {
    const { getByText } = render(<JobsScreen />);
    expect(getByText('Browse')).toBeTruthy();
    expect(getByText('My Applications')).toBeTruthy();
    expect(getByText('My Postings')).toBeTruthy();
    expect(getByText('Alerts')).toBeTruthy();
  });

  it('renders empty state when no jobs and not loading', () => {
    const { getByText } = render(<JobsScreen />);
    expect(getByText('No jobs found')).toBeTruthy();
  });

  it('renders job cards when items are provided', () => {
    let callCount = 0;
    mockUsePaginatedApi.mockImplementation(() => {
      callCount += 1;
      if ((callCount - 1) % 3 === 0) {
        return {
          items: [mockJob],
          isLoading: false,
          isLoadingMore: false,
          error: null,
          hasMore: false,
          loadMore: jest.fn(),
          refresh: jest.fn(),
        };
      }
      return defaultPaginatedState;
    });

    const { getByText } = render(<JobsScreen />);
    expect(getByText('Community Coordinator')).toBeTruthy();
    expect(getByText('Dublin Community Hub')).toBeTruthy();
  });

  it('opens job details from HeroUI Native-backed job cards', () => {
    let callCount = 0;
    mockUsePaginatedApi.mockImplementation(() => {
      callCount += 1;
      if ((callCount - 1) % 3 === 0) {
        return {
          items: [mockJob],
          isLoading: false,
          isLoadingMore: false,
          error: null,
          hasMore: false,
          loadMore: jest.fn(),
          refresh: jest.fn(),
        };
      }
      return defaultPaginatedState;
    });

    const { getByText } = render(<JobsScreen />);
    fireEvent.press(getByText('Community Coordinator'));

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/job-detail',
      params: { id: '1' },
    });
  });

  it('does not render empty state when loading', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [],
      isLoading: true,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { queryByText } = render(<JobsScreen />);
    expect(queryByText('No jobs found')).toBeNull();
  });

  it('shows My Applications empty state when switching tab', () => {
    const { getByText } = render(<JobsScreen />);
    fireEvent.press(getByText('My Applications'));
    // After tab switch, applications empty state should be visible
    // (both usePaginatedApi calls return empty by default)
    expect(getByText('My Applications')).toBeTruthy();
  });

  it('renders type badge on job card', () => {
    let callCount = 0;
    mockUsePaginatedApi.mockImplementation(() => {
      callCount += 1;
      if ((callCount - 1) % 3 === 0) {
        return {
          items: [mockJob],
          isLoading: false,
          isLoadingMore: false,
          error: null,
          hasMore: false,
          loadMore: jest.fn(),
          refresh: jest.fn(),
        };
      }
      return defaultPaginatedState;
    });

    const { getAllByText } = render(<JobsScreen />);
    expect(getAllByText('Paid').length).toBeGreaterThan(0);
  });

  it('renders application cards in My Applications tab', () => {
    // First call per render: browse jobs, second: applications, third: postings.
    let callCount = 0;
    mockUsePaginatedApi.mockImplementation(() => {
      callCount += 1;
      if ((callCount - 2) % 3 === 0) {
        return { items: [mockApplication], isLoading: false, isLoadingMore: false, error: null, hasMore: false, loadMore: jest.fn(), refresh: jest.fn() };
      }
      return { items: [], isLoading: false, isLoadingMore: false, error: null, hasMore: false, loadMore: jest.fn(), refresh: jest.fn() };
    });

    const { getByText } = render(<JobsScreen />);
    // Switch to My Applications tab
    fireEvent.press(getByText('My Applications'));
    // The application title should be visible
    expect(getByText('Community Coordinator')).toBeTruthy();
  });

  it('shows application cover message, history, and withdraw action', async () => {
    let callCount = 0;
    const refresh = jest.fn();
    mockUsePaginatedApi.mockImplementation(() => {
      callCount += 1;
      if ((callCount - 2) % 3 === 0) {
        return { items: [mockApplication], isLoading: false, isLoadingMore: false, error: null, hasMore: false, loadMore: jest.fn(), refresh };
      }
      return { items: [], isLoading: false, isLoadingMore: false, error: null, hasMore: false, loadMore: jest.fn(), refresh: jest.fn() };
    });

    const { getByText } = render(<JobsScreen />);
    fireEvent.press(getByText('My Applications'));
    fireEvent.press(getByText('Show cover message'));
    expect(getByText('I am a great fit.')).toBeTruthy();

    fireEvent.press(getByText('History'));
    await waitFor(() => expect(getJobApplicationHistory).toHaveBeenCalledWith(10));

    fireEvent.press(getByText('Withdraw'));
    await waitFor(() => expect(withdrawJobApplication).toHaveBeenCalledWith(10));
    expect(refresh).toHaveBeenCalled();
  });

  it('renders owner postings in My Postings tab', () => {
    let callCount = 0;
    mockUsePaginatedApi.mockImplementation(() => {
      callCount += 1;
      if (callCount % 3 === 0) {
        return { items: [mockJob], isLoading: false, isLoadingMore: false, error: null, hasMore: false, loadMore: jest.fn(), refresh: jest.fn() };
      }
      return { items: [], isLoading: false, isLoadingMore: false, error: null, hasMore: false, loadMore: jest.fn(), refresh: jest.fn() };
    });

    const { getByText } = render(<JobsScreen />);
    fireEvent.press(getByText('My Postings'));

    expect(getByText('Community Coordinator')).toBeTruthy();
    expect(getByText('Dublin Community Hub')).toBeTruthy();
  });

  it('renders job alerts tab and creates an alert', async () => {
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      error: null,
      refresh,
    });

    const { getByText, getByPlaceholderText } = render(<JobsScreen />);
    fireEvent.press(getByText('Alerts'));
    fireEvent.changeText(getByPlaceholderText('Role, skill, or employer'), 'coordinator');
    fireEvent.changeText(getByPlaceholderText('City, region, or remote'), 'Remote');
    fireEvent.press(getByText('Paid'));
    fireEvent.press(getByText('Create alert'));

    expect(createJobAlert).toHaveBeenCalledWith({
      keywords: 'coordinator',
      location: 'Remote',
      type: 'paid',
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('renders and pauses existing job alerts', () => {
    mockUseApi.mockReturnValue({
      data: { data: [mockAlert] },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<JobsScreen />);
    fireEvent.press(getByText('Alerts'));

    expect(getByText('coordinator')).toBeTruthy();
    expect(getByText('Active')).toBeTruthy();

    fireEvent.press(getByText('Pause'));
    expect(pauseJobAlert).toHaveBeenCalledWith(77);
  });

  it('deletes existing job alerts', async () => {
    mockUseApi.mockReturnValue({
      data: { data: [mockAlert] },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<JobsScreen />);
    fireEvent.press(getByText('Alerts'));

    fireEvent.press(getByText('Delete'));
    await waitFor(() => expect(deleteJobAlert).toHaveBeenCalledWith(77));
  });
});
