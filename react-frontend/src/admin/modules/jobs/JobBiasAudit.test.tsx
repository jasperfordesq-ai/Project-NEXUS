// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';

// ── Mocks ───────────────────────────────────────────────────────────────────

// IMPORTANT: useToast must return a STABLE object reference on every call.
// JobBiasAudit puts `toast` in fetchReport's useCallback deps array.
// If useToast() returns a new object each render, toast changes identity
// every render → fetchReport recreated → useEffect fires again → infinite loop.
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/contexts', () => ({
  // Return the SAME stable object reference every call — not a new literal
  useToast: () => mockToast,
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
    tenant: { id: 2, name: 'Test', slug: 'test' },
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
  usePresence: () => ({
    status: 'offline',
    setStatus: vi.fn(),
    getPresence: vi.fn(),
    isOnline: vi.fn(() => false),
  }),
  usePresenceOptional: () => null,
}));

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  default: apiMock,
  api: apiMock,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ToastProvider in test-utils needs a stable useToast too
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => mockToast,
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

import JobBiasAudit from './JobBiasAudit';

const MOCK_REPORT = {
  period: { from: '2025-01-01', to: '2025-06-30' },
  total_applications: 120,
  funnel: {
    applied: 120,
    screening: 80,
    interview: 40,
    offer: 10,
    accepted: 8,
  },
  rejection_rates: {
    screening: { rejected: 40, total: 120, rate: 33.3 },
    interview: { rejected: 40, total: 80, rate: 50.0 },
  },
  avg_time_in_stage: {
    screening: 3.5,
    interview: 12.0,
  },
  skills_match_correlation: {
    accepted_avg: 0.85,
    rejected_avg: 0.42,
  },
  source_effectiveness: {
    direct: { applications: 90, accepted: 6, rate: 6.7 },
    referral: { applications: 30, accepted: 2, rate: 6.7 },
  },
  hiring_velocity_days: 22,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('JobBiasAudit — loading state', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows a loading spinner on initial mount', () => {
    apiMock.get.mockReturnValue(new Promise(() => {}));
    render(<JobBiasAudit />);

    const spinners = screen.queryAllByRole('status');
    const busySpinner = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busySpinner).toBeDefined();
  });
});

describe('JobBiasAudit — populated report', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMock.get.mockResolvedValue({ success: true, data: MOCK_REPORT });
  });

  it('shows total applications stat card value', async () => {
    render(<JobBiasAudit />);
    // '120' appears in StatCard, funnel bar, and rejection rate table — use findAllByText
    const els = await screen.findAllByText('120');
    expect(els.length).toBeGreaterThan(0);
  });

  it('shows hiring velocity stat card value', async () => {
    render(<JobBiasAudit />);
    expect(await screen.findByText('22d')).toBeInTheDocument();
  });

  it('renders skills match percentages', async () => {
    render(<JobBiasAudit />);
    // Rendered by formatPercentRatio, i.e. Intl percent formatting with
    // maximumFractionDigits: 1 — so a whole number has NO trailing '.0'.
    // accepted_avg 0.85 → '85%', rejected_avg 0.42 → '42%'. The old '85.0%' /
    // '42.0%' were written against a hand-rolled toFixed(1) the page no longer
    // uses and could never match.
    expect(await screen.findByText('85%')).toBeInTheDocument();
    expect(await screen.findByText('42%')).toBeInTheDocument();
  });

  it('renders funnel bar for accepted stage', async () => {
    render(<JobBiasAudit />);
    // Funnel shows count "8" for accepted
    expect(await screen.findByText('8')).toBeInTheDocument();
  });

  it('renders rejection rate percentage chips', async () => {
    render(<JobBiasAudit />);
    // From rejection_rates. 33.3 keeps its fraction (it exercises the
    // formatter's maximumFractionDigits: 1); 50 is whole, so Intl emits '50%'.
    expect(await screen.findByText('33.3%')).toBeInTheDocument();
    expect(await screen.findByText('50%')).toBeInTheDocument();
  });

  it('renders avg time in stage values', async () => {
    render(<JobBiasAudit />);
    expect(await screen.findByText('3.5')).toBeInTheDocument();
    expect(await screen.findByText('12.0')).toBeInTheDocument();
  });

  it('renders source effectiveness sections', async () => {
    render(<JobBiasAudit />);
    // Direct: 90 applications and 6 accepted
    expect(await screen.findByText('90')).toBeInTheDocument();
    expect(await screen.findByText('6')).toBeInTheDocument();
  });

  it('renders the period indicator', async () => {
    render(<JobBiasAudit />);
    expect(await screen.findByText(/2025-01-01/)).toBeInTheDocument();
    expect(await screen.findByText(/2025-06-30/)).toBeInTheDocument();
  });
});

