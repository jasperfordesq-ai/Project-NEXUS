// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for SubAccountsManager component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};

vi.mock('@/contexts', () => ({
  useToast: vi.fn(() => mockToast),
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    user: { id: 1, name: 'Test User', role: 'user' },
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    status: 'idle',
    error: null,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    branding: { name: 'Test', logo_url: null },
    tenantSlug: 'test',
    tenantPath: (p: string) => '/test' + p,
    isLoading: false,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url: string | undefined) => url || '/default-avatar.png'),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

import { SubAccountsManager } from '../SubAccountsManager';

const mockManagedAccounts = [
  {
    relationship_id: 1,
    relationship_type: 'family',
    user_id: 10,
    first_name: 'Child',
    last_name: 'One',
    email: 'child1@example.com',
    avatar_url: null,
    status: 'active' as const,
    permissions: {
      can_view_activity: true,
      can_manage_listings: false,
      can_transact: false,
      can_view_messages: false,
    },
    approved_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    relationship_id: 2,
    relationship_type: 'family',
    user_id: 11,
    first_name: 'Child',
    last_name: 'Two',
    email: 'child2@example.com',
    avatar_url: null,
    status: 'pending' as const,
    permissions: {
      can_view_activity: true,
      can_manage_listings: false,
      can_transact: false,
      can_view_messages: false,
    },
    approved_at: null,
    created_at: '2026-01-02T00:00:00Z',
  },
];

const mockManagerAccounts = [
  {
    relationship_id: 3,
    relationship_type: 'guardian',
    user_id: 12,
    first_name: 'Parent',
    last_name: 'One',
    email: 'parent@example.com',
    avatar_url: null,
    status: 'pending' as const,
    permissions: {
      can_view_activity: true,
      can_manage_listings: false,
      can_transact: false,
      can_view_messages: false,
    },
    approved_at: null,
    created_at: '2026-01-03T00:00:00Z',
  },
];

function mockLoad(
  children: Array<Record<string, unknown>> = mockManagedAccounts,
  parents: Array<Record<string, unknown>> = mockManagerAccounts,
) {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ success: true, data: children })
    .mockResolvedValueOnce({ success: true, data: parents });
}

