// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for DonateModal — money-critical time-credit donation dialog.
 *
 * Covers:
 *   - Dialog renders when isOpen=true
 *   - Recipient type radio (community fund / member)
 *   - Validation: empty amount, zero, negative, NaN, over-balance → toast.error
 *   - Validation: member mode + no recipient selected → toast.error
 *   - Happy-path community-fund donate → correct POST endpoint + payload + success toast + callbacks
 *   - Happy-path member donate → correct POST with recipient_id
 *   - API success=false → error toast
 *   - API throws → error toast
 *   - Donate button disabled + loading during submit; cancel button disabled during submit
 *   - User search: debounced GET call, results rendered, recipient selection
 *   - Form resets when modal opens (isOpen transitions false→true)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, within } from '@/test/test-utils';
import { api } from '@/lib/api';

/* ------------------------------------------------------------------ mocks */

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAvatarUrl: (url: string | null) => url ?? null,
  };
});

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};

vi.mock('@/contexts', () => ({
  useToast: vi.fn(() => mockToast),
  useTheme: () => ({
    resolvedTheme: 'light' as const,
    theme: 'system' as const,
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
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    status: 'idle' as const,
    error: null,
  }),
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test', tagline: null },
    branding: { name: 'Test', logo_url: null },
    tenantSlug: 'test',
    tenantPath: (p: string) => '/test' + p,
    isLoading: false,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
  usePresence: () => ({
    status: 'offline' as const,
    setStatus: vi.fn(),
    getPresence: vi.fn(),
    isOnline: vi.fn(() => false),
  }),
  usePresenceOptional: () => null,
}));

/* ----------------------------------------------------------------- import */

// Import after mocks are registered
import { DonateModal } from './DonateModal';

/* ---------------------------------------------------------------- helpers */

/** Default currentBalance used across most tests */
const DEFAULT_BALANCE = 10;

/** Render DonateModal with isOpen=true and sensible defaults */
function renderOpen(props: {
  currentBalance?: number;
  onClose?: () => void;
  onDonationComplete?: () => void;
}) {
  const onClose = props.onClose ?? vi.fn();
  const onDonationComplete = props.onDonationComplete;
  render(
    <DonateModal
      isOpen={true}
      onClose={onClose}
      currentBalance={props.currentBalance ?? DEFAULT_BALANCE}
      onDonationComplete={onDonationComplete}
    />
  );
  return { onClose, onDonationComplete };
}

/**
 * Click the donate confirm button.
 * The button text comes from t('donate_confirm') = "Donate" in the locale file.
 */
function clickDonate() {
  const btn = screen.getByRole('button', { name: /donate/i });
  // The donate button text is "Donate" but there may be multiple buttons with
  // that text from i18n fallback; use the one that has the aria "donate" label
  // or fall back to matching "Donate" that is NOT the "donate_credits" heading.
  fireEvent.click(btn);
}

/** Enter a value into the amount field */
function setAmountField(value: string) {
  // The amount input has label "Amount (hours)" (t('donate_amount'))
  const input = screen.getByLabelText(/amount/i);
  fireEvent.change(input, { target: { value } });
}

/* =================================================================
   SUITE 1 — Rendering
   ================================================================= */

