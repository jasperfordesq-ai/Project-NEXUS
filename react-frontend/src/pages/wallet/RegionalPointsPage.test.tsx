// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Render tests for RegionalPointsPage
 *
 * Covers:
 *   - Loading spinner while both API calls are in-flight
 *   - Unavailable state (feature disabled, sumRes.error set)
 *   - Populated state: balance cards, history table, transfer form
 *   - Empty history (0 transactions → empty-state message)
 *   - Load error (Promise rejection → toast.error)
 *   - Transfer form: recipient is picked by name (F-225), no-recipient guard,
 *     invalid-amount guard, name-confirmation step before sending, success
 *     flow, and API-level error (res.success=false)
 *   - Refresh button re-invokes the load pair
 *   - Transfer form hidden when member_transfers_enabled=false
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, userEvent } from '@/test/test-utils';
import { api } from '@/lib/api';
import type { ReactNode } from 'react';

// ── API mock ──────────────────────────────────────────────────────────────────
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// ── Logger mock (imported by the page) ────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

// ── Toast capture ─────────────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};

// ── Contexts mock ─────────────────────────────────────────────────────────────
// useToast is the only hook the page uses from @/contexts; the rest are
// consumed by provider children and need safe no-op stubs.
vi.mock('@/contexts', () => ({
  useToast: vi.fn(() => mockToast),
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    status: 'idle',
    error: null,
  }),
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useTheme: () => ({
    resolvedTheme: 'light',
    theme: 'system',
    toggleTheme: vi.fn(),
    setTheme: vi.fn(),
  }),
  useNotifications: () => ({
    unreadCount: 0,
    counts: {},
    notifications: [],
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    hasMore: false,
    loadMore: vi.fn(),
    isLoading: false,
    refresh: vi.fn(),
  }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({
    consent: null,
    showBanner: false,
    openPreferences: vi.fn(),
    resetConsent: vi.fn(),
    saveConsent: vi.fn(),
    hasConsent: vi.fn(() => true),
    updateConsent: vi.fn(),
  }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  usePresence: () => ({ status: 'offline', setStatus: vi.fn(), getPresence: vi.fn(), isOnline: vi.fn(() => false) }),
  usePresenceOptional: () => null,
}));

// ── ComboBox / Modal stubs ────────────────────────────────────────────────────
// The recipient picker is a HeroUI ComboBox (React Aria listbox in a popover),
// which jsdom drives unreliably. The stub keeps the contract the page relies
// on: onInputChange for typing, onSelectionChange(id) for picking a member.
vi.mock('@/components/ui/ComboBox', () => ({
  ComboBox: (props: {
    'aria-label'?: string;
    placeholder?: string;
    items?: Array<{ id: number; name: string }>;
    onInputChange?: (v: string) => void;
    onSelectionChange?: (key: number | string | null) => void;
    renderEmptyState?: () => unknown;
  }) => (
    <div>
      <input
        aria-label={props['aria-label']}
        placeholder={props.placeholder}
        onChange={(e) => props.onInputChange?.(e.target.value)}
      />
      {(props.items ?? []).length === 0
        ? (props.renderEmptyState?.() as ReactNode)
        : (props.items ?? []).map((m) => (
            <button key={m.id} type="button" role="option" aria-selected={false} onClick={() => props.onSelectionChange?.(m.id)}>
              {m.name}
            </button>
          ))}
    </div>
  ),
}));

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) =>
    isOpen ? <div role="dialog">{children}</div> : null,
  ModalContent: ({ children }: { children: ReactNode | ((onClose: () => void) => ReactNode) }) => (
    <div>{typeof children === 'function' ? children(() => {}) : children}</div>
  ),
  ModalHeader: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  ModalBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ModalFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// ── Page import (after mocks) ─────────────────────────────────────────────────
import RegionalPointsPage from './RegionalPointsPage';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SUMMARY_ENABLED = {
  enabled: true,
  config: {
    enabled: true,
    label: 'Community Coins',
    symbol: 'CC',
    member_transfers_enabled: true,
    marketplace_redemption_enabled: false,
    points_per_approved_hour: 10,
  },
  account: {
    user_id: 42,
    balance: 125.5,
    lifetime_earned: 300.0,
    lifetime_spent: 174.5,
  },
};

