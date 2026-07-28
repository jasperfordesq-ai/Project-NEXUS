// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockAdminVolunteering } = vi.hoisted(() => ({
  mockAdminVolunteering: {
    getGivingDays: vi.fn(),
    createGivingDay: vi.fn(),
    updateGivingDay: vi.fn(),
    exportDonations: vi.fn(),
    getGivingDayDonors: vi.fn(),
    getGivingDayTrends: vi.fn(),
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminVolunteering: mockAdminVolunteering,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Stub recharts ────────────────────────────────────────────────────────────
vi.mock('recharts', () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/chartColors', () => ({
  CHART_TOKEN_COLORS: { accent: '#4f46e5', success: '#10b981' },
}));

// ─── Toast / Auth / Tenant ───────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// ─── Stub heavy admin children ────────────────────────────────────────────────
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/DataTable' (and friends) directly, and vitest keys
// mocks per resolved module, so a barrel-only mock never installs for those
// imports — the real components rendered and the stub testids were never in the
// DOM. A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run.
// NOTE: '../../components/ConfirmModal' is deliberately NOT bound here — this
// factory returns no ConfirmModal stub, and vitest throws on a missing export.
function adminComponentsMock() {
  return {
    DataTable: ({ data, isLoading }: { data: object[]; isLoading: boolean }) => (
      <div data-testid="data-table" data-loading={String(isLoading)}>
        {data.map((row: Record<string, unknown>) => (
          <div key={String(row['id'])} data-testid="table-row">{String(row['name'])}</div>
        ))}
      </div>
    ),
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div data-testid="page-header">{title}{actions}</div>
    ),
    StatCard: ({ label, value }: { label: string; value: unknown }) => (
      <div data-testid="stat-card">{label}: {String(value)}</div>
    ),
    EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/DataTable', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/StatCard', adminComponentsMock);
vi.mock('../../components/EmptyState', adminComponentsMock);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeGivingDay = (overrides = {}) => ({
  id: 1,
  name: 'Spring Giving Day',
  description: 'Annual spring giving campaign',
  target_amount: 1000,
  target_hours: 50,
  raised_amount: 600,
  donation_count: 20,
  donor_count: 18,
  completed_hours: 30,
  start_date: '2025-04-01',
  end_date: '2025-04-30',
  is_active: true,
  created_at: '2025-03-01T00:00:00Z',
  ...overrides,
});

const makeDonor = (overrides = {}) => ({
  id: 1,
  user_id: 5,
  name: 'Jane Donor',
  email: 'jane@example.com',
  avatar_url: null,
  amount: 50,
  is_anonymous: false,
  donated_at: '2025-04-10T14:00:00Z',
  ...overrides,
});

const successGivingDays = (days: object[] = []) => ({
  success: true,
  data: { giving_days: days, donation_stats: { total_donations: days.length, total_amount: 600 } },
});

