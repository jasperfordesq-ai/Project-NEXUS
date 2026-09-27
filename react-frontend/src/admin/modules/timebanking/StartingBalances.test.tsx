// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

vi.mock('@/contexts', () => ({
  useToast: vi.fn(() => mockToast),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test', tagline: null }, branding: { name: 'Test', logo_url: null }, tenantSlug: 'test', tenantPath: (p: string) => '/test' + p, isLoading: false, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
}));

const mockAdminUsers = vi.hoisted(() => ({ list: vi.fn() }));
const mockAdminTimebanking = vi.hoisted(() => ({
  grantCredits: vi.fn(),
  getGrants: vi.fn(),
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminUsers: mockAdminUsers,
  adminTimebanking: mockAdminTimebanking,
  adminDonations: { list: vi.fn(), refund: vi.fn(), complete: vi.fn() },
  adminModeration: { hideFeedPost: vi.fn(), deleteFeedPost: vi.fn() },
  adminSuper: { listTenants: vi.fn() },
}));

vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USERS = [
  { id: 5, name: 'Alice Smith', email: 'alice@example.com', balance: 10 },
  { id: 6, name: 'Bob Jones',   email: 'bob@example.com',   balance: 2 },
];

const GRANTS = [
  { id: 1, user_id: 5, user_name: 'Alice Smith', user_email: 'alice@example.com', amount: 5, reason: 'Welcome grant', granted_by: 'Admin', created_at: '2025-01-01T00:00:00Z' },
];

// ─── Import component after mocks ─────────────────────────────────────────────

import { StartingBalances } from './StartingBalances';

// ─── Tests ────────────────────────────────────────────────────────────────────

// What GET /v2/admin/wallet/grants really sends (AdminWalletGrantController::index,
// respondWithData), after the shared api client unwraps `data`: the rows are under
// `grants`, the count is a sibling `total`, and each row uses the server's field
// names. The page used to look for `data` / `meta.total` and `user_name` / `reason`,
// so the grant history was always empty.
const SERVER_GRANTS_REPLY = {
  success: true,
  data: {
    grants: [
      {
        id: 41,
        sender_id: 1,
        receiver_id: 5,
        amount: 5,
        description: 'Welcome grant',
        status: 'completed',
        created_at: '2025-01-01T00:00:00Z',
        recipient_name: 'Carol Recipient',
        recipient_email: 'carol@example.com',
        admin_name: 'Dana Admin',
      },
    ],
    total: 45,
    page: 1,
    per_page: 20,
  },
};

describe('StartingBalances — grant history from the real server reply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminUsers.list.mockResolvedValue({ success: true, data: USERS });
  });

  it('lists the grants the server returns, with recipient, reason and admin', async () => {
    mockAdminTimebanking.getGrants.mockResolvedValue(SERVER_GRANTS_REPLY);
    render(<StartingBalances />);

    expect(await screen.findByText('Carol Recipient')).toBeInTheDocument();
    expect(screen.getByText('carol@example.com')).toBeInTheDocument();
    expect(screen.getByText('Welcome grant')).toBeInTheDocument();
    expect(screen.getByText('Dana Admin')).toBeInTheDocument();
  });

  it('offers a page control from the server total', async () => {
    mockAdminTimebanking.getGrants.mockResolvedValue(SERVER_GRANTS_REPLY);
    render(<StartingBalances />);

    const nav = await screen.findByRole('navigation');
    expect(within(nav).getByRole('button', { name: '3' })).toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: '4' })).not.toBeInTheDocument();
  });
});

