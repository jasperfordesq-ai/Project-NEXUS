// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Hoisted mocks (must come before any vi.mock calls that reference them) ────
const { mockApi, mockNavigate } = vi.hoisted(() => {
  const m = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn() };
  return { mockApi: m, mockNavigate: vi.fn() };
});

vi.mock('@/lib/api', () => ({
  default: mockApi,
  api: mockApi,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// ── Mock contexts — a platform team member by default ─────────────────────────
const GOD_USER = {
  id: 1,
  name: 'God Admin',
  email: 'god@nexus.ie',
  is_god: true,
  is_admin: true,
  tenant_id: 1,
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({ user: GOD_USER, isAuthenticated: true, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  })
);

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ── Revenue dashboard fixture ─────────────────────────────────────────────────
// The shape TenantBillingService::getRevenueDashboard() sends, pinned on the
// server by tests/Laravel/Feature/Billing/RevenuePageTest.php. The fixture is
// typed with the page's own type, so an invented field fails the type check.
import { RevenueDashboard, type RevenueDashboardData } from './RevenueDashboard';

const REVENUE_DATA: RevenueDashboardData = {
  communities: 21,
  with_plan: 17,
  without_plan: 4,
  paying_platform: 12,
  paying_parent: 6,
  not_billed: 3,
  paused: 1,
  over_limit: 2,
  active_members: 1500,
  totals: [
    { currency: 'eur', monthly: 4800, yearly: 57600, communities: 9 },
    { currency: 'gbp', monthly: 640, yearly: 7680, communities: 3 },
  ],
  plan_breakdown: [
    { plan: 'Local', communities: 11, paying_platform: 8, monthly_eur: 2400, monthly_gbp: 640 },
    { plan: 'Pro', communities: 6, paying_platform: 4, monthly_eur: 2400, monthly_gbp: 0 },
  ],
  recent_changes: [
    { tenant_name: 'Test Timebank', action: 'standing_suspended', created_at: '2026-06-01 12:00:00', acted_by: 'Aoife Admin' },
    { tenant_name: 'Second Timebank', action: 'plan_changed', created_at: '2026-06-02 12:00:00', acted_by: null },
    { tenant_name: 'Third Timebank', action: 'something_new', created_at: '2026-06-03 12:00:00', acted_by: null },
  ],
};

describe('RevenueDashboard — platform team', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: REVENUE_DATA });
  });

  it('shows loading spinner while fetching', async () => {
    mockApi.get.mockReturnValue(new Promise(() => {}));
    render(<RevenueDashboard />);
    expect(document.querySelector('[role="status"][aria-busy="true"]')).toBeTruthy();
  });

  it('carries no "under development" warning: the owner had it removed on 23 Nov 2026', async () => {
    render(<RevenueDashboard />);

    await screen.findByRole('heading', { name: 'Expected income' });
    expect(screen.queryByText((text) => text.toLowerCase().includes('under development'))).not.toBeInTheDocument();
  });

  it('shows error card when API returns failure', async () => {
    mockApi.get.mockResolvedValue({ success: false });
    render(<RevenueDashboard />);
    await waitFor(() => expect(document.querySelector('[role="alert"]')).toBeTruthy());
  });

  it('shows error card when API throws', async () => {
    mockApi.get.mockRejectedValue(new Error('Network error'));
    render(<RevenueDashboard />);
    await waitFor(() => expect(document.querySelector('[role="alert"]')).toBeTruthy());
  });

  it('offers to try again when the figures cannot be loaded, and loads them when pressed', async () => {
    mockApi.get.mockResolvedValueOnce({ success: false });
    render(<RevenueDashboard />);
    const retry = await screen.findByRole('button', { name: 'Try again' });

    mockApi.get.mockResolvedValue({ success: true, data: REVENUE_DATA });
    retry.click();

    expect(await screen.findByRole('heading', { name: 'Expected income' })).toBeInTheDocument();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('calls the revenue API endpoint', async () => {
    render(<RevenueDashboard />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(mockApi.get.mock.calls[0][0]).toContain('/v2/admin/super/billing/revenue');
  });

  it('shows what is expected per month and per year in each currency, never added together', async () => {
    render(<RevenueDashboard />);

    await waitFor(() => expect(screen.getAllByText('Expected per month')).toHaveLength(2));
    expect(screen.getAllByText('Expected per year')).toHaveLength(2);
    expect(screen.getByText(/€\s?4[,.]800/)).toBeInTheDocument();
    expect(screen.getByText(/€\s?57[,.]600/)).toBeInTheDocument();
    // The plan table repeats the pound month figure for the one plan that has it.
    expect(screen.getAllByText(/£\s?640/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/£\s?7[,.]680/)).toBeInTheDocument();
    // 4800 + 640 is not a number anybody is owed.
    expect(screen.queryByText(/5[,.]440/)).not.toBeInTheDocument();
    expect(screen.getByText(/Euro and pounds are never added together/)).toBeInTheDocument();
  });

  it('gives each currency one card, named, with how many communities the figure comes from', async () => {
    render(<RevenueDashboard />);

    const euro = await screen.findByTestId('revenue-total-eur');
    expect(euro.textContent).toMatch(/Euro/i);
    expect(euro.textContent).toMatch(/€\s?4[,.]800/);
    expect(euro.textContent).toMatch(/€\s?57[,.]600/);
    expect(screen.getByTestId('revenue-total-eur-communities')).toHaveTextContent('Pay the platform: 9');

    const pounds = screen.getByTestId('revenue-total-gbp');
    expect(pounds.textContent).toMatch(/pound/i);
    // A pound figure is never inside the euro card.
    expect(euro.textContent).not.toMatch(/£/);
    expect(screen.getByTestId('revenue-total-gbp-communities')).toHaveTextContent('Pay the platform: 3');
  });

  it('groups the figures under three headings', async () => {
    render(<RevenueDashboard />);

    expect(await screen.findByRole('heading', { name: 'Expected income' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Communities and members' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Needs a look' })).toBeInTheDocument();
  });

  it('links each figure that needs a look to Billing control, already showing those communities', async () => {
    render(<RevenueDashboard />);

    const link = async (label: string) => (await screen.findByText(label)).closest('a');
    expect((await link('No plan'))?.getAttribute('href')).toContain('/platform-team/billing?show=no_plan');
    expect((await link('Over their member number'))?.getAttribute('href')).toContain('/platform-team/billing?show=over_limit');
    expect((await link('Paused'))?.getAttribute('href')).toContain('/platform-team/billing?show=paused');
    // The plain counts lead nowhere.
    expect(await link('Not billed')).toBeNull();
    expect(await link('Active members')).toBeNull();
  });

  it('says so when nobody pays the platform yet', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: { ...REVENUE_DATA, totals: [] } });
    render(<RevenueDashboard />);

    await waitFor(() => expect(screen.getByText('No community pays the platform yet.')).toBeInTheDocument());
    expect(screen.queryByText('Expected per month')).not.toBeInTheDocument();
  });

  it('counts who pays whom, and what needs a look', async () => {
    render(<RevenueDashboard />);

    const card = async (label: string) => {
      const heading = await screen.findByText(label);
      return heading.closest('div')?.parentElement?.textContent ?? '';
    };
    expect(await card('Pay the platform')).toContain('12');
    expect(await card('Pay the community above them')).toContain('6');
    expect(await card('Not billed')).toContain('3');
    expect(await card('No plan')).toContain('4');
    expect(await card('Over their member number')).toContain('2');
    expect(await card('Paused')).toContain('1');
    expect(await card('Active members')).toMatch(/1[,.]?500/);
  });

  it('lists each plan with its communities and what it brings in', async () => {
    render(<RevenueDashboard />);

    const local = (await screen.findByText('Local')).closest('tr');
    expect(local).not.toBeNull();
    const cells = Array.from(local?.querySelectorAll('td') ?? []).map((cell) => cell.textContent ?? '');
    expect(cells[1]).toBe('11');
    expect(cells[2]).toBe('8');
    expect(cells[3]).toMatch(/€\s?2[,.]400/);
    expect(cells[4]).toMatch(/£\s?640/);
    // Nothing on the page is "NaN": the old page read a field that was never sent.
    expect(document.body.textContent).not.toContain('NaN');
    expect(screen.getByText('Per month (EUR)')).toBeInTheDocument();
    expect(screen.getByText('Per month (GBP)')).toBeInTheDocument();
  });

  it('names each kind of change, says "Automatic" when nobody acted, and has a label for a kind it does not know', async () => {
    render(<RevenueDashboard />);

    await waitFor(() => expect(screen.getByText('Test Timebank')).toBeInTheDocument());
    expect(screen.getByText('Community paused')).toBeInTheDocument();
    expect(screen.getByText('Plan changed')).toBeInTheDocument();
    expect(screen.getByText('Another change')).toBeInTheDocument();
    expect(screen.getByText('Aoife Admin')).toBeInTheDocument();
    expect(screen.getAllByText('Automatic')).toHaveLength(2);
    // The headings say what the columns are.
    expect(screen.getByText('What changed')).toBeInTheDocument();
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.queryByText('Expiry Date')).not.toBeInTheDocument();
  });

  it('renders Back to Billing navigation link', async () => {
    render(<RevenueDashboard />);
    await waitFor(() => expect(screen.getByText(/back/i)).toBeInTheDocument());
  });

  it('says so when no community is on a plan', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: { ...REVENUE_DATA, plan_breakdown: [] } });
    render(<RevenueDashboard />);

    await waitFor(() => expect(screen.getByText('No community is on a plan yet.')).toBeInTheDocument());
  });
});