describe('DonateModal — rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the modal dialog when isOpen=true', () => {
    renderOpen({});
    // Modal header contains "Donate credits" (t('donate_credits'))
    expect(screen.getByText(/donate credits/i)).toBeInTheDocument();
  });

  it('renders recipient-type radio group with two options', () => {
    renderOpen({});
    // Use getAllByText because "Community fund" and "Another member" each appear
    // in both the radio label AND the description text beneath it.
    expect(screen.getAllByText(/community fund/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/another member/i).length).toBeGreaterThanOrEqual(1);
    // The radio group itself should have two radio inputs
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('defaults recipient type to community fund (no search field visible)', () => {
    renderOpen({});
    // When community_fund is selected, the member-search label is NOT shown
    expect(screen.queryByLabelText(/search by member/i)).not.toBeInTheDocument();
  });

  it('shows current balance in the amount field description', () => {
    renderOpen({ currentBalance: 7 });
    // t('donate_balance_info', { balance: 7 }) → "Your balance: 7 hours"
    expect(screen.getByText(/7/)).toBeInTheDocument();
  });

  it('renders Cancel and Donate buttons', () => {
    renderOpen({});
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    // Donate confirm button (the submit one) — may be "Donate" which also appears
    // in the header icon label, so check by existence of at least one button with "donate"
    const donateButtons = screen.getAllByRole('button', { name: /donate/i });
    expect(donateButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('calls onClose when Cancel is pressed', () => {
    const onClose = vi.fn();
    renderOpen({ onClose });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

/* =================================================================
   SUITE 2 — Amount validation
   ================================================================= */

describe('DonateModal — amount validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows invalid-amount error toast when amount is empty and Donate is pressed', async () => {
    renderOpen({});
    // Leave amount empty
    clickDonate();
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringMatching(/amount won't work/i),
        expect.anything()
      );
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows invalid-amount error toast when amount is 0', async () => {
    renderOpen({});
    setAmountField('0');
    clickDonate();
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringMatching(/amount won't work/i),
        expect.anything()
      );
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows invalid-amount error toast when amount is negative', async () => {
    renderOpen({});
    setAmountField('-5');
    clickDonate();
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringMatching(/amount won't work/i),
        expect.anything()
      );
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows invalid-amount error toast when amount is non-numeric text', async () => {
    renderOpen({});
    setAmountField('abc');
    clickDonate();
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringMatching(/amount won't work/i),
        expect.anything()
      );
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows insufficient-balance error toast when amount exceeds currentBalance', async () => {
    renderOpen({ currentBalance: 5 });
    setAmountField('10'); // 10 > 5
    clickDonate();
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringMatching(/insufficient balance/i),
        expect.anything()
      );
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('does NOT show insufficient-balance error when amount exactly equals balance', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });
    renderOpen({ currentBalance: 5 });
    setAmountField('5');
    clickDonate();
    await waitFor(() => {
      expect(api.post).toHaveBeenCalled();
    });
    // The insufficient-balance toast should NOT have been called
    const insufficientCalls = mockToast.error.mock.calls.filter(
      ([title]) => /insufficient/i.test(String(title))
    );
    expect(insufficientCalls).toHaveLength(0);
  });
});

/* =================================================================
   SUITE 3 — Member recipient validation
   ================================================================= */

describe('DonateModal — member recipient validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows recipient-required error when member mode is selected but no recipient chosen', async () => {
    renderOpen({});

    // Switch to "Another member" radio
    const memberRadio = screen.getByRole('radio', { name: /another member/i });
    fireEvent.click(memberRadio);

    setAmountField('2');
    clickDonate();

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringMatching(/recipient required/i),
        expect.anything()
      );
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows member search input when "Another member" radio is selected', () => {
    renderOpen({});
    const memberRadio = screen.getByRole('radio', { name: /another member/i });
    fireEvent.click(memberRadio);
    // The search input should now be in the DOM
    expect(screen.getByLabelText(/search by member/i)).toBeInTheDocument();
  });

  it('hides member search when switching back to community fund', () => {
    renderOpen({});

    // Switch to member
    const memberRadio = screen.getByRole('radio', { name: /another member/i });
    fireEvent.click(memberRadio);
    expect(screen.getByLabelText(/search by member/i)).toBeInTheDocument();

    // Switch back to community fund
    const fundRadio = screen.getByRole('radio', { name: /community fund/i });
    fireEvent.click(fundRadio);
    expect(screen.queryByLabelText(/search by member/i)).not.toBeInTheDocument();
  });
});

/* =================================================================
   SUITE 4 — Happy-path: community fund donation
   ================================================================= */

describe('DonateModal — community fund donation (happy path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POSTs to /v2/wallet/donate with community_fund payload', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });
    const onClose = vi.fn();

    renderOpen({ onClose });
    setAmountField('3');
    // Add an optional message
    const messageArea = screen.getByLabelText(/message/i);
    fireEvent.change(messageArea, { target: { value: 'Keep it up!' } });

    clickDonate();

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/wallet/donate', {
        recipient_type: 'community_fund',
        recipient_id: undefined,
        amount: 3,
        message: 'Keep it up!',
      });
    });
  });

  it('calls success toast after successful community fund donation', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    renderOpen({});
    setAmountField('2');
    clickDonate();

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        expect.stringMatching(/donation sent/i),
        expect.anything()
      );
    });
  });

  it('calls onClose and onDonationComplete after successful donation', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });
    const onClose = vi.fn();
    const onDonationComplete = vi.fn();

    renderOpen({ onClose, onDonationComplete });
    setAmountField('1');
    clickDonate();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
      expect(onDonationComplete).toHaveBeenCalledOnce();
    });
  });

  it('parses decimal amount correctly and sends it as a number', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    renderOpen({});
    setAmountField('2.5');
    clickDonate();

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/v2/wallet/donate',
        expect.objectContaining({ amount: 2.5 })
      );
    });
  });
});

/* =================================================================
   SUITE 5 — Happy-path: member donation
   ================================================================= */

