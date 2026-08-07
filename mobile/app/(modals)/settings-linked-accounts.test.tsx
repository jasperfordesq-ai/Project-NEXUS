// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockRefresh = jest.fn();
const mockRequestSubAccount = jest.fn();
const mockApproveSubAccount = jest.fn();
const mockRevokeSubAccount = jest.fn();
const mockUpdateSubAccountPermissions = jest.fn();
const mockUpdateSubAccountTiers = jest.fn();
const mockGetSubAccountActivity = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:buttons.back': 'Back',
        'common:errors.alertTitle': 'Error',
        'linkedAccounts.title': 'Linked accounts',
        'linkedAccounts.eyebrow': 'Delegated access',
        'linkedAccounts.subtitle': 'Request and manage account relationships.',
        'linkedAccounts.addTitle': 'Request linked account access',
        'linkedAccounts.addDescription': 'Send a request by email.',
        'linkedAccounts.emailLabel': 'Member email',
        'linkedAccounts.emailPlaceholder': 'member@example.com',
        'linkedAccounts.sendRequest': 'Send request',
        'linkedAccounts.sending': 'Sending...',
        'linkedAccounts.emailRequired': 'Enter the member email address.',
        'linkedAccounts.requestFailed': 'Could not send request.',
        'linkedAccounts.loadFailed': 'Could not load linked accounts.',
        'linkedAccounts.managedTitle': 'Accounts you manage',
        'linkedAccounts.managedDescription': 'People who granted access.',
        'linkedAccounts.managedEmpty': 'You are not managing any accounts yet.',
        'linkedAccounts.managersTitle': 'People who manage you',
        'linkedAccounts.managersDescription': 'Members who can help manage your account.',
        'linkedAccounts.managersEmpty': 'No one is managing your account.',
        'linkedAccounts.unknownMember': 'Community member',
        'linkedAccounts.permissionsTitle': 'Permissions',
        'linkedAccounts.approve': 'Approve',
        'linkedAccounts.decline': 'Decline',
        'linkedAccounts.remove': 'Remove',
        'linkedAccounts.approveFailed': 'Could not approve this request.',
        'linkedAccounts.revokeFailed': 'Could not remove this linked account.',
        'linkedAccounts.permissionFailed': 'Could not update permission.',
        'linkedAccounts.permissionToggle': `Toggle ${String(opts?.permission ?? '')} for ${String(opts?.name ?? '')}`,
        'linkedAccounts.status.active': 'Active',
        'linkedAccounts.status.pending': 'Pending',
        'linkedAccounts.permissions.can_view_activity': 'View activity',
        'linkedAccounts.permissions.can_manage_listings': 'Manage listings',
        'linkedAccounts.permissions.can_transact': 'Transfer credits',
        'linkedAccounts.permissions.can_view_messages': 'View messages',
        'linkedAccounts.activity.show': 'See their activity',
        'linkedAccounts.activity.hide': 'Hide their activity',
        'linkedAccounts.activity.toggleAria': `See the activity of ${String(opts?.name ?? '')}`,
        'linkedAccounts.activity.explainer': `A summary of what ${String(opts?.name ?? '')} has been doing.`,
        'linkedAccounts.activity.loadFailed': 'Their activity could not be loaded. The permission may have been changed.',
        'linkedAccounts.activity.hoursHeading': 'Time credits',
        'linkedAccounts.activity.hoursGiven': 'Hours given',
        'linkedAccounts.activity.hoursReceived': 'Hours received',
        'linkedAccounts.activity.netBalance': 'Net balance',
        'linkedAccounts.activity.communityHeading': 'Community',
        'linkedAccounts.activity.connections': 'Connections',
        'linkedAccounts.activity.groups': 'Groups joined',
        'linkedAccounts.activity.posts': 'Posts (30 days)',
        'linkedAccounts.activity.timelineHeading': 'Recent activity',
        'linkedAccounts.activity.timelineEmpty': 'Nothing recent to show.',
        'linkedAccounts.activity.types.post': 'Posted',
        'linkedAccounts.activity.types.gave_hours': 'Gave hours',
        'linkedAccounts.activity.types.other': 'Activity',
      };
      return map[key] ?? String(opts?.defaultValue ?? key);
    },
  }),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));
jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#6366f1' }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#000',
    textSecondary: '#666',
    textMuted: '#999',
  }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/lib/api/settings', () => ({
  approveSubAccount: (...args: unknown[]) => mockApproveSubAccount(...args),
  getManagedSubAccounts: jest.fn(),
  getManagerSubAccounts: jest.fn(),
  getSubAccountActivity: (...args: unknown[]) => mockGetSubAccountActivity(...args),
  requestSubAccount: (...args: unknown[]) => mockRequestSubAccount(...args),
  revokeSubAccount: (...args: unknown[]) => mockRevokeSubAccount(...args),
  updateSubAccountPermissions: (...args: unknown[]) => mockUpdateSubAccountPermissions(...args),
  updateSubAccountTiers: (...args: unknown[]) => mockUpdateSubAccountTiers(...args),
  // The real resolver is pure — use it, so the tests exercise the actual
  // tier derivation rather than a parallel reimplementation.
  resolveSupportTiers: jest.requireActual('@/lib/api/settings').resolveSupportTiers,
}));

import SettingsLinkedAccountsRoute from './settings-linked-accounts';

beforeEach(() => {
  mockRefresh.mockReset();
  mockRequestSubAccount.mockReset().mockResolvedValue({});
  mockApproveSubAccount.mockReset().mockResolvedValue({});
  mockRevokeSubAccount.mockReset().mockResolvedValue({});
  mockUpdateSubAccountPermissions.mockReset().mockResolvedValue({});
  mockUpdateSubAccountTiers.mockReset().mockResolvedValue({});
  mockGetSubAccountActivity.mockReset().mockResolvedValue({
    hours_summary: { hours_given: 7.5, hours_received: 2, net_balance: -5.5 },
    connection_stats: { total_connections: 3, groups_joined: 1 },
    engagement: { posts_count: 4 },
    timeline: [
      { id: 1, activity_type: 'gave_hours', description: '2 hour(s)', created_at: '2026-08-01T10:00:00Z' },
      { id: 2, activity_type: 'brand_new_type', description: 'Mystery item', created_at: '2026-08-02T10:00:00Z' },
    ],
  });
  mockUseApi.mockReset().mockReturnValue({
    data: {
      managed: [{
        relationship_id: 11,
        relationship_type: 'family',
        permissions: { can_view_activity: true, can_transact: false },
        status: 'active',
        created_at: '2026-01-01T00:00:00Z',
        user_id: 5,
        first_name: 'Alex',
        last_name: 'Managed',
        avatar_url: null,
        email: 'alex@example.com',
      }],
      managers: [{
        relationship_id: 12,
        relationship_type: 'family',
        permissions: {},
        status: 'pending',
        created_at: '2026-01-01T00:00:00Z',
        user_id: 6,
        first_name: 'Morgan',
        last_name: 'Manager',
        avatar_url: null,
        email: 'morgan@example.com',
      }],
    },
    isLoading: false,
    error: null,
    refresh: mockRefresh,
  });
});

