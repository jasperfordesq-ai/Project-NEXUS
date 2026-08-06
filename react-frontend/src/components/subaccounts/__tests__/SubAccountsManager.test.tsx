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

function mockLoad(children = mockManagedAccounts, parents = mockManagerAccounts) {
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
  it('does not offer a messages permission, and says so', async () => {
    mockLoad();

    render(<SubAccountsManager />);

    await waitFor(() => {
      expect(screen.getByText('Permissions')).toBeInTheDocument();
    });

    expect(screen.queryByText('View messages')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Toggle View messages permission for Child One'),
    ).not.toBeInTheDocument();
    // Stated, not silently dropped — a family that had switched it on needs to
    // know it never did anything.
    expect(screen.getByText(/Carers cannot read messages/i)).toBeInTheDocument();
  });

  it('sends the boolean shorthand when the activity switch changes', async () => {
    mockLoad();
    vi.mocked(api.put).mockResolvedValueOnce({ success: true, data: [] });

    render(<SubAccountsManager />);

    // Child One has can_view_activity: true in the fixture; toggling sends false.
    const switchControl = await screen.findByLabelText('Toggle View activity permission for Child One');
    fireEvent.click(switchControl);

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/v2/users/me/sub-accounts/1/permissions', {
        permissions: { can_view_activity: false },
      });
    });
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
});
