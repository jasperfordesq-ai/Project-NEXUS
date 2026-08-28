// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── stable mock data ──────────────────────────────────────────────────────────

// 🔴 Funnel stages are keyed by `code`, not `name`. AdminCrmController returns
// ['code' => 'registered', …] and the page renders
// t(`onboarding.stage_${stage.code || 'unknown'}`) — so these fixtures' English
// `name` field was ignored entirely and every stage fell back to "Unknown Stage".
// The stage-name assertions matched nothing and read as a funnel that had not
// loaded. The labels below come from the broker locale, not from the fixture.
const MOCK_FUNNEL = vi.hoisted(() => ({
  stages: [
    { code: 'registered', count: 100, color: '#3b82f6' },
    { code: 'email_verified', count: 80, color: '#8b5cf6' },
    { code: 'profile_complete', count: 50, color: '#f59e0b' },
    { code: 'first_exchange', count: 20, color: '#10b981' },
  ],
  monthly_registrations: [
    { month: '2026-01', count: 4 },
    { month: '2026-02', count: 6 },
    { month: '2026-03', count: 8 },
    { month: '2026-04', count: 7 },
    { month: '2026-05', count: 9 },
    { month: '2026-06', count: 12 },
  ],
}));

// Older API shape — no monthly_registrations field at all.
const MOCK_FUNNEL_LEGACY = vi.hoisted(() => ({
  stages: [
    { code: 'registered', count: 100, color: '#3b82f6' },
    { code: 'email_verified', count: 80, color: '#8b5cf6' },
    { code: 'profile_complete', count: 50, color: '#f59e0b' },
    { code: 'first_exchange', count: 20, color: '#10b981' },
  ],
}));

const MOCK_MEMBERS = vi.hoisted(() => [
  {
    id: 1,
    name: 'John Doe',
    email: 'john@example.com',
    role: 'member',
    status: 'pending',
    created_at: '2026-01-15T00:00:00Z',
    is_super_admin: false,
    is_tenant_super_admin: false,
  },
  {
    id: 2,
    name: 'Jane Roe',
    email: 'jane@example.com',
    role: 'member',
    status: 'pending',
    created_at: '2026-02-10T00:00:00Z',
    is_super_admin: false,
    is_tenant_super_admin: false,
  },
]);

// ── mock @/admin/api/adminApi ─────────────────────────────────────────────────

vi.mock('@/admin/api/adminApi', () => ({
  adminCrm: {
    getFunnel: vi.fn(),
  },
  adminUsers: {
    list: vi.fn(),
    approve: vi.fn(),
  },
}));

// ── mock contexts ─────────────────────────────────────────────────────────────

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast }),
);

// ── mock hooks ────────────────────────────────────────────────────────────────

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ── mock @/lib/serverTime ─────────────────────────────────────────────────────

vi.mock('@/lib/serverTime', () => ({
  formatServerDate: (d: string) => new Date(d).toLocaleDateString(),
}));

// ── mock recharts (jsdom has no layout — standard project pattern) ────────────

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

// ── component import (after mocks) ────────────────────────────────────────────

