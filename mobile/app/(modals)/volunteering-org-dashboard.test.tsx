// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockPush = jest.fn();
let mockRouteParams: Record<string, string> = { id: '5' };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockRouteParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'org.title': 'Organisation dashboard',
        'org.dashboardEyebrow': 'Organiser tools',
        'org.invalid': 'Organisation not found.',
        'org.loadError': 'Could not load this organisation dashboard.',
        'org.statsUnavailable': 'Organisation stats are unavailable.',
        'org.reviewApplications': 'Review applications',
        'org.reviewHours': 'Review hours',
        'org.postOpportunity': 'Post opportunity',
        'org.tabs.overview': 'Overview',
        'org.tabs.applications': 'Applications',
        'org.tabs.hours': 'Hours review',
        'org.tabs.volunteers': 'Volunteers',
        'org.tabs.wallet': 'Wallet',
        'org.tabs.settings': 'Settings',
        'org.stats.volunteers': 'Volunteers',
        'org.stats.pendingApplications': 'Applications',
        'org.stats.pendingHours': 'Hours to review',
        'org.stats.walletBalance': 'Wallet',
        'org.stats.approvedHours': 'Approved hours',
        'org.stats.activeOpportunities': 'Active opportunities',
        'org.status.pending': 'Pending',
        'org.status.approved': 'Approved',
        'org.applications.empty': 'No applications to review.',
        'org.applications.applied': opts ? `Applied ${String(opts.date ?? '')}` : 'Applied',
        'org.applications.actionError': 'Could not update this application.',
        'org.hours.empty': 'No hours are waiting for review.',
        'org.hours.approve': 'Approve hours',
        'org.hours.decline': 'Decline',
        'org.volunteers.empty': 'No approved volunteers yet.',
        'org.volunteers.summary': opts ? `${String(opts.hours ?? 0)}h across ${String(opts.count ?? 0)} applications` : '0h across 0 applications',
        'org.volunteers.openProfile': opts ? `Open profile for ${String(opts.name ?? '')}` : 'Open profile',
        'org.wallet.balance': 'Wallet balance',
        'org.wallet.autoPayToggle': 'Toggle auto-pay',
        'org.wallet.autoPayOn': 'Auto-pay is on for approved hours.',
        'org.wallet.autoPayOff': 'Auto-pay is off. Approved hours will need manual payment.',
        'org.wallet.amountPlaceholder': 'Amount',
        'org.wallet.notePlaceholder': 'Optional note',
        'org.wallet.deposit': 'Deposit credits',
        'org.wallet.transactions': 'Transactions',
        'org.wallet.empty': 'No wallet transactions yet.',
        'org.wallet.transactionFallback': 'Wallet transaction',
        'org.settings.heading': 'Organisation settings',
        'org.settings.namePlaceholder': 'Organisation name',
        'org.settings.descriptionPlaceholder': 'Description',
        'org.settings.emailPlaceholder': 'Contact email',
        'org.settings.websitePlaceholder': 'Website',
        'org.settings.save': 'Save organisation',
        'applications.approve': 'Approve',
        'applications.decline': 'Decline',
        'hoursValue': opts ? `${String(opts.count ?? 0)}h` : '0h',
        'tryAgain': 'Try again',
        'common:back': 'Back',
        'common:errors.alertTitle': 'Error',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#6366f1' }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#fff',
    surface: '#f8f9fa',
    text: '#111',
    textSecondary: '#666',
    textMuted: '#999',
    error: '#dc2626',
    success: '#16a34a',
    warning: '#f59e0b',
  }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/Avatar', () => 'View');

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

jest.mock('@/lib/api/volunteering', () => ({
  depositOrganisationWallet: jest.fn().mockResolvedValue({ data: {} }),
  getOrganisation: jest.fn(),
  getOrganisationApplications: jest.fn(),
  getOrganisationPendingHours: jest.fn(),
  getOrganisationStats: jest.fn(),
  getOrganisationVolunteers: jest.fn(),
  getOrganisationWalletTransactions: jest.fn(),
  handleVolunteerApplication: jest.fn().mockResolvedValue({ data: {} }),
  setOrganisationAutoPay: jest.fn().mockResolvedValue({ data: {} }),
  updateOrganisation: jest.fn().mockResolvedValue({ data: {} }),
  verifyVolunteerHours: jest.fn().mockResolvedValue({ data: {} }),
}));