describe('SubAccountsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading spinner initially', () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));

    render(<SubAccountsManager />);
    // The Spinner stub exposes its "Loading" label both as aria-label and text,
    // so match all and assert at least one loading indicator is present.
    expect(screen.getAllByLabelText('Loading').length).toBeGreaterThan(0);
  });

  it('renders header with title and add button', async () => {
    mockLoad([], []);

    render(<SubAccountsManager />);

    await waitFor(() => {
      expect(screen.getByText('Linked Accounts')).toBeInTheDocument();
      expect(screen.getAllByText('Add Account').length).toBeGreaterThan(0);
    });
  });

  it('renders empty state when there are no linked accounts', async () => {
    mockLoad([], []);

    render(<SubAccountsManager />);

    await waitFor(() => {
      expect(screen.getByText('No linked accounts')).toBeInTheDocument();
    });
  });

  it('renders managed accounts and manager requests after loading', async () => {
    mockLoad();

    render(<SubAccountsManager />);

    await waitFor(() => {
      expect(screen.getByText('Child One')).toBeInTheDocument();
      expect(screen.getByText('Child Two')).toBeInTheDocument();
      expect(screen.getByText('Parent One')).toBeInTheDocument();
    });
  });

  it('shows status chips for each account', async () => {
    mockLoad();

    render(<SubAccountsManager />);

    await waitFor(() => {
      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getAllByText('Pending')).toHaveLength(2);
    });
  });

  it('shows email for each account', async () => {
    mockLoad();

    render(<SubAccountsManager />);

    await waitFor(() => {
      expect(screen.getByText('child1@example.com')).toBeInTheDocument();
      expect(screen.getByText('child2@example.com')).toBeInTheDocument();
      expect(screen.getByText('parent@example.com')).toBeInTheDocument();
    });
  });

  it('shows the activity switch and a tier picker per capability for active managed accounts', async () => {
    mockLoad();

    render(<SubAccountsManager />);

    await waitFor(() => {
      expect(screen.getByText('Permissions')).toBeInTheDocument();
      // Activity stays a see/don't-see switch…
      expect(screen.getByText('View activity')).toBeInTheDocument();
      // …listings and credits are three-level tier pickers (guardian redesign).
      expect(screen.getByLabelText('Support level for Their listings of Child One')).toBeInTheDocument();
      expect(screen.getByLabelText('Support level for Their time credits of Child One')).toBeInTheDocument();
      // The middle tier is explained in plain words next to the controls.
      expect(screen.getByText(/nothing happens until the account owner approves/i)).toBeInTheDocument();
    });
  });

  /**
   * 🔴 This asserted the opposite until 2026-08-05: it required a "View
   * messages" switch to exist and to POST `can_view_messages: true`. That
   * permission was never enforced anywhere — SubAccountService::hasPermission is
   * not consulted for it — so the test was pinning a UI promise the backend
   * never kept, in a safeguarding feature. Do not "restore" it: letting a carer
   * read a dependent's messages exposes the other party to that conversation,
   * who never agreed. It needs the counterparty notice first.
   */
  /**
   * Reversed pin (2026-08-07, owner decision): message access EXISTS now —
   * but never as a switch. The control is a consent REQUEST: no toggle, no
   * direct grant, three server-derived states. What must never return is the
   * old fire-and-forget "View messages" permission toggle.
   */
  it('offers messages as a consent request, never as a switch', async () => {
    mockLoad();

    render(<SubAccountsManager />);

    await waitFor(() => {
      expect(screen.getByText('Permissions')).toBeInTheDocument();
    });

    // The old toggle stays gone…
    expect(
      screen.queryByLabelText('Toggle View messages permission for Child One'),
    ).not.toBeInTheDocument();
    // …and the ask-first control is what exists instead (fixture rows carry
    // no message_access, i.e. state 'none' → the request button).
    expect(screen.getByRole('button', { name: 'Ask to view their messages' })).toBeInTheDocument();
  });

  it('requesting message access sends the tier ask and shows pending on reload', async () => {
    mockLoad();
    vi.mocked(api.put).mockResolvedValueOnce({ success: true, data: [] });
    // The post-request reload returns the server-derived pending state.
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: [{ ...mockManagedAccounts[0]!, message_access: 'pending' }] })
      .mockResolvedValueOnce({ success: true, data: [] });

    render(<SubAccountsManager />);

    fireEvent.click(await screen.findByRole('button', { name: 'Ask to view their messages' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/v2/users/me/sub-accounts/1/permissions', {
        permissions: { tiers: { messages: 'assist' } },
      });
    });
    expect(await screen.findByText(/Waiting for Child One to approve/)).toBeInTheDocument();
  });

  it('the member side shows the disclosure and a working withdraw', async () => {
    mockLoad([], [{
      ...mockManagerAccounts[0]!,
      status: 'active' as const,
      message_access: 'active',
      message_view_last_at: null,
    }]);
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: { message_access: 'none' } });
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: [{ ...mockManagerAccounts[0]!, status: 'active' as const }] });

    render(<SubAccountsManager />);

    expect(await screen.findByText(/Parent One can view your messages/)).toBeInTheDocument();
    expect(screen.getByText('Never viewed so far')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stop them viewing my messages' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/users/me/parent-accounts/3/message-access/withdraw');
    });
  });

  it('sends an explicit activity tier when the switch changes — and the switch visibly moves', async () => {
    mockLoad();
    vi.mocked(api.put).mockResolvedValueOnce({ success: true, data: [] });

    render(<SubAccountsManager />);

    // Child One has activity on in the fixture; toggling sends tier none.
    // The tier vocabulary (not the boolean shorthand) is what this control
    // speaks now: it RENDERS from account.tiers, and the old boolean handler
    // only mutated account.permissions — so the switch never visibly moved
    // until a reload (audit finding A2).
    const switchControl = await screen.findByLabelText('Toggle View activity permission for Child One');
    expect(switchControl).toBeChecked();
    fireEvent.click(switchControl);

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/v2/users/me/sub-accounts/1/permissions', {
        permissions: { tiers: { activity: 'none' } },
      });
    });
    // The optimistic update reaches what the render reads.
    expect(switchControl).not.toBeChecked();
  });

  it('sends an explicit tiers object when a tier is picked', async () => {
    mockLoad();
    vi.mocked(api.put).mockResolvedValueOnce({ success: true, data: [] });
    const user = userEvent.setup();

    render(<SubAccountsManager />);

    // Open the listings tier picker and choose the co-decide level. React
    // Aria opens on a real pointer sequence, so this needs userEvent, not
    // fireEvent.click.
    const trigger = await screen.findByLabelText('Support level for Their listings of Child One');
    await user.click(trigger);
    const option = await screen.findByRole('option', { name: /Prepare only/ });
    await user.click(option);

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/v2/users/me/sub-accounts/1/permissions', {
        permissions: { tiers: { listings: 'co_decide' } },
      });
    });
  });

  it('shows approve and decline buttons for manager requests awaiting this user', async () => {
    mockLoad();

    render(<SubAccountsManager />);

    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeInTheDocument();
      expect(screen.getByText('Decline')).toBeInTheDocument();
    });
  });

  it('posts email only when adding a linked account request', async () => {
    mockLoad([], []);
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: [] });
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: [] });

    render(<SubAccountsManager />);

    await screen.findByText('No linked accounts');
    fireEvent.click(screen.getAllByText('Add Account')[0]);
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'child@example.com' } });
    fireEvent.click(screen.getByText('Send Request'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/users/me/sub-accounts', {
        email: 'child@example.com',
      });
    });
  });

  it('shows error state on API failure', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'));

    render(<SubAccountsManager />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load linked accounts')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });

  describe('View activity gating', () => {
    // "Never show what does not work": the button must track the activity
    // tier, not merely the relationship being active.
    it('offers View activity when the activity grant is on', async () => {
      mockLoad();

      render(<SubAccountsManager />);

      await screen.findByText('Child One');
      expect(screen.getByRole('button', { name: 'See their activity' })).toBeInTheDocument();
    });

    it('offers no View activity button when the activity grant is off', async () => {
      mockLoad(
        [
          {
            ...mockManagedAccounts[0]!,
            permissions: {
              can_view_activity: false,
              can_manage_listings: false,
              can_transact: false,
              can_view_messages: false,
            },
          },
        ],
        [],
      );

      render(<SubAccountsManager />);

      await screen.findByText('Child One');
      expect(screen.queryByRole('button', { name: 'See their activity' })).not.toBeInTheDocument();
    });

    it('opens the activity modal and loads the child activity endpoint', async () => {
      mockLoad();
      // The modal's fetch is the third api.get call (after children + parents).
      vi.mocked(api.get).mockResolvedValueOnce({
        success: true,
        data: { timeline: [], hours_summary: { hours_given: 1, hours_received: 0, transactions_given: 1, transactions_received: 0, net_balance: -1 } },
      });

      render(<SubAccountsManager />);

      await screen.findByText('Child One');
      fireEvent.click(screen.getByRole('button', { name: 'See their activity' }));

      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith('/v2/users/me/sub-accounts/10/activity');
      });
      expect(await screen.findByText('Activity for Child One')).toBeInTheDocument();
    });
  });
});
