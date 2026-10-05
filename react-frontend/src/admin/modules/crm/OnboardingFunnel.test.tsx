// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock adminApi (named export adminCrm) ──────────────────────────────────
const { mockAdminCrm } = vi.hoisted(() => ({
  mockAdminCrm: { getFunnel: vi.fn(), exportFunnel: vi.fn() },
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

vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
      <div data-testid="page-header-actions">{actions}</div>
    </div>
  ),
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
// Counts are nested ("reached this step or further"), as the API returns.
const stuckMember = { id: 42, name: 'Aoife Byrne', avatar_url: null, joined_at: '2026-09-20 10:00:00' };
const newestJoiner = { id: 7, name: 'Tomás Walsh', avatar_url: null, joined_at: '2026-10-04 09:00:00' };

const makeFunnelData = (overrides = {}) => ({
  total_members: 200,
  joined_days: 0,
  new_last_30_days: 12,
  stages: [
    { code: 'registered', name: 'SERVER COPY MUST NOT RENDER', count: 200, color: '#3b82f6', waiting: 20, waiting_members: [newestJoiner] },
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

// Everyone has reached the final step: every count is the whole membership and nobody waits anywhere.
const allRegulars = () =>
  makeFunnelData({ stages: makeFunnelData().stages.map((s) => ({ ...s, count: 200, waiting: 0, waiting_members: [] })) });

async function renderPage() {
  const { default: OnboardingFunnel } = await import('./OnboardingFunnel');
  render(<OnboardingFunnel />);
  await waitFor(() => expect(screen.getByText('The member journey')).toBeInTheDocument(), { timeout: 3000 });
}

const stepCard = (code: string) => document.getElementById(`funnel-step-${code}`)!;

// ─────────────────────────────────────────────────────────────────────────────
describe('OnboardingFunnel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminCrm.getFunnel.mockResolvedValue({ success: true, data: makeFunnelData() });
    mockAdminCrm.exportFunnel.mockResolvedValue(undefined);
    window.history.pushState({}, '', '/admin/crm/funnel');
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
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

  it('summarises members, regulars, who could use a nudge, and recent joiners', async () => {
    await renderPage();

    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('15% of members have made two or more exchanges.')).toBeInTheDocument();
    // 200 members minus 30 regulars.
    expect(screen.getByText('Could use a nudge')).toBeInTheDocument();
    expect(screen.getByText('170')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Looking at all 200 members.')).toBeInTheDocument();
  });

  it('calls out the step where most members are waiting', async () => {
    await renderPage();

    expect(screen.getByText('Where most people get stuck')).toBeInTheDocument();
    // Named in the callout and on the step itself.
    expect(screen.getAllByText('Confirmed email')).toHaveLength(2);
    expect(screen.getAllByText('Waiting at this step: 100')).toHaveLength(2);
  });

  it('"Show who" in the callout opens that step and puts it in the address', async () => {
    await renderPage();

    // The callout's button comes first in the document.
    fireEvent.click(screen.getAllByRole('button', { name: 'Show who' })[0]!);

    await waitFor(() => expect(window.location.search).toBe('?step=email_verified'));
    expect(await within(stepCard('email_verified')).findByRole('link', { name: /Aoife Byrne/ })).toBeInTheDocument();
  });

  it('lists the waiting members with links to their admin profile and a per-step export', async () => {
    await renderPage();

    const step = stepCard('email_verified');
    fireEvent.click(within(step).getByRole('button', { name: 'Show who' }));

    const link = await within(step).findByRole('link', { name: /Aoife Byrne/ });
    expect(link).toHaveAttribute('href', '/test/admin/users/42/edit');
    expect(within(step).getByText(/Joined 20 Sept 2026/)).toBeInTheDocument();
    expect(within(step).getByText('Showing the 1 newest of 100.')).toBeInTheDocument();

    fireEvent.click(within(step).getByRole('button', { name: 'Export this step' }));
    await waitFor(() => expect(mockAdminCrm.exportFunnel).toHaveBeenCalledWith({ joined_days: undefined, step: 'email_verified' }));
    expect(mockToast.success).toHaveBeenCalledWith('Export complete');

    // "Hide" closes it and clears the address.
    fireEvent.click(within(step).getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(within(step).queryByRole('link', { name: /Aoife Byrne/ })).not.toBeInTheDocument();
  });

  it('opens the step named in the address on load', async () => {
    window.history.pushState({}, '', '/admin/crm/funnel?step=registered');
    await renderPage();

    expect(within(stepCard('registered')).getByRole('link', { name: /Tomás Walsh/ })).toBeInTheDocument();
    expect(within(stepCard('email_verified')).queryByRole('link', { name: /Aoife Byrne/ })).not.toBeInTheDocument();
  });

  it('narrows the funnel to a cohort of recent joiners and writes it to the address', async () => {
    await renderPage();
    expect(mockAdminCrm.getFunnel).toHaveBeenLastCalledWith(undefined);
    mockAdminCrm.getFunnel.mockResolvedValueOnce({ success: true, data: makeFunnelData({ total_members: 40, joined_days: 90 }) });

    fireEvent.click(screen.getByRole('radio', { name: 'Last 90 days' }));

    await waitFor(() => expect(window.location.search).toBe('?joined=90'));
    await waitFor(() => expect(mockAdminCrm.getFunnel).toHaveBeenLastCalledWith({ joined_days: 90 }));
    expect(await screen.findByText('Looking at the 40 members who joined in the last 90 days.')).toBeInTheDocument();
    expect(screen.getByText('Joined in the chosen period, not counting banned or suspended accounts.')).toBeInTheDocument();
    expect(screen.getByText('Across the whole community, whatever period is chosen.')).toBeInTheDocument();

    // Back to everyone: the address is cleaned, not left as ?joined=all.
    fireEvent.click(screen.getByRole('radio', { name: 'Any time' }));
    await waitFor(() => expect(window.location.search).toBe(''));
    await waitFor(() => expect(mockAdminCrm.getFunnel).toHaveBeenLastCalledWith(undefined));
  });

  it('reads the cohort from the address on load and ignores values the page does not offer', async () => {
    window.history.pushState({}, '', '/admin/crm/funnel?joined=30');
    await renderPage();
    expect(mockAdminCrm.getFunnel).toHaveBeenLastCalledWith({ joined_days: 30 });
    expect(screen.getByRole('radio', { name: 'Last 30 days' })).toBeChecked();

    window.history.pushState({}, '', '/admin/crm/funnel?joined=7');
    mockAdminCrm.getFunnel.mockClear();
    const { default: OnboardingFunnel } = await import('./OnboardingFunnel');
    render(<OnboardingFunnel />);
    await waitFor(() => expect(mockAdminCrm.getFunnel).toHaveBeenCalledWith(undefined));
  });

  it('keeps the figures on screen, dimmed, while a cohort change loads', async () => {
    await renderPage();
    mockAdminCrm.getFunnel.mockImplementationOnce(() => new Promise(() => {}));

    fireEvent.click(screen.getByRole('radio', { name: 'Last 30 days' }));

    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(screen.getByText('The member journey')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  it('exports everyone who is waiting, in the current cohort', async () => {
    window.history.pushState({}, '', '/admin/crm/funnel?joined=365');
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: "Export who's waiting" }));

    await waitFor(() => expect(mockAdminCrm.exportFunnel).toHaveBeenCalledWith({ joined_days: 365, step: undefined }));
    expect(mockToast.success).toHaveBeenCalledWith('Export complete');
  });

  it('says so when an export fails', async () => {
    mockAdminCrm.exportFunnel.mockRejectedValueOnce(new Error('network'));
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: "Export who's waiting" }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Export failed'));
  });

  it('says so when nobody is waiting, and has nothing to export', async () => {
    mockAdminCrm.getFunnel.mockResolvedValueOnce({ success: true, data: allRegulars() });
    await renderPage();

    expect(screen.getByText('Nobody is waiting')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Export who's waiting" })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Show who' })).not.toBeInTheDocument();
  });

  it('shows an empty message when the community has no members', async () => {
    mockAdminCrm.getFunnel.mockResolvedValueOnce({
      success: true,
      data: makeFunnelData({ total_members: 0, stages: [], monthly_registrations: [] }),
    });
    const { default: OnboardingFunnel } = await import('./OnboardingFunnel');
    render(<OnboardingFunnel />);

    expect(await screen.findByText(/No members yet/)).toBeInTheDocument();
    expect(screen.getByText('No registration data')).toBeInTheDocument();
  });

  it('offers to show everyone when nobody joined in the chosen period', async () => {
    window.history.pushState({}, '', '/admin/crm/funnel?joined=30');
    mockAdminCrm.getFunnel.mockResolvedValueOnce({
      success: true,
      data: makeFunnelData({ total_members: 0, joined_days: 30, stages: [] }),
    });
    const { default: OnboardingFunnel } = await import('./OnboardingFunnel');
    render(<OnboardingFunnel />);

    expect(await screen.findByText('Nobody joined in this period.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show everyone' }));
    await waitFor(() => expect(window.location.search).toBe(''));
    await waitFor(() => expect(mockAdminCrm.getFunnel).toHaveBeenLastCalledWith(undefined));
  });

  it('renders the monthly chart with the same figures as a table', async () => {
    await renderPage();

    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'New members each month, as a table' });
    expect(within(table).getByRole('columnheader', { name: 'Month' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(7); // header + six months
    expect(within(table).getByRole('rowheader', { name: 'Jun 2026' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '4' })).toBeInTheDocument();
  });

  it('shows an error state with a retry button when the API fails, and recovers', async () => {
    mockAdminCrm.getFunnel.mockRejectedValueOnce(new Error('network error'));
    const { default: OnboardingFunnel } = await import('./OnboardingFunnel');
    render(<OnboardingFunnel />);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('The funnel could not be loaded.'));
    expect(screen.getByText('The funnel could not be loaded.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('The member journey')).toBeInTheDocument();
  });
});