const HISTORY_ITEMS = [
  {
    id: 1,
    user_id: 42,
    actor_user_id: null,
    type: 'earn',
    direction: 'in' as const,
    points: 50.0,
    balance_after: 50.0,
    description: 'Volunteering hours',
    created_at: '2026-01-15T10:00:00Z',
  },
  {
    id: 2,
    user_id: 42,
    actor_user_id: 7,
    type: 'transfer_out',
    direction: 'out' as const,
    points: 20.0,
    balance_after: 30.0,
    description: null,
    created_at: '2026-02-01T12:00:00Z',
  },
];

/** Wire api.get to return the given summary + history payloads. */
function mockLoadSuccess(
  summaryData: typeof SUMMARY_ENABLED = SUMMARY_ENABLED,
  historyItems: typeof HISTORY_ITEMS = HISTORY_ITEMS,
) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes('/summary')) {
      return Promise.resolve({ success: true, data: summaryData });
    }
    if (url.includes('/history')) {
      return Promise.resolve({ success: true, data: { items: historyItems } });
    }
    if (url.startsWith('/v2/users?')) {
      // Member directory search — includes the viewer (42), who must be filtered out.
      return Promise.resolve({ success: true, data: MEMBER_SEARCH_RESULTS });
    }
    return Promise.resolve({ success: false, error: 'unknown' });
  });
}

const MEMBER_SEARCH_RESULTS = [
  { id: 42, name: 'Myself', avatar_url: null },
  { id: 77, name: 'Aoife', avatar_url: null },
];

/** Search the directory by name and pick "Aoife" (member 77). */
async function pickRecipient() {
  fireEvent.change(screen.getByPlaceholderText('Search by name...'), { target: { value: 'Ao' } });
  const option = await screen.findByRole('option', { name: 'Aoife' });
  fireEvent.click(option);
  await waitFor(() => {
    expect(screen.getByTestId('regional-points-recipient')).toHaveTextContent('Aoife');
  });
}

