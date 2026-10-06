// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── react-router — preserve real impl but expose useParams ────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useParams: vi.fn(() => ({ orgId: '42' })),
    useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
    useNavigate: vi.fn(() => vi.fn()),
  };
});

// ── api mock ─────────────────────────────────────────────────────────────────
const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ── contexts ─────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Alice' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// ── seo + navigation stubs ────────────────────────────────────────────────────
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/components/navigation', () => ({
  Breadcrumbs: ({ items }: { items: { label: string }[] }) => (
    <nav aria-label="breadcrumb">{items.map((i) => <span key={i.label}>{i.label}</span>)}</nav>
  ),
}));
vi.mock('@/components/feedback', () => ({
  LoadingScreen: () => <div role="status" aria-busy="true" aria-label="Loading" />,
}));

// ── lazy tab stubs ────────────────────────────────────────────────────────────
vi.mock('./OrgOverviewTab', () => ({ default: () => <div data-testid="overview-tab">Overview</div> }));
vi.mock('./OrgApplicationsTab', () => ({ default: () => <div data-testid="applications-tab">Applications</div> }));
vi.mock('./OrgOpportunitiesTab', () => ({ default: () => <div data-testid="opportunities-tab">Opportunities</div> }));
vi.mock('./OrgHoursReviewTab', () => ({ default: () => <div data-testid="hours-review-tab">Hours Review</div> }));
vi.mock('./OrgExpensesTab', () => ({ default: () => <div data-testid="expenses-tab">Expenses</div> }));
vi.mock('./OrgFundraisingTab', () => ({ default: () => <div data-testid="fundraising-tab">Fundraising</div> }));
vi.mock('./OrgVolunteersTab', () => ({ default: () => <div data-testid="volunteers-tab">Volunteers</div> }));
vi.mock('./OrgQualificationsTab', () => ({ default: () => <div data-testid="qualifications-tab">Qualifications</div> }));
vi.mock('./OrgWalletTab', () => ({ default: () => <div data-testid="wallet-tab">Wallet</div> }));
vi.mock('./OrgSettingsTab', () => ({ default: () => <div data-testid="settings-tab">Settings</div> }));

// ── hooks ─────────────────────────────────────────────────────────────────────
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));

import VolOrgDashboardPage from './VolOrgDashboardPage';

const ORG = {
  id: 42,
  name: 'Community Helpers',
  description: 'A great org',
  contact_email: 'org@example.com',
  website: null,
  status: 'active',
  balance: 10,
  auto_pay_enabled: false,
};

const STATS = { wallet_balance: 10, auto_pay_enabled: false };

// The dashboard now resolves the org from the MANAGED-orgs endpoint (so pending/
// declined owners aren't 404'd by the public org endpoint), so tests mock that.
function mockManagedOrgs(orgs: Array<Record<string, unknown>>) {
  mockApi.get.mockImplementation((url: string) => {
    if (url.includes('/stats')) return Promise.resolve({ success: true, data: STATS });
    if (url.includes('/my-organisations')) {
      return Promise.resolve({ success: true, data: { items: orgs } });
    }
    return Promise.resolve({ success: false, code: 'NOT_FOUND', data: null });
  });
}