describe('DonateModal — member donation (happy path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock user-search GET to return a result
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: {
        users: [
          {
            id: 42,
            first_name: 'Alice',
            last_name: 'Smith',
            username: 'alice',
            avatar: null,
          },
        ],
      },
    });
  });

  it('POSTs to /v2/wallet/donate with recipient_id when member is selected', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    renderOpen({});

    // Switch to member mode
    const memberRadio = screen.getByRole('radio', { name: /another member/i });
    fireEvent.click(memberRadio);

    // Type into the search field to trigger debounced search
    const searchInput = screen.getByLabelText(/search by member/i);
    fireEvent.change(searchInput, { target: { value: 'Al' } });

    // Wait for the debounced GET to fire and results to render
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringMatching(/\/v2\/wallet\/user-search\?q=Al/)
      );
    });

    // The search result "Alice Smith" should appear
    await waitFor(() => {
      expect(screen.getByText(/Alice Smith/i)).toBeInTheDocument();
    });

    // Click the result to select Alice
    fireEvent.click(screen.getByText(/Alice Smith/i));

    // Now set amount and submit
    setAmountField('3');
    clickDonate();

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/wallet/donate', {
        recipient_type: 'user',
        recipient_id: 42,
        amount: 3,
        message: '',
      });
    });
  });

  it('shows selected recipient name and a remove button after selection', async () => {
    renderOpen({});

    const memberRadio = screen.getByRole('radio', { name: /another member/i });
    fireEvent.click(memberRadio);

    const searchInput = screen.getByLabelText(/search by member/i);
    fireEvent.change(searchInput, { target: { value: 'Al' } });

    await waitFor(() => {
      expect(screen.getByText(/Alice Smith/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Alice Smith/i));

    // After selection the search box is gone, selected member info appears
    await waitFor(() => {
      expect(screen.queryByLabelText(/search by member/i)).not.toBeInTheDocument();
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    // Remove button should be present
    expect(screen.getByRole('button', { name: /remove recipient/i })).toBeInTheDocument();
  });

  it('renders recipient results in a labelled group of buttons, not an invalid empty listbox', async () => {
    // Regression: results were a role="listbox" wrapping HeroUI <Button role="option">s,
    // but React Aria does not forward role="option" to the DOM, so the listbox had zero
    // options — invalid ARIA that screen readers announce as an empty list. They are now
    // a role="group" (aria-label "Search results") of real, focusable result buttons.
    // Mirrors the same fix in TransferModal.
    renderOpen({});
    fireEvent.click(screen.getByRole('radio', { name: /another member/i }));
    fireEvent.change(screen.getByLabelText(/search by member/i), { target: { value: 'Al' } });

    const results = await screen.findByRole('group', { name: /search results/i });
    expect(within(results).getAllByRole('button').length).toBeGreaterThan(0);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('clears the selected recipient when remove button is pressed', async () => {
    renderOpen({});

    const memberRadio = screen.getByRole('radio', { name: /another member/i });
    fireEvent.click(memberRadio);

    const searchInput = screen.getByLabelText(/search by member/i);
    fireEvent.change(searchInput, { target: { value: 'Al' } });

    await waitFor(() => {
      expect(screen.getByText(/Alice Smith/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Alice Smith/i));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /remove recipient/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /remove recipient/i }));

    // Search input should be back
    await waitFor(() => {
      expect(screen.getByLabelText(/search by member/i)).toBeInTheDocument();
    });
  });
});

/* =================================================================
   SUITE 6 — User search debounce and edge cases
   ================================================================= */

describe('DonateModal — user search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('does NOT call GET for queries shorter than 2 characters', async () => {
    renderOpen({});

    const memberRadio = screen.getByRole('radio', { name: /another member/i });
    fireEvent.click(memberRadio);

    const searchInput = screen.getByLabelText(/search by member/i);
    fireEvent.change(searchInput, { target: { value: 'A' } });

    // Advance past debounce
    act(() => { vi.advanceTimersByTime(400); });

    expect(api.get).not.toHaveBeenCalled();
  });

  it('calls GET after the 300ms debounce for a 2+ char query', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: { users: [] } });

    renderOpen({});

    const memberRadio = screen.getByRole('radio', { name: /another member/i });
    fireEvent.click(memberRadio);

    const searchInput = screen.getByLabelText(/search by member/i);
    fireEvent.change(searchInput, { target: { value: 'Bo' } });

    // Before debounce fires, the GET should not have been called
    expect(api.get).not.toHaveBeenCalled();

    // Advance past the 300ms debounce and flush the microtask queue
    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(api.get).toHaveBeenCalledWith(
      expect.stringMatching(/\/v2\/wallet\/user-search\?q=Bo&limit=10/)
    );
  });
});