describe('SettingsLinkedAccountsRoute', () => {
  it('renders managed and manager linked account relationships', () => {
    const { getByText } = render(<SettingsLinkedAccountsRoute />);

    expect(getByText('Linked accounts')).toBeTruthy();
    expect(getByText('Alex Managed')).toBeTruthy();
    expect(getByText('Morgan Manager')).toBeTruthy();
    expect(getByText('View activity')).toBeTruthy();
  });

  it('requests linked account access by email', async () => {
    const { getByPlaceholderText, getByText } = render(<SettingsLinkedAccountsRoute />);

    fireEvent.changeText(getByPlaceholderText('member@example.com'), 'child@example.com');
    fireEvent.press(getByText('Send request'));

    await waitFor(() => expect(mockRequestSubAccount).toHaveBeenCalledWith('child@example.com'));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('approves pending requests, revokes relationships, and updates permissions', async () => {
    const { getAllByText, getByLabelText, getByText } = render(<SettingsLinkedAccountsRoute />);

    // Enabling from OFF grants the recommended middle level (prepare only) as
    // an EXPLICIT tier — never a boolean, which the backend maps to act-alone.
    fireEvent(getByLabelText('Toggle Transfer credits for Alex Managed'), 'selectedChange', true);
    await waitFor(() => expect(mockUpdateSubAccountTiers).toHaveBeenCalledWith(11, { credits: 'co_decide' }));
    expect(mockUpdateSubAccountPermissions).not.toHaveBeenCalled();

    fireEvent.press(getByText('Approve'));
    await waitFor(() => expect(mockApproveSubAccount).toHaveBeenCalledWith(12));

    fireEvent.press(getAllByText('Remove')[0]);
    await waitFor(() => expect(mockRevokeSubAccount).toHaveBeenCalledWith(11));
  });

  // 🔴 The messages switch saved successfully and did nothing — no backend
  // code consults can_view_messages. Web and accessible removed it 2026-08-05;
  // mobile kept offering it until 2026-08-06. It must not come back without
  // the counterparty notice existing.
  it('does not offer the unenforced View messages permission', () => {
    const { queryByText } = render(<SettingsLinkedAccountsRoute />);

    expect(queryByText('View messages')).toBeNull();
  });

  /**
   * 🔴 The escalation bug this screen used to have: a co_decide ("prepare
   * only") grant projects to boolean false, so it rendered as an OFF toggle —
   * and "turning it on" posted a boolean the backend mapped to full act-alone
   * power. The toggle must render ON for any granted level, and switching it
   * must speak tiers, never booleans.
   */
  it('renders a co_decide grant as ON and never escalates it', async () => {
    mockUseApi.mockReturnValue({
      data: {
        managed: [{
          relationship_id: 31,
          relationship_type: 'family',
          permissions: {
            can_view_activity: true,
            can_manage_listings: false, // lossy projection of co_decide
            can_transact: false,
            tiers: { activity: 'assist', listings: 'co_decide', credits: 'none' },
          },
          status: 'active',
          created_at: '2026-01-01T00:00:00Z',
          user_id: 9,
          first_name: 'Prepared',
          last_name: 'Person',
          avatar_url: null,
          email: 'prepared@example.com',
        }],
        managers: [],
      },
      isLoading: false,
      error: null,
      refresh: mockRefresh,
    });

    const { getByLabelText } = render(<SettingsLinkedAccountsRoute />);

    const listingsToggle = getByLabelText('Toggle Manage listings for Prepared Person');
    // Renders ON despite the false boolean — the tier is the truth.
    expect(listingsToggle.props.accessibilityState?.checked ?? listingsToggle.props.value).toBeTruthy();

    // Toggling it sends an explicit tier change to OFF — no boolean write,
    // and nothing that could read as a grant of a higher level.
    fireEvent(listingsToggle, 'selectedChange', false);
    await waitFor(() => expect(mockUpdateSubAccountTiers).toHaveBeenCalledWith(31, { listings: 'none' }));
    expect(mockUpdateSubAccountPermissions).not.toHaveBeenCalled();
    const everSentRepresent = mockUpdateSubAccountTiers.mock.calls.some(
      ([, tiers]) => Object.values(tiers as Record<string, string>).includes('represent'),
    );
    expect(everSentRepresent).toBe(false);
  });

  describe('activity view', () => {
    it('expands, loads the activity endpoint, and renders the summary read-only', async () => {
      const { getByText, findByText, queryByText } = render(<SettingsLinkedAccountsRoute />);

      // Nothing fetched until the member asks to see it.
      expect(mockGetSubAccountActivity).not.toHaveBeenCalled();

      fireEvent.press(getByText('See their activity'));

      await waitFor(() => expect(mockGetSubAccountActivity).toHaveBeenCalledWith(5));
      expect(await findByText('Hours given')).toBeTruthy();
      expect(getByText('7.5')).toBeTruthy();
      expect(getByText('2 hour(s)')).toBeTruthy();
      // Unknown server vocabulary renders the generic label, never the code.
      expect(getByText('Activity')).toBeTruthy();
      expect(queryByText('brand_new_type')).toBeNull();
      // Read-only: no prepare/act affordances exist in this section.
      expect(queryByText('Do it now')).toBeNull();
    });

    it('offers no activity section when the grant is off', () => {
      mockUseApi.mockReturnValue({
        data: {
          managed: [{
            relationship_id: 21,
            relationship_type: 'family',
            permissions: { can_view_activity: false },
            status: 'active',
            created_at: '2026-01-01T00:00:00Z',
            user_id: 7,
            first_name: 'No',
            last_name: 'Grant',
            avatar_url: null,
            email: 'nogrant@example.com',
          }],
          managers: [],
        },
        isLoading: false,
        error: null,
        refresh: mockRefresh,
      });

      const { queryByText } = render(<SettingsLinkedAccountsRoute />);

      expect(queryByText('See their activity')).toBeNull();
    });

    it('says plainly when the activity can no longer be loaded', async () => {
      mockGetSubAccountActivity.mockRejectedValue(new Error('403'));

      const { getByText, findByText } = render(<SettingsLinkedAccountsRoute />);
      fireEvent.press(getByText('See their activity'));

      expect(await findByText('Their activity could not be loaded. The permission may have been changed.')).toBeTruthy();
    });
  });
});