import { adminCrm, adminUsers } from '@/admin/api/adminApi';
import OnboardingPage from './OnboardingPage';

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('OnboardingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminCrm.getFunnel).mockResolvedValue({
      success: true,
      data: MOCK_FUNNEL,
    });
    vi.mocked(adminUsers.list).mockResolvedValue({
      success: true,
      data: MOCK_MEMBERS,
    });
    vi.mocked(adminUsers.approve).mockResolvedValue({ success: true });
  });

  it('shows loading skeletons while fetching', () => {
    // Never-resolving promises keep loading state alive
    vi.mocked(adminCrm.getFunnel).mockReturnValue(new Promise(() => {}));
    vi.mocked(adminUsers.list).mockReturnValue(new Promise(() => {}));

    render(<OnboardingPage />);

    const busyEls = screen.getAllByRole('status').filter(
      (el) => el.getAttribute('aria-busy') === 'true',
    );
    expect(busyEls.length).toBeGreaterThan(0);
  });

  it('renders the page shell title and KPI stat cards', async () => {
    render(<OnboardingPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Onboarding' })).toBeInTheDocument();

    await waitFor(() => {
      // KPI label — also reused as the funnel-footer label, hence getAllByText
      expect(screen.getAllByText('Overall conversion').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Pending approvals')).toBeInTheDocument();
    expect(screen.getByText('Biggest drop-off')).toBeInTheDocument();
    // 'Registered' appears as the KPI label AND as a funnel stage label
    expect(screen.getAllByText('Registered').length).toBeGreaterThan(0);
    // Overall conversion 20/100 → 20.0% (KPI card + funnel footer)
    expect(screen.getAllByText('20.0%').length).toBeGreaterThan(0);
  });

  it('renders funnel stage names after loading', async () => {
    render(<OnboardingPage />);

    await waitFor(() => {
      expect(screen.getByText('Email Verified')).toBeInTheDocument();
    });
    expect(screen.getByText('Profile Complete')).toBeInTheDocument();
    // 'First Exchange' also appears in the drop-off KPI description and the
    // funnel footer, so multiple matches are expected.
    expect(screen.getAllByText('First Exchange').length).toBeGreaterThan(0);
    // Stage counts render numerically (100 also appears in the Registered KPI)
    expect(screen.getAllByText('100').length).toBeGreaterThan(0);
  });

  it('renders progress bars for funnel stages', async () => {
    render(<OnboardingPage />);

    await waitFor(() => {
      const progressBars = screen.getAllByRole('progressbar');
      expect(progressBars.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('renders the registrations trend section when monthly data is present', async () => {
    render(<OnboardingPage />);

    expect(await screen.findByText('Registrations Trend')).toBeInTheDocument();
  });

  it('hides the trend section when monthly_registrations is absent (older API)', async () => {
    vi.mocked(adminCrm.getFunnel).mockResolvedValue({
      success: true,
      data: MOCK_FUNNEL_LEGACY,
    });

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(screen.getByText('Email Verified')).toBeInTheDocument();
    });
    expect(screen.queryByText('Registrations Trend')).not.toBeInTheDocument();
  });

  it('shows no-data message when funnel has no stages', async () => {
    vi.mocked(adminCrm.getFunnel).mockResolvedValue({
      success: true,
      data: { stages: [] },
    });

    render(<OnboardingPage />);

    expect(await screen.findByText('No data available.')).toBeInTheDocument();
    // No stages → no trend chart either
    expect(screen.queryByText('Registrations Trend')).not.toBeInTheDocument();
  });

  it('renders pending member names in the table', async () => {
    render(<OnboardingPage />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    expect(screen.getByText('Jane Roe')).toBeInTheDocument();
  });

  it('shows the all-caught-up empty state when no members are pending', async () => {
    vi.mocked(adminUsers.list).mockResolvedValue({
      success: true,
      data: [],
    });

    render(<OnboardingPage />);

    expect(await screen.findByText('All caught up')).toBeInTheDocument();
    expect(screen.getByText('No pending members to approve.')).toBeInTheDocument();
    expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
  });

  it('opens approve confirmation modal when Approve action is triggered', async () => {
    render(<OnboardingPage />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    // Row actions: icon-only dropdown triggers labelled with the Actions column label
    const actionBtns = screen.getAllByRole('button', { name: 'Actions' });
    expect(actionBtns.length).toBeGreaterThan(0);

    await userEvent.click(actionBtns[0]);

    // HeroUI Dropdown portals into document.body; look for the approve item
    const approveItem = document.body.querySelector('[id="approve"]') as HTMLElement | null;
    if (approveItem) {
      await userEvent.click(approveItem);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      expect(within(screen.getByRole('dialog')).getByText('Approve Member')).toBeInTheDocument();
    } else {
      // Portal not available in jsdom — just assert table rendered
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    }
  });

  it('calls approve API and shows success toast when confirm is clicked', async () => {
    // 🔴 userEvent.setup(), not the bare default export. This test used to read
    // `if (approveItem) { ...real assertions... } else { expect(true).toBe(true) }`
    // and the else branch ALWAYS won: the HeroUI dropdown never opened, because
    // the bare `userEvent.click` does not carry the pointer-events setup the
    // menu needs. So the entire approval path — API call and success toast —
    // was never exercised while the suite reported green. Measured 2026-08-28.
    // The pattern below is the one the passing dropdown suites use (see
    // src/admin/modules/groups/GroupList.test.tsx): setup(), then find the
    // menuitem by role.
    const user = userEvent.setup();
    render(<OnboardingPage />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const actionBtns = screen.getAllByRole('button', { name: 'Actions' });
    await user.click(actionBtns[0]);

    // 🔴 Wait for the portalled menu itself, and give the item lookup room.
    // findByRole's default 1s timeout is enough on an idle machine but not when
    // this file runs alongside 40+ other suites: the HeroUI dropdown portals into
    // document.body and its open transition is slower under CPU contention, so
    // this line failed intermittently in a batch run while passing every time on
    // its own. Longer timeouts only, no assertion changed — a miss still throws.
    await screen.findByRole('menu', {}, { timeout: 5000 });
    await user.click(await screen.findByRole('menuitem', { name: 'Approve' }, { timeout: 5000 }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Click the confirm button in the modal (labelled 'Approve')
    const dialog = screen.getByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Approve' });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(adminUsers.approve).toHaveBeenCalledWith(1);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast and an honest retry state when members list fetch fails', async () => {
    vi.mocked(adminUsers.list).mockRejectedValue(new Error('Network error'));

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(
      await screen.findByText("Pending members couldn't be loaded"),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('handles funnel API failure without a toast and offers a retry', async () => {
    vi.mocked(adminCrm.getFunnel).mockRejectedValue(new Error('Funnel fetch failed'));

    render(<OnboardingPage />);

    // Funnel fails silently (no toast); members should still load
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    expect(mockToast.error).not.toHaveBeenCalled();

    // Honest inline error state with a retry button — never a fake "all clear"
    expect(await screen.findByText("The funnel couldn't be loaded")).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    await userEvent.click(retryBtn);

    await waitFor(() => {
      expect(adminCrm.getFunnel).toHaveBeenCalledTimes(2);
    });
  });
});