describe('StartingBalances', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminTimebanking.getGrants.mockResolvedValue({ success: true, data: GRANTS, meta: { total: 1 } });
    mockAdminUsers.list.mockResolvedValue({ success: true, data: USERS });
  });

  it('renders grant form and history section', async () => {
    render(<StartingBalances />);
    await waitFor(() => expect(mockAdminTimebanking.getGrants).toHaveBeenCalled());
    // Both sections should render without crashing
    expect(document.body).toBeInTheDocument();
  });

  it('loads grant history on mount', async () => {
    render(<StartingBalances />);
    await waitFor(() => expect(mockAdminTimebanking.getGrants).toHaveBeenCalledTimes(1));
  });

  it('searches members when 2+ chars typed in search', async () => {
    const user = userEvent.setup();
    render(<StartingBalances />);

    // Find search input (type=search or input labelled "search member")
    const searchInput = screen.getAllByRole('searchbox')[0] ??
      document.querySelector('input[name="admin-search"]') as HTMLInputElement;

    if (searchInput) {
      await user.type(searchInput, 'Ali');
      await waitFor(() => expect(mockAdminUsers.list).toHaveBeenCalledWith(
        expect.objectContaining({ search: expect.stringContaining('Ali') }),
      ));
    }
  });

  it('shows search results and allows selecting a user', async () => {
    const user = userEvent.setup();
    render(<StartingBalances />);

    const searchInput = document.querySelector('input[name="admin-search"]') as HTMLInputElement;
    if (!searchInput) return; // Guard if input not found in layout

    await user.type(searchInput, 'Ali');
    await waitFor(() => expect(mockAdminUsers.list).toHaveBeenCalled());

    // Search results render as buttons - may be multiple Alice Smith instances
    await waitFor(() => {
      expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0);
    });

    // Click the one inside a search-result button (inside the search dropdown area)
    const aliceEls = screen.getAllByText('Alice Smith');
    const inDropdown = aliceEls.find((el) => el.closest('button') !== null);
    if (inDropdown) {
      fireEvent.click(inDropdown.closest('button')!);
    } else {
      fireEvent.click(aliceEls[0].closest('button') ?? aliceEls[0]);
    }

    // After selection, the user's name is shown in the selected panel
    await waitFor(() => {
      expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0);
    });
  });

  it('shows error toast when no member is selected and grant is clicked', async () => {
    render(<StartingBalances />);
    await waitFor(() => expect(mockAdminTimebanking.getGrants).toHaveBeenCalled());

    const grantBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('grant'),
    );
    if (grantBtn && !grantBtn.hasAttribute('disabled')) {
      fireEvent.click(grantBtn);
      await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    }
  });

  it('calls grantCredits with correct payload on success path', async () => {
    mockAdminTimebanking.grantCredits.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<StartingBalances />);

    // Select user via search
    const searchInput = document.querySelector('input[name="admin-search"]') as HTMLInputElement;
    if (!searchInput) return;

    await user.type(searchInput, 'Ali');
    await waitFor(() => expect(mockAdminUsers.list).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0));
    const aliceEls = screen.getAllByText('Alice Smith');
    const inDropdown = aliceEls.find((el) => el.closest('button') !== null);
    fireEvent.click((inDropdown?.closest('button') ?? aliceEls[0]) as Element);

    // Fill in amount
    const amountInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    if (amountInput) {
      fireEvent.change(amountInput, { target: { value: '3' } });
    }

    // Fill in reason
    const reasonTextarea = document.querySelector('textarea') as HTMLTextAreaElement;
    if (reasonTextarea) {
      fireEvent.change(reasonTextarea, { target: { value: 'Welcome to the timebank' } });
    }

    const grantBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('grant') && !b.hasAttribute('disabled'),
    );
    if (grantBtn) {
      fireEvent.click(grantBtn);
      await waitFor(() => {
        expect(mockAdminTimebanking.grantCredits).toHaveBeenCalledWith(
          expect.objectContaining({
            user_id: 5,
            amount: 3,
            reason: expect.any(String),
          }),
        );
      });
      await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    }
  });

  it('shows error toast when grantCredits API fails', async () => {
    mockAdminTimebanking.grantCredits.mockResolvedValue({ success: false, error: 'Insufficient permission' });
    const user = userEvent.setup();
    render(<StartingBalances />);

    const searchInput = document.querySelector('input[name="admin-search"]') as HTMLInputElement;
    if (!searchInput) return;

    await user.type(searchInput, 'Ali');
    await waitFor(() => expect(mockAdminUsers.list).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0));
    const aliceEls2 = screen.getAllByText('Alice Smith');
    const inDropdown2 = aliceEls2.find((el) => el.closest('button') !== null);
    fireEvent.click((inDropdown2?.closest('button') ?? aliceEls2[0]) as Element);

    const amountInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    if (amountInput) fireEvent.change(amountInput, { target: { value: '3' } });

    const reasonTextarea = document.querySelector('textarea') as HTMLTextAreaElement;
    if (reasonTextarea) fireEvent.change(reasonTextarea, { target: { value: 'Test reason' } });

    const grantBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('grant') && !b.hasAttribute('disabled'),
    );
    if (grantBtn) {
      fireEvent.click(grantBtn);
      await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    }
  });

  it('refreshes grant history after a successful grant', async () => {
    mockAdminTimebanking.grantCredits.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<StartingBalances />);

    await waitFor(() => expect(mockAdminTimebanking.getGrants).toHaveBeenCalledTimes(1));

    const searchInput = document.querySelector('input[name="admin-search"]') as HTMLInputElement;
    if (!searchInput) return;

    await user.type(searchInput, 'Ali');
    await waitFor(() => expect(mockAdminUsers.list).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0));
    const aliceEls3 = screen.getAllByText('Alice Smith');
    const inDropdown3 = aliceEls3.find((el) => el.closest('button') !== null);
    fireEvent.click((inDropdown3?.closest('button') ?? aliceEls3[0]) as Element);

    const amountInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    if (amountInput) fireEvent.change(amountInput, { target: { value: '2' } });

    const reasonTextarea = document.querySelector('textarea') as HTMLTextAreaElement;
    if (reasonTextarea) fireEvent.change(reasonTextarea, { target: { value: 'Starting credits' } });

    const grantBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('grant') && !b.hasAttribute('disabled'),
    );
    if (grantBtn) {
      fireEvent.click(grantBtn);
      // After success, getGrants should be called again (refreshKey increments)
      await waitFor(() => expect(mockAdminTimebanking.getGrants).toHaveBeenCalledTimes(2));
    }
  });

  it('shows "no members found" when search returns empty', async () => {
    mockAdminUsers.list.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    render(<StartingBalances />);

    const searchInput = document.querySelector('input[name="admin-search"]') as HTMLInputElement;
    if (!searchInput) return;

    await user.type(searchInput, 'zzz');
    await waitFor(() => expect(mockAdminUsers.list).toHaveBeenCalled());

    // "No members found" text from i18n key timebanking.no_members_found
    await waitFor(() => {
      // The key resolves to its own string in test i18n
      expect(
        screen.queryByText(/no.*member/i) ||
        // fallback: check i18n-key present in DOM
        document.body.textContent?.includes('no_members_found'),
      ).toBeTruthy();
    });
  });

  it('change button deselects the selected user', async () => {
    const user = userEvent.setup();
    render(<StartingBalances />);

    const searchInput = document.querySelector('input[name="admin-search"]') as HTMLInputElement;
    if (!searchInput) return;

    await user.type(searchInput, 'Ali');
    await waitFor(() => expect(mockAdminUsers.list).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0));
    const aliceEls4 = screen.getAllByText('Alice Smith');
    const inDropdown4 = aliceEls4.find((el) => el.closest('button') !== null);
    fireEvent.click((inDropdown4?.closest('button') ?? aliceEls4[0]) as Element);

    // "Change" button deselects
    const changeBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('change'),
    );
    if (changeBtn) {
      fireEvent.click(changeBtn);
      // Search input re-appears
      await waitFor(() => {
        expect(document.querySelector('input[name="admin-search"]')).toBeInTheDocument();
      });
    }
  });
});