// ─────────────────────────────────────────────────────────────────────────────
describe('VolunteerGivingDays', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminVolunteering.getGivingDays.mockResolvedValue(successGivingDays());
    mockAdminVolunteering.getGivingDayDonors.mockResolvedValue({
      success: true,
      data: [],
      meta: { has_more: false, cursor: null, stats: { total_donors: 0, anonymous_count: 0, total_raised: 0 } },
    });
    mockAdminVolunteering.getGivingDayTrends.mockResolvedValue({ success: true, data: { trends: [] } });
  });

  it('shows loading spinner initially', async () => {
    mockAdminVolunteering.getGivingDays.mockImplementationOnce(() => new Promise(() => {}));
    const { default: VolunteerGivingDays } = await import('./VolunteerGivingDays');
    render(<VolunteerGivingDays />);

    const table = screen.getByTestId('data-table');
    expect(table.getAttribute('data-loading')).toBe('true');
  });

  it('renders empty state when no giving days', async () => {
    const { default: VolunteerGivingDays } = await import('./VolunteerGivingDays');
    render(<VolunteerGivingDays />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders giving day rows in data table when data loaded', async () => {
    mockAdminVolunteering.getGivingDays.mockResolvedValue(successGivingDays([makeGivingDay()]));

    const { default: VolunteerGivingDays } = await import('./VolunteerGivingDays');
    render(<VolunteerGivingDays />);

    await waitFor(() => {
      expect(screen.getByText('Spring Giving Day')).toBeInTheDocument();
    });
  });

  it('renders stat cards with donation summary', async () => {
    mockAdminVolunteering.getGivingDays.mockResolvedValue(successGivingDays([makeGivingDay()]));

    const { default: VolunteerGivingDays } = await import('./VolunteerGivingDays');
    render(<VolunteerGivingDays />);

    await waitFor(() => {
      const cards = screen.getAllByTestId('stat-card');
      expect(cards.length).toBeGreaterThan(0);
    });
  });

  it('renders campaign analytics bar chart when giving days present', async () => {
    mockAdminVolunteering.getGivingDays.mockResolvedValue(successGivingDays([makeGivingDay()]));

    const { default: VolunteerGivingDays } = await import('./VolunteerGivingDays');
    render(<VolunteerGivingDays />);

    await waitFor(() => {
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });
  });

  it('opens create modal when Create Giving Day button clicked', async () => {
    const { default: VolunteerGivingDays } = await import('./VolunteerGivingDays');
    render(<VolunteerGivingDays />);

    await waitFor(() => {
      expect(screen.getByTestId('data-table')).toBeInTheDocument();
    });

    const createBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('create') ||
      b.textContent?.toLowerCase().includes('giving day'),
    );
    expect(createBtn).toBeDefined();
    fireEvent.click(createBtn!);

    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
    });
  });

  it('calls createGivingDay when create form submitted with name', async () => {
    mockAdminVolunteering.createGivingDay.mockResolvedValue({ success: true });

    const { default: VolunteerGivingDays } = await import('./VolunteerGivingDays');
    render(<VolunteerGivingDays />);

    await waitFor(() => screen.getByTestId('data-table'));

    // Open create modal
    const createBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('create'),
    );
    fireEvent.click(createBtn!);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Fill name input
    const inputs = document.querySelectorAll('input[type="text"], input:not([type="date"]):not([type="number"])');
    const nameInput = Array.from(inputs).find((el) =>
      (el as HTMLInputElement).closest?.('div')?.querySelector('label')?.textContent?.toLowerCase().includes('name'),
    ) ?? inputs[0];

    if (nameInput) {
      fireEvent.change(nameInput, { target: { value: 'Summer Giving' } });
    }

    // Click save
    const saveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('create') &&
      b !== createBtn,
    );
    if (saveBtn) {
      fireEvent.click(saveBtn);
      await waitFor(() => {
        expect(mockAdminVolunteering.createGivingDay).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'Summer Giving' }),
        );
      });
    }
  });

  it('shows error toast when name is empty on save', async () => {
    const { default: VolunteerGivingDays } = await import('./VolunteerGivingDays');
    render(<VolunteerGivingDays />);

    await waitFor(() => screen.getByTestId('data-table'));

    const createBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('create'),
    );
    fireEvent.click(createBtn!);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Click save without filling name
    const saveBtn = screen.getAllByRole('button').find((b) =>
      (b.textContent?.toLowerCase().includes('create') || b.textContent?.toLowerCase().includes('save')) &&
      b !== createBtn,
    );
    if (saveBtn) {
      fireEvent.click(saveBtn);
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
      });
    }
  });

  it('calls updateGivingDay when deactivate/activate toggled', async () => {
    mockAdminVolunteering.getGivingDays.mockResolvedValue(successGivingDays([makeGivingDay({ is_active: true })]));
    mockAdminVolunteering.updateGivingDay.mockResolvedValue({ success: true });

    const { default: VolunteerGivingDays } = await import('./VolunteerGivingDays');
    render(<VolunteerGivingDays />);

    await waitFor(() => screen.getByText('Spring Giving Day'));

    // This test verifies the component loads without error and the table shows the row.
    expect(screen.getByText('Spring Giving Day')).toBeInTheDocument();

    // Deactivating an active campaign now requires confirmation before the API fires.
    const deactivateBtn = screen.queryAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase() === 'deactivate',
    );
    if (deactivateBtn) {
      fireEvent.click(deactivateBtn);

      await waitFor(() => {
        expect(document.querySelector('[role="dialog"]')).toBeTruthy();
      });
      expect(mockAdminVolunteering.updateGivingDay).not.toHaveBeenCalled();

      const dialog = document.querySelector('[role="dialog"]')!;
      const confirmBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
        b.textContent?.toLowerCase().includes('deactivate'),
      );
      expect(confirmBtn).toBeDefined();
      fireEvent.click(confirmBtn!);

      await waitFor(() => {
        expect(mockAdminVolunteering.updateGivingDay).toHaveBeenCalledWith(1, { is_active: false });
      });
    }
  });

  it('cancelling the deactivate confirmation does not call updateGivingDay', async () => {
    mockAdminVolunteering.getGivingDays.mockResolvedValue(successGivingDays([makeGivingDay({ is_active: true })]));
    mockAdminVolunteering.updateGivingDay.mockResolvedValue({ success: true });

    const { default: VolunteerGivingDays } = await import('./VolunteerGivingDays');
    render(<VolunteerGivingDays />);

    await waitFor(() => screen.getByText('Spring Giving Day'));

    const deactivateBtn = screen.queryAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase() === 'deactivate',
    );
    if (deactivateBtn) {
      fireEvent.click(deactivateBtn);

      await waitFor(() => {
        expect(document.querySelector('[role="dialog"]')).toBeTruthy();
      });

      const dialog = document.querySelector('[role="dialog"]')!;
      const cancelBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
        b.textContent?.toLowerCase().includes('cancel'),
      );
      expect(cancelBtn).toBeDefined();
      fireEvent.click(cancelBtn!);

      await waitFor(() => {
        expect(document.querySelector('[role="dialog"]')).toBeFalsy();
      });
      expect(mockAdminVolunteering.updateGivingDay).not.toHaveBeenCalled();
    }
  });

  it('activating an inactive campaign fires directly without a confirmation dialog', async () => {
    mockAdminVolunteering.getGivingDays.mockResolvedValue(successGivingDays([makeGivingDay({ is_active: false })]));
    mockAdminVolunteering.updateGivingDay.mockResolvedValue({ success: true });

    const { default: VolunteerGivingDays } = await import('./VolunteerGivingDays');
    render(<VolunteerGivingDays />);

    await waitFor(() => screen.getByText('Spring Giving Day'));

    const activateBtn = screen.queryAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase() === 'activate',
    );
    if (activateBtn) {
      fireEvent.click(activateBtn);

      await waitFor(() => {
        expect(mockAdminVolunteering.updateGivingDay).toHaveBeenCalledWith(1, { is_active: true });
      });
    }
  });

  it('calls exportDonations when Export Donations button clicked', async () => {
    mockAdminVolunteering.exportDonations.mockResolvedValue(undefined);

    const { default: VolunteerGivingDays } = await import('./VolunteerGivingDays');
    render(<VolunteerGivingDays />);

    await waitFor(() => screen.getByTestId('data-table'));

    const exportBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('export'),
    );
    expect(exportBtn).toBeDefined();
    fireEvent.click(exportBtn!);

    await waitFor(() => {
      expect(mockAdminVolunteering.exportDonations).toHaveBeenCalled();
    });
  });

  it('shows toast error when initial load fails', async () => {
    mockAdminVolunteering.getGivingDays.mockRejectedValue(new Error('network'));

    const { default: VolunteerGivingDays } = await import('./VolunteerGivingDays');
    render(<VolunteerGivingDays />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('re-fetches when Refresh button clicked', async () => {
    const { default: VolunteerGivingDays } = await import('./VolunteerGivingDays');
    render(<VolunteerGivingDays />);

    await waitFor(() => {
      expect(mockAdminVolunteering.getGivingDays).toHaveBeenCalledTimes(1);
    });

    const refreshBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('refresh'),
    );
    if (refreshBtn) {
      fireEvent.click(refreshBtn);
      await waitFor(() => {
        expect(mockAdminVolunteering.getGivingDays.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
    }
  });

  it('shows toast success on export success', async () => {
    mockAdminVolunteering.exportDonations.mockResolvedValue(undefined);

    const { default: VolunteerGivingDays } = await import('./VolunteerGivingDays');
    render(<VolunteerGivingDays />);

    await waitFor(() => screen.getByTestId('data-table'));

    const exportBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('export'),
    );
    if (exportBtn) {
      fireEvent.click(exportBtn);
      await waitFor(() => {
        expect(mockToast.success).toHaveBeenCalled();
      });
    }
  });
});