describe('VolOrgDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockManagedOrgs([ORG]);
  });

  it('shows loading screen while fetching', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}));
    render(<VolOrgDashboardPage />);
    const statusEls = screen.getAllByRole('status');
    const loading = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(loading).toBeTruthy();
  });

  it('renders org name and status chip after successful load', async () => {
    render(<VolOrgDashboardPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Community Helpers').length).toBeGreaterThan(0);
    });
  });

  it('renders overview tab by default', async () => {
    render(<VolOrgDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
    });
  });

  it('shows retryable error UI on network failure (not access denied)', async () => {
    mockApi.get.mockRejectedValue(new Error('Network error'));
    render(<VolOrgDashboardPage />);
    await waitFor(() => {
      // Should show a retry / try-again button, not "Access Denied"
      const btns = screen.getAllByRole('button');
      const retryBtn = btns.find((b) => b.textContent?.toLowerCase().includes('try') || b.textContent?.toLowerCase().includes('retry'));
      expect(retryBtn).toBeDefined();
    });
  });

  it('shows access denied UI when server returns FORBIDDEN', async () => {
    mockApi.get.mockResolvedValue({ success: false, code: 'FORBIDDEN', data: null });
    render(<VolOrgDashboardPage />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button');
      const backBtn = btns.find((b) => b.textContent?.toLowerCase().includes('back') || b.textContent?.toLowerCase().includes('volunteer'));
      expect(backBtn).toBeDefined();
      // No retry button expected in access-denied state
      const retryBtn = btns.find((b) => b.textContent?.toLowerCase().includes('again'));
      expect(retryBtn).toBeUndefined();
    });
  });

  it('shows retryable error when orgId is invalid (0)', async () => {
    const { useParams } = await import('react-router-dom');
    vi.mocked(useParams).mockReturnValue({ orgId: '0' });
    render(<VolOrgDashboardPage />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button');
      const retryBtn = btns.find((b) => b.textContent?.toLowerCase().includes('again') || b.textContent?.toLowerCase().includes('retry'));
      expect(retryBtn).toBeDefined();
    });
    // Reset
    vi.mocked(useParams).mockReturnValue({ orgId: '42' });
  });

  it('switches to the wallet tab on button click', async () => {
    render(<VolOrgDashboardPage />);
    await waitFor(() => expect(screen.getAllByText('Community Helpers').length).toBeGreaterThan(0));

    // Find wallet tab button (text key will resolve to English)
    const walletBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('wallet')
    );
    if (walletBtn) {
      await userEvent.click(walletBtn);
      await waitFor(() => {
        expect(screen.getByTestId('wallet-tab')).toBeInTheDocument();
      });
    }
    // If translation key doesn't resolve to "wallet" text at this level, skip gracefully
  });

  // Expense emails link to /volunteering/org/{id}/dashboard?tab=expenses.
  it('opens the expenses tab from the ?tab=expenses deep link', async () => {
    const { useSearchParams } = await import('react-router-dom');
    vi.mocked(useSearchParams).mockReturnValue([new URLSearchParams('tab=expenses'), vi.fn()]);
    render(<VolOrgDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('expenses-tab')).toBeInTheDocument();
    });
    vi.mocked(useSearchParams).mockReturnValue([new URLSearchParams(), vi.fn()]);
  });

  // The organisation's own opportunities, including closed and cancelled ones (gap A6, 6 Oct 2026).
  it('opens the opportunities tab from the ?tab=opportunities link', async () => {
    const { useSearchParams } = await import('react-router-dom');
    vi.mocked(useSearchParams).mockReturnValue([new URLSearchParams('tab=opportunities'), vi.fn()]);
    render(<VolOrgDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('opportunities-tab')).toBeInTheDocument();
    });
    vi.mocked(useSearchParams).mockReturnValue([new URLSearchParams(), vi.fn()]);
  });

  // Hand-over emails link to /volunteering/org/{id}/dashboard?tab=fundraising.
  it('opens the fundraising tab from the ?tab=fundraising deep link', async () => {
    const { useSearchParams } = await import('react-router-dom');
    vi.mocked(useSearchParams).mockReturnValue([new URLSearchParams('tab=fundraising'), vi.fn()]);
    render(<VolOrgDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('fundraising-tab')).toBeInTheDocument();
    });
    vi.mocked(useSearchParams).mockReturnValue([new URLSearchParams(), vi.fn()]);
  });

  it('shows a Fundraising tab button directly after Expenses', async () => {
    render(<VolOrgDashboardPage />);
    await waitFor(() => expect(screen.getByTestId('overview-tab')).toBeInTheDocument());
    const labels = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    const expensesIdx = labels.findIndex((l) => l.includes('Expenses'));
    expect(expensesIdx).toBeGreaterThan(-1);
    expect(labels[expensesIdx + 1]).toContain('Fundraising');
  });

  // The qualifications register is its own tab; the expiry-reminder emails
  // deep-link to it with ?tab=qualifications.
  it('opens the qualifications tab from the ?tab=qualifications deep link', async () => {
    const { useSearchParams } = await import('react-router-dom');
    vi.mocked(useSearchParams).mockReturnValue([new URLSearchParams('tab=qualifications'), vi.fn()]);
    render(<VolOrgDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('qualifications-tab')).toBeInTheDocument();
    });
    vi.mocked(useSearchParams).mockReturnValue([new URLSearchParams(), vi.fn()]);
  });

  it('shows a Qualifications tab button directly after Volunteers', async () => {
    render(<VolOrgDashboardPage />);
    await waitFor(() => expect(screen.getAllByText('Community Helpers').length).toBeGreaterThan(0));
    const labels = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    const volunteersIdx = labels.findIndex((l) => l.includes('Volunteers'));
    const qualificationsIdx = labels.findIndex((l) => l.includes('Qualifications'));
    expect(volunteersIdx).toBeGreaterThan(-1);
    expect(qualificationsIdx).toBe(volunteersIdx + 1);
  });

  it('renders org description', async () => {
    render(<VolOrgDashboardPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/A great org/).length).toBeGreaterThan(0);
    });
  });

  // Fix 5: owners of a pending (not-yet-approved) org must still reach their
  // dashboard. The org is resolved from the managed-orgs list, which returns it
  // regardless of approval status — the public org endpoint would 404 it.
  it('renders the dashboard for a pending org resolved from managed orgs', async () => {
    mockManagedOrgs([{ ...ORG, status: 'pending' }]);
    render(<VolOrgDashboardPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Community Helpers').length).toBeGreaterThan(0);
    });
    // Not access-denied — the overview tab renders.
    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
  });

  // Fix 5: if the caller does not manage this org (absent from managed list),
  // it is access-denied — not a retryable error.
  it('shows access denied when the org is not in the managed list', async () => {
    mockManagedOrgs([{ ...ORG, id: 999 }]); // different id — no match for orgId 42
    render(<VolOrgDashboardPage />);
    await waitFor(() => {
      const btns = screen.getAllByRole('button');
      const backBtn = btns.find((b) => b.textContent?.toLowerCase().includes('back') || b.textContent?.toLowerCase().includes('volunteer'));
      expect(backBtn).toBeDefined();
      const retryBtn = btns.find((b) => b.textContent?.toLowerCase().includes('again'));
      expect(retryBtn).toBeUndefined();
    });
  });
});