import VolunteeringOrgDashboard from './volunteering-org-dashboard';

function mockDashboardApis() {
  let call = 0;
  const refresh = jest.fn();
  mockUseApi.mockImplementation(() => {
    const responses = [
      {
        data: { data: { id: 5, name: 'Green Spaces', description: 'Community gardens.', status: 'approved', balance: 14, auto_pay_enabled: true } },
        isLoading: false,
        error: null,
        refresh,
      },
      {
        data: { data: { org_name: 'Green Spaces', total_volunteers: 3, pending_applications: 1, pending_hours: 2, total_approved_hours: 22, active_opportunities: 4, wallet_balance: 14, auto_pay_enabled: true } },
        isLoading: false,
        error: null,
        refresh,
      },
      {
        data: { data: { items: [{ id: 7, status: 'pending', message: 'I can help', created_at: '2026-05-01T00:00:00Z', user: { id: 9, name: 'Alex Volunteer', avatar_url: null }, opportunity: { id: 3, title: 'Garden Helper' }, shift: null }], cursor: null, has_more: false } },
        isLoading: false,
        error: null,
        refresh,
      },
      {
        data: { data: { items: [{ id: 12, hours: 2, date: '2026-05-02', description: 'Watered beds', status: 'pending', created_at: '2026-05-02T00:00:00Z', user: { id: 9, name: 'Alex Volunteer', avatar_url: null }, opportunity: { id: 3, title: 'Garden Helper' } }], cursor: null, has_more: false } },
        isLoading: false,
        error: null,
        refresh,
      },
      {
        data: { data: { items: [{ id: 9, name: 'Alex Volunteer', avatar_url: null, total_hours: 8, applications_count: 2, applied_at: '2026-05-01' }], cursor: null, has_more: false } },
        isLoading: false,
        error: null,
        refresh,
      },
      {
        data: { data: { items: [{ id: 99, type: 'deposit', amount: 5, note: 'Top-up', created_at: '2026-05-03T00:00:00Z' }], cursor: null, has_more: false } },
        isLoading: false,
        error: null,
        refresh,
      },
    ];
    const response = responses[call % responses.length];
    call += 1;
    return response;
  });
}

describe('VolunteeringOrgDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { id: '5' };
    mockDashboardApis();
  });

  it('renders the native organisation overview', () => {
    const { getAllByText, getByText } = render(<VolunteeringOrgDashboard />);
    expect(getAllByText('Green Spaces').length).toBeGreaterThan(0);
    expect(getByText('Community gardens.')).toBeTruthy();
    expect(getByText('22h')).toBeTruthy();
    expect(getByText('Review applications')).toBeTruthy();
  });

  it('opens the applications tab named by a notification deep link', () => {
    mockRouteParams = { id: '5', tab: 'applications' };
    const { getByText } = render(<VolunteeringOrgDashboard />);

    expect(getByText('Alex Volunteer')).toBeTruthy();
    expect(getByText('I can help')).toBeTruthy();
  });

  it('switches through organiser workflow tabs', () => {
    const { getByText, getAllByText } = render(<VolunteeringOrgDashboard />);

    fireEvent.press(getAllByText('Applications')[0]);
    expect(getByText('Alex Volunteer')).toBeTruthy();
    expect(getByText('I can help')).toBeTruthy();

    fireEvent.press(getByText('Hours review'));
    expect(getByText('Watered beds')).toBeTruthy();
    expect(getByText('Approve hours')).toBeTruthy();

    fireEvent.press(getAllByText('Volunteers')[0]);
    expect(getByText('8h across 2 applications')).toBeTruthy();

    fireEvent.press(getAllByText('Wallet')[0]);
    expect(getByText('Top-up')).toBeTruthy();
    expect(getByText('Deposit credits')).toBeTruthy();
  });
});