async function enterAmount(user: ReturnType<typeof userEvent.setup>, value: string) {
  const amountInput = screen.getByPlaceholderText('0.00');
  await user.clear(amountInput);
  await user.type(amountInput, value);
  fireEvent.blur(amountInput);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RegionalPointsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Loading state ──────────────────────────────────────────────────────────

  it('shows a loading spinner on initial mount before data resolves', () => {
    // Never resolve so we stay in the loading state throughout the test
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));

    render(<RegionalPointsPage />);

    // HeroUI Spinner also renders role="status" internally; find the outer
    // wrapper which carries aria-busy="true" (the page-level div).
    const statusEls = screen.getAllByRole('status');
    const outerBusy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(outerBusy).toBeInTheDocument();
  });

  // ── Feature-unavailable / disabled state ───────────────────────────────────

  it('shows the unavailable empty-state when the summary returns an error', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/summary')) {
        return Promise.resolve({ success: false, error: 'FEATURE_DISABLED' });
      }
      // history can still succeed (it won't be displayed anyway)
      return Promise.resolve({ success: true, data: { items: [] } });
    });

    render(<RegionalPointsPage />);

    await waitFor(() => {
      expect(screen.getByText('Regional points are not enabled here')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/This community has not turned on the regional points programme yet/),
    ).toBeInTheDocument();
    // Balance cards must NOT appear
    expect(screen.queryByText('Balance')).not.toBeInTheDocument();
  });

  // ── Populated state ────────────────────────────────────────────────────────

  it('renders balance cards with the correct account values', async () => {
    mockLoadSuccess();

    render(<RegionalPointsPage />);

    await waitFor(() => {
      // Balance card — 125.50 CC
      expect(screen.getByText('125.50')).toBeInTheDocument();
      // Lifetime earned — 300.00 CC
      expect(screen.getByText('300.00')).toBeInTheDocument();
      // Lifetime spent — 174.50 CC
      expect(screen.getByText('174.50')).toBeInTheDocument();
    });

    // The configured label appears in the page heading
    expect(screen.getByText('Community Coins')).toBeInTheDocument();

    // "Balance" appears in both the balance card AND as the "balance_after" column
    // header in the history table — use getAllByText and assert at least 2.
    expect(screen.getAllByText('Balance').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Lifetime earned')).toBeInTheDocument();
    expect(screen.getByText('Lifetime spent')).toBeInTheDocument();
  });

  it('renders the history table with transaction rows', async () => {
    mockLoadSuccess();

    render(<RegionalPointsPage />);

    await waitFor(() => {
      expect(screen.getByText('Recent activity')).toBeInTheDocument();
    });

    // Table columns
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();

    // Transaction rows — unknown type codes ('earn') fall back to a humanized
    // label; known codes ('transfer_out') render their translated label.
    expect(screen.getByText('Earn')).toBeInTheDocument();
    expect(screen.getByText('Transfer sent')).toBeInTheDocument();
    expect(screen.getByText('Volunteering hours')).toBeInTheDocument();

    // Null description → falls back to t('empty_dash') which is "–" or "-"
    // We just verify the description column renders without crashing
    expect(screen.getByText('Transfer sent')).toBeInTheDocument();

    // Inbound amount rendered with +, outbound with -
    expect(screen.getByText(/\+50\.00/)).toBeInTheDocument();
    expect(screen.getByText(/-20\.00/)).toBeInTheDocument();
  });

  it('shows the transaction count chip with the correct number', async () => {
    mockLoadSuccess();

    render(<RegionalPointsPage />);

    await waitFor(() => {
      // Chip next to "Recent activity" header shows count of 2
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  it('renders the transfer form when member_transfers_enabled is true', async () => {
    mockLoadSuccess();

    render(<RegionalPointsPage />);

    await waitFor(() => {
      expect(screen.getByText('Send points to another member')).toBeInTheDocument();
    });

    // F-225: the recipient is chosen by name, never typed as a raw member id.
    expect(screen.getByText('Who are you sending points to?')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by name...')).toBeInTheDocument();
    expect(screen.queryByText('Recipient member ID')).not.toBeInTheDocument();
    expect(screen.getByText('Send transfer')).toBeInTheDocument();
  });

  it('searches the member directory and never offers the viewer as a recipient', async () => {
    mockLoadSuccess();

    render(<RegionalPointsPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search by name...')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Search by name...'), { target: { value: 'Ao' } });

    expect(await screen.findByRole('option', { name: 'Aoife' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Myself' })).not.toBeInTheDocument();
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/v2/users?q=Ao&limit=8');
  });

  it('hides the transfer form when member_transfers_enabled is false', async () => {
    const noTransfers = {
      ...SUMMARY_ENABLED,
      config: { ...SUMMARY_ENABLED.config, member_transfers_enabled: false },
    };
    mockLoadSuccess(noTransfers, []);

    render(<RegionalPointsPage />);

    await waitFor(() => {
      // Page must have loaded (balance card present)
      expect(screen.getByText('Balance')).toBeInTheDocument();
    });

    expect(screen.queryByText('Send points to another member')).not.toBeInTheDocument();
  });

  // ── Empty history state ────────────────────────────────────────────────────

  it('shows the empty-history message when there are no transactions', async () => {
    mockLoadSuccess(SUMMARY_ENABLED, []);

    render(<RegionalPointsPage />);

    await waitFor(() => {
      expect(screen.getByText('No transactions yet.')).toBeInTheDocument();
    });

    // Chip should show 0
    // The chip renders inside the "Recent activity" header area
    // There may be multiple elements with text "0"; we just need at least one
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThan(0);
  });

  // ── Load error (thrown promise) ────────────────────────────────────────────

  it('calls toast.error when the API throws during load', async () => {
    vi.mocked(api.get).mockImplementation(() => Promise.reject(new Error('Network error')));

    render(<RegionalPointsPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Failed to load regional points');
    });
  });

  // ── Refresh button ─────────────────────────────────────────────────────────

  it('re-invokes both API calls when the refresh button is pressed', async () => {
    mockLoadSuccess();

    render(<RegionalPointsPage />);

    // Wait for any unambiguous element — "Lifetime earned" is unique on the page
    await waitFor(() => {
      expect(screen.getByText('Lifetime earned')).toBeInTheDocument();
    });

    // Both GET calls happen on initial load
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2);

    // Click the refresh button
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      // Total calls should now be 4 (2 initial + 2 refresh)
      expect(vi.mocked(api.get)).toHaveBeenCalledTimes(4);
    });
  });

  // ── Transfer form guards ───────────────────────────────────────────────────

  it('shows an error toast when no recipient has been chosen', async () => {
    mockLoadSuccess();

    render(<RegionalPointsPage />);

    await waitFor(() => {
      expect(screen.getByText('Send transfer')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /send transfer/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Choose a member to send points to');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it('shows an error toast for a missing/zero amount', async () => {
    mockLoadSuccess();

    render(<RegionalPointsPage />);

    await waitFor(() => {
      expect(screen.getByText('Send transfer')).toBeInTheDocument();
    });

    // Pick a recipient but leave the amount empty
    await pickRecipient();

    fireEvent.click(screen.getByRole('button', { name: /send transfer/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Enter a positive amount');
    });
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it('shows the recipient name for confirmation and only posts after the sender confirms', async () => {
    mockLoadSuccess();
    vi.mocked(api.post).mockResolvedValue({ success: true });

    const user = userEvent.setup();
    render(<RegionalPointsPage />);

    await waitFor(() => {
      expect(screen.getByText('Send transfer')).toBeInTheDocument();
    });

    await pickRecipient();
    await enterAmount(user, '25');

    // Use fireEvent.click rather than userEvent.click to avoid focus-trap
    // interference from React Aria when clicking buttons after NumberField.
    fireEvent.click(screen.getByRole('button', { name: /send transfer/i }));

    // F-225: the confirmation names the person before anything is sent.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Send 25 CC to Aoife?');
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /yes, send points/i }));

    await waitFor(() => {
      expect(vi.mocked(api.post)).toHaveBeenCalledWith(
        '/v2/caring-community/regional-points/transfer',
        expect.objectContaining({
          recipient_user_id: 77,
          points: 25,
        }),
      );
    });

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Transfer sent');
    });
  });

  it('shows an error toast when the transfer API returns success:false', async () => {
    mockLoadSuccess();
    vi.mocked(api.post).mockResolvedValue({ success: false, error: 'Insufficient balance' });

    const user = userEvent.setup();
    render(<RegionalPointsPage />);

    await waitFor(() => {
      expect(screen.getByText('Send transfer')).toBeInTheDocument();
    });

    await pickRecipient();
    await enterAmount(user, '999');

    fireEvent.click(screen.getByRole('button', { name: /send transfer/i }));
    fireEvent.click(await screen.findByRole('button', { name: /yes, send points/i }));

    await waitFor(() => {
      expect(vi.mocked(api.post)).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Insufficient balance');
    });
  });

  it('calls toast.error when the transfer API call throws', async () => {
    mockLoadSuccess();
    vi.mocked(api.post).mockRejectedValue(new Error('Network failure'));

    const user = userEvent.setup();
    render(<RegionalPointsPage />);

    await waitFor(() => {
      expect(screen.getByText('Send transfer')).toBeInTheDocument();
    });

    await pickRecipient();
    await enterAmount(user, '10');

    fireEvent.click(screen.getByRole('button', { name: /send transfer/i }));
    fireEvent.click(await screen.findByRole('button', { name: /yes, send points/i }));

    await waitFor(() => {
      expect(vi.mocked(api.post)).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Transfer failed');
    });
  });

  // ── Symbol / label fallback ────────────────────────────────────────────────

  it('falls back to the default "pts" symbol when config.symbol is empty', async () => {
    const noSymbol = {
      ...SUMMARY_ENABLED,
      config: { ...SUMMARY_ENABLED.config, symbol: '' },
    };
    mockLoadSuccess(noSymbol, []);

    render(<RegionalPointsPage />);

    await waitFor(() => {
      // "pts" should appear at least once (balance card)
      expect(screen.getAllByText('pts').length).toBeGreaterThan(0);
    });
  });

  // ── Correct API endpoints called on load ───────────────────────────────────

  it('calls the summary and history endpoints on mount', async () => {
    mockLoadSuccess();

    render(<RegionalPointsPage />);

    await waitFor(() => {
      expect(vi.mocked(api.get)).toHaveBeenCalledWith(
        '/v2/caring-community/regional-points/summary',
      );
      expect(vi.mocked(api.get)).toHaveBeenCalledWith(
        '/v2/caring-community/regional-points/history?limit=50',
      );
    });
  });
});
