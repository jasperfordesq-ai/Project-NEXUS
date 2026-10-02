// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock adminApi (named export adminCrm) ──────────────────────────────────
const { mockAdminCrm } = vi.hoisted(() => ({
  mockAdminCrm: { getFunnel: vi.fn() },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminCrm: mockAdminCrm,
  adminUsers: { list: vi.fn() },
  adminPages: { list: vi.fn() },
  adminMenus: { list: vi.fn() },
}));

// ─── Recharts — stub to avoid DOM measurement errors ────────────────────────
vi.mock('recharts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('recharts')>();
  return {
    ...orig,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
    Bar: () => null,
    Cell: () => null,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
  };
});

vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

// ─── Contexts ────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Fixtures ────────────────────────────────────────────────────────────────
// Counts are nested ("reached this step or further"), as the API now returns.
const stuckMember = { id: 42, name: 'Aoife Byrne', avatar_url: null, joined_at: '2026-09-20 10:00:00' };

const makeFunnelData = (overrides = {}) => ({
  total_members: 200,
  new_last_30_days: 12,
  stages: [
    { code: 'registered', name: 'SERVER COPY MUST NOT RENDER', count: 200, color: '#3b82f6', waiting: 20, waiting_members: [] },
    { code: 'email_verified', count: 180, color: '#6366f1', waiting: 100, waiting_members: [stuckMember] },
    { code: 'profile_complete', count: 80, color: '#8b5cf6', waiting: 10, waiting_members: [] },
    { code: 'first_listing', count: 70, color: '#a855f7', waiting: 20, waiting_members: [] },
    { code: 'first_exchange', count: 50, color: '#d946ef', waiting: 20, waiting_members: [] },
    { code: 'repeat_user', count: 30, color: '#ec4899', waiting: 0, waiting_members: [] },
  ],
  monthly_registrations: [
    { month: '2026-05', count: 0 },
    { month: '2026-06', count: 4 },
    { month: '2026-07', count: 6 },
    { month: '2026-08', count: 3 },
    { month: '2026-09', count: 9 },
    { month: '2026-10', count: 1 },
  ],
  ...overrides,
});

async function renderPage() {
  const { default: OnboardingFunnel } = await import('./OnboardingFunnel');
  render(<OnboardingFunnel />);
  await waitFor(() => expect(screen.getByText('The member journey')).toBeInTheDocument(), { timeout: 3000 });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('OnboardingFunnel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminCrm.getFunnel.mockResolvedValue({ success: true, data: makeFunnelData() });
  });

  it('shows a loading spinner while data is fetching', async () => {
    mockAdminCrm.getFunnel.mockImplementationOnce(() => new Promise(() => {}));
    const { default: OnboardingFunnel } = await import('./OnboardingFunnel');
    render(<OnboardingFunnel />);

    const busy = screen.getAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('names each step in plain language, never the server copy', async () => {
    await renderPage();

    for (const title of ['Joined', 'Confirmed email', 'Filled in profile', 'Posted a listing', 'First exchange']) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('Regular member').length).toBeGreaterThan(0);
    expect(screen.queryByText('SERVER COPY MUST NOT RENDER')).not.toBeInTheDocument();
  });

  it('shows every percentage as a share of all members, so none can exceed 100%', async () => {
    await renderPage();

    expect(screen.getByText('80 of 200 members')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    const percentages = screen.getAllByText(/^\d+%$/).map((el) => Number.parseInt(el.textContent ?? '', 10));
    expect(percentages.length).toBeGreaterThan(0);
    expect(Math.max(...percentages)).toBeLessThanOrEqual(100);
  });

  it('summarises members, regulars and recent joiners once each', async () => {
    await renderPage();

    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('15% of members have made two or more exchanges.')).toBeInTheDocument();
  });

  it('calls out the step where most members are waiting', async () => {
    await renderPage();

    const callout = screen.getByText('Where most people get stuck').closest('div')!.parentElement!;
    expect(within(callout).getByText('Confirmed email')).toBeInTheDocument();
    expect(within(callout).getByText(/Waiting at this step: 100/)).toBeInTheDocument();
  });

  it('lists the waiting members with links to their admin profile', async () => {
    await renderPage();

    const step = document.getElementById('funnel-step-email_verified')!;
    fireEvent.click(within(step).getByRole('button', { name: 'Show who' }));

    const link = await within(step).findByRole('link', { name: /Aoife Byrne/ });
    expect(link).toHaveAttribute('href', '/test/admin/users/42/edit');
    expect(within(step).getByText('Showing the 1 newest of 100.')).toBeInTheDocument();
  });

  it('says so when nobody is waiting', async () => {
    mockAdminCrm.getFunnel.mockResolvedValueOnce({
      success: true,
      data: makeFunnelData({
        stages: makeFunnelData().stages.map((s) => ({ ...s, waiting: 0, waiting_members: [] })),
      }),
    });
    await renderPage();

    expect(screen.getByText('Nobody is waiting')).toBeInTheDocument();
  });

  it('shows an empty message when the community has no members', async () => {
    mockAdminCrm.getFunnel.mockResolvedValueOnce({
      success: true,
      data: makeFunnelData({ total_members: 0, stages: [], monthly_registrations: [] }),
    });
    const { default: OnboardingFunnel } = await import('./OnboardingFunnel');
    render(<OnboardingFunnel />);

    expect(await screen.findByText(/No members yet/)).toBeInTheDocument();
  });

  it('renders the monthly chart', async () => {
    await renderPage();

    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });

  it('shows an error state with a retry button when the API fails', async () => {
    mockAdminCrm.getFunnel.mockRejectedValueOnce(new Error('network error'));
    const { default: OnboardingFunnel } = await import('./OnboardingFunnel');
    render(<OnboardingFunnel />);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });
});