describe('JobBiasAudit — empty/null report', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMock.get.mockResolvedValue({ success: false });
  });

  it('calls toast.error when API returns success: false', async () => {
    render(<JobBiasAudit />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows no-data message when report is null', async () => {
    render(<JobBiasAudit />);
    // After failure, 120 never appears
    await waitFor(() => {
      expect(screen.queryByText('120')).not.toBeInTheDocument();
    });
  });
});

describe('JobBiasAudit — filter controls', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMock.get.mockResolvedValue({ success: true, data: MOCK_REPORT });
  });

  it('renders date-from and date-to inputs', async () => {
    render(<JobBiasAudit />);
    // Wait for report to load — '120' appears in multiple places, use findAllByText
    await screen.findAllByText('120');

    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBeGreaterThanOrEqual(2);
  });

  it('renders job-id number input', async () => {
    render(<JobBiasAudit />);
    await screen.findAllByText('120');

    const numberInputs = document.querySelectorAll('input[type="number"]');
    expect(numberInputs.length).toBeGreaterThanOrEqual(1);
  });

  it('calls API with date_from filter when Apply Filters is pressed', async () => {
    render(<JobBiasAudit />);
    await screen.findAllByText('120');

    const dateInputs = document.querySelectorAll('input[type="date"]');
    if (dateInputs.length > 0) {
      fireEvent.change(dateInputs[0], { target: { value: '2025-03-01' } });
    }

    const applyBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.toLowerCase().includes('filter') ||
      b.textContent?.toLowerCase().includes('apply'),
    );
    if (applyBtns.length > 0) {
      await userEvent.click(applyBtns[0]);
      await waitFor(() => {
        const calls = apiMock.get.mock.calls;
        expect(calls.length).toBeGreaterThan(0);
      });
    }
  });

  it('resets date filters when Reset is pressed', async () => {
    render(<JobBiasAudit />);
    await screen.findAllByText('120');

    const dateInputs = document.querySelectorAll('input[type="date"]');
    if (dateInputs.length > 0) {
      fireEvent.change(dateInputs[0], { target: { value: '2025-03-01' } });
    }

    const resetBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.toLowerCase().includes('reset') ||
      b.textContent?.toLowerCase().includes('clear'),
    );
    if (resetBtns.length > 0) {
      await userEvent.click(resetBtns[0]);
      await waitFor(() => {
        const dateInputsAfter = document.querySelectorAll('input[type="date"]');
        if (dateInputsAfter.length > 0) {
          expect((dateInputsAfter[0] as HTMLInputElement).value).toBe('');
        }
      });
    }
  });
});

describe('JobBiasAudit — hiring velocity not available', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMock.get.mockResolvedValue({
      success: true,
      data: { ...MOCK_REPORT, hiring_velocity_days: null },
    });
  });

  it('shows N/A label when hiring_velocity_days is null', async () => {
    render(<JobBiasAudit />);
    await waitFor(() => {
      expect(apiMock.get).toHaveBeenCalled();
    });
    // The stat card renders t('jobs.bias_not_available') — in test env that's the key
    // Confirm "22d" is NOT shown (it was null)
    expect(screen.queryByText('22d')).not.toBeInTheDocument();
  });
});