/* =================================================================
   SUITE 7 — API failure paths
   ================================================================= */

describe('DonateModal — API error paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows error toast when API returns success=false', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: false,
      error: 'Insufficient balance on server',
    });

    const onClose = vi.fn();
    renderOpen({ onClose });
    setAmountField('2');
    clickDonate();

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringMatching(/donation failed/i),
        expect.anything()
      );
    });
    // onClose should NOT have been called on failure
    expect(onClose).not.toHaveBeenCalled();
  });

  it('uses the error field from the API response in the toast description when present', async () => {
    const serverError = 'Account suspended';
    vi.mocked(api.post).mockResolvedValueOnce({ success: false, error: serverError });

    renderOpen({});
    setAmountField('2');
    clickDonate();

    await waitFor(() => {
      const errorCalls = mockToast.error.mock.calls;
      const hasServerMsg = errorCalls.some(
        ([, desc]) => String(desc).includes(serverError)
      );
      expect(hasServerMsg).toBe(true);
    });
  });

  it('shows error toast when api.post throws', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Network error'));

    const onClose = vi.fn();
    renderOpen({ onClose });
    setAmountField('2');
    clickDonate();

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringMatching(/donation failed/i),
        expect.anything()
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does NOT call onDonationComplete when donation fails', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: false });
    const onDonationComplete = vi.fn();

    renderOpen({ onDonationComplete });
    setAmountField('2');
    clickDonate();

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(onDonationComplete).not.toHaveBeenCalled();
  });
});

/* =================================================================
   SUITE 8 — Loading / disabled states during submission
   ================================================================= */

describe('DonateModal — loading and disabled states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables Cancel button while submission is in flight', async () => {
    // Hang the POST so we can observe the in-flight state
    let resolvePost!: (v: unknown) => void;
    vi.mocked(api.post).mockReturnValueOnce(
      new Promise((res) => { resolvePost = res; })
    );

    renderOpen({});
    setAmountField('2');
    clickDonate();

    // While in-flight the cancel button should be disabled
    await waitFor(() => {
      const cancelBtn = screen.getByRole('button', { name: /cancel/i });
      expect(cancelBtn).toBeDisabled();
    });

    // Resolve so timers / state can settle
    act(() => { resolvePost({ success: true }); });
  });

  it('re-enables Cancel button after submission completes', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: false });

    renderOpen({});
    setAmountField('2');
    clickDonate();

    await waitFor(() => {
      // After error the cancel button should be re-enabled
      const cancelBtn = screen.getByRole('button', { name: /cancel/i });
      expect(cancelBtn).not.toBeDisabled();
    });
  });
});

/* =================================================================
   SUITE 9 — Form reset on re-open
   ================================================================= */

describe('DonateModal — form reset on re-open', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets amount field when modal transitions closed→open', async () => {
    const { rerender } = render(
      <DonateModal
        isOpen={false}
        onClose={vi.fn()}
        currentBalance={10}
      />
    );

    // Open the modal and fill in an amount
    rerender(
      <DonateModal
        isOpen={true}
        onClose={vi.fn()}
        currentBalance={10}
      />
    );

    const amountInput = screen.getByLabelText(/amount/i);
    fireEvent.change(amountInput, { target: { value: '7' } });
    expect(amountInput).toHaveValue(7);

    // Close and re-open
    rerender(
      <DonateModal
        isOpen={false}
        onClose={vi.fn()}
        currentBalance={10}
      />
    );
    rerender(
      <DonateModal
        isOpen={true}
        onClose={vi.fn()}
        currentBalance={10}
      />
    );

    // Amount should have been reset to empty
    const freshInput = screen.getByLabelText(/amount/i);
    expect(freshInput).toHaveValue(null); // number input with empty string value
  });

  it('resets recipient type to community_fund when modal re-opens', async () => {
    const { rerender } = render(
      <DonateModal
        isOpen={true}
        onClose={vi.fn()}
        currentBalance={10}
      />
    );

    // Switch to member mode
    const memberRadio = screen.getByRole('radio', { name: /another member/i });
    fireEvent.click(memberRadio);
    expect(screen.getByLabelText(/search by member/i)).toBeInTheDocument();

    // Close and re-open
    rerender(
      <DonateModal
        isOpen={false}
        onClose={vi.fn()}
        currentBalance={10}
      />
    );
    rerender(
      <DonateModal
        isOpen={true}
        onClose={vi.fn()}
        currentBalance={10}
      />
    );

    // Search input should be gone (community_fund is default again)
    await waitFor(() => {
      expect(screen.queryByLabelText(/search by member/i)).not.toBeInTheDocument();
    });
  });
});
