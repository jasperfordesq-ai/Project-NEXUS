// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ─────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Recharts — stub to avoid canvas/SVG issues in jsdom ─────────────────────
vi.mock('recharts', () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// ─── Toast / Contexts ─────────────────────────────────────────────────────────
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
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// ─── Stub admin sub-components ────────────────────────────────────────────────
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/PageHeader' and '../../components/StatCard'
// directly, and vitest keys mocks per resolved module, so a barrel-only mock
// never installs for those imports.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run.
function adminComponentsMock() {
  return {
    PageHeader: ({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {actions}
      </div>
    ),
    StatCard: ({ label, value }: { label: string; value: string; icon?: unknown; color?: string }) => (
      <div data-testid="stat-card">
        <span data-testid="stat-label">{label}</span>
        <span data-testid="stat-value">{value}</span>
      </div>
    ),
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/StatCard', adminComponentsMock);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeAnalytics = (overrides = {}) => ({
  success: true,
  data: {
    config: {
      enabled: true,
      min_score: 0.55,
      cooldown_days: 14,
      daily_limit: 25,
    },
    stats: {
      sent_total: 500,
      sent_30d: 42,
      converted_total: 150,
      converted_30d: 10,
      conversion_rate_30d: 0.238,
      opted_out_members: 3,
    },
    recent: [],
    eligible_candidates: 18,
    ...overrides,
  },
});

const makeNudge = (overrides = {}) => ({
  id: 1,
  target_user: { id: 10, name: 'Alice' },
  related_user: { id: 20, name: 'Bob' },
  score: 0.872,
  status: 'sent',
  sent_at: '2025-05-01T10:00:00Z',
  converted_at: null,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SmartNudgesAdminPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows loading spinner while fetching analytics', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));
    const mod = await import('./SmartNudgesAdminPage');
    const SmartNudgesAdminPage = mod.default;
    render(<SmartNudgesAdminPage />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders stat cards after data loads', async () => {
    mockApi.get.mockResolvedValue(makeAnalytics());
    const mod = await import('./SmartNudgesAdminPage');
    const SmartNudgesAdminPage = mod.default;
    render(<SmartNudgesAdminPage />);

    await waitFor(() => {
      const statCards = screen.getAllByTestId('stat-card');
      expect(statCards.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('shows the 30-day bar chart', async () => {
    mockApi.get.mockResolvedValue(makeAnalytics());
    const mod = await import('./SmartNudgesAdminPage');
    const SmartNudgesAdminPage = mod.default;
    render(<SmartNudgesAdminPage />);

    await waitFor(() => {
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });
  });

  it('shows error toast when load fails', async () => {
    mockApi.get.mockResolvedValue({ success: false, error: 'Server error' });
    const mod = await import('./SmartNudgesAdminPage');
    const SmartNudgesAdminPage = mod.default;
    render(<SmartNudgesAdminPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows error toast on network error', async () => {
    mockApi.get.mockRejectedValue(new Error('network fail'));
    const mod = await import('./SmartNudgesAdminPage');
    const SmartNudgesAdminPage = mod.default;
    render(<SmartNudgesAdminPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('calls save config endpoint and shows success toast', async () => {
    mockApi.get.mockResolvedValue(makeAnalytics());
    mockApi.put.mockResolvedValue({ success: true, data: { config: {} } });
    // Second get after save
    mockApi.get.mockResolvedValueOnce(makeAnalytics())
              .mockResolvedValueOnce(makeAnalytics());

    const mod = await import('./SmartNudgesAdminPage');
    const SmartNudgesAdminPage = mod.default;
    render(<SmartNudgesAdminPage />);

    await waitFor(() => screen.getAllByTestId('stat-card'));

    const saveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('save') || b.textContent?.toLowerCase().includes('config')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockApi.put).toHaveBeenCalledWith(
        '/v2/admin/caring-community/nudges/config',
        expect.objectContaining({ enabled: true, min_score: 0.55, cooldown_days: 14, daily_limit: 25 })
      );
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('calls dry-run dispatch and shows toast with count', async () => {
    mockApi.get.mockResolvedValue(makeAnalytics());
    mockApi.post.mockResolvedValue({
      success: true,
      data: { dry_run: true, candidates: [{ target_user_id: 10, related_user_id: 20, score: 0.87 }] },
    });

    const mod = await import('./SmartNudgesAdminPage');
    const SmartNudgesAdminPage = mod.default;
    render(<SmartNudgesAdminPage />);

    await waitFor(() => screen.getAllByTestId('stat-card'));

    const dryRunBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('dry') || b.textContent?.toLowerCase().includes('preview') || b.textContent?.toLowerCase().includes('test')
    );
    if (dryRunBtn) fireEvent.click(dryRunBtn);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/admin/caring-community/nudges/dispatch',
        { dry_run: true }
      );
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows dry-run result table after dry run', async () => {
    mockApi.get.mockResolvedValue(makeAnalytics());
    mockApi.post.mockResolvedValue({
      success: true,
      data: { dry_run: true, candidates: [{ target_user_id: 11, related_user_id: 22, score: 0.91 }] },
    });

    const mod = await import('./SmartNudgesAdminPage');
    const SmartNudgesAdminPage = mod.default;
    render(<SmartNudgesAdminPage />);

    await waitFor(() => screen.getAllByTestId('stat-card'));

    const dryRunBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('dry') || b.textContent?.toLowerCase().includes('preview')
    );
    if (dryRunBtn) fireEvent.click(dryRunBtn);

    await waitFor(() => {
      // Dry-run results show candidate IDs
      expect(screen.getByText(/#11/)).toBeInTheDocument();
      expect(screen.getByText(/#22/)).toBeInTheDocument();
    });
  });

  it('opens confirm dispatch modal when Dispatch Now is clicked', async () => {
    mockApi.get.mockResolvedValue(makeAnalytics({ config: { enabled: true, min_score: 0.55, cooldown_days: 14, daily_limit: 25 } }));

    const mod = await import('./SmartNudgesAdminPage');
    const SmartNudgesAdminPage = mod.default;
    render(<SmartNudgesAdminPage />);

    await waitFor(() => screen.getAllByTestId('stat-card'));

    const dispatchBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('dispatch') && !b.getAttribute('data-disabled')
    );
    if (dispatchBtn) fireEvent.click(dispatchBtn);

    await waitFor(() => {
      const modal = document.querySelector('[role="dialog"]');
      expect(modal).toBeTruthy();
    });
  });

  it('calls real dispatch when modal is confirmed', async () => {
    mockApi.get.mockResolvedValue(makeAnalytics());
    mockApi.post.mockResolvedValue({ success: true, data: { dispatched: 5 } });
    mockApi.get.mockResolvedValueOnce(makeAnalytics())
              .mockResolvedValueOnce(makeAnalytics());

    const mod = await import('./SmartNudgesAdminPage');
    const SmartNudgesAdminPage = mod.default;
    render(<SmartNudgesAdminPage />);

    await waitFor(() => screen.getAllByTestId('stat-card'));

    // Open modal
    const dispatchBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('dispatch now') || b.textContent?.toLowerCase().includes('dispatch')
    );
    if (dispatchBtn) fireEvent.click(dispatchBtn);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Confirm inside modal — find "dispatch" button inside dialog
    const allBtns = screen.getAllByRole('button');
    const confirmDispatch = allBtns.find((b) =>
      b.textContent?.toLowerCase().includes('dispatch') || b.textContent?.toLowerCase().includes('send')
    );
    if (confirmDispatch) fireEvent.click(confirmDispatch);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/admin/caring-community/nudges/dispatch',
        { dry_run: false }
      );
    });
  });

  it('renders recent nudges table when data present', async () => {
    mockApi.get.mockResolvedValue(makeAnalytics({ recent: [makeNudge()] }));

    const mod = await import('./SmartNudgesAdminPage');
    const SmartNudgesAdminPage = mod.default;
    render(<SmartNudgesAdminPage />);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  it('Dispatch Now button is disabled when engine is disabled', async () => {
    mockApi.get.mockResolvedValue(makeAnalytics({
      config: { enabled: false, min_score: 0.55, cooldown_days: 14, daily_limit: 25 },
    }));

    const mod = await import('./SmartNudgesAdminPage');
    const SmartNudgesAdminPage = mod.default;
    render(<SmartNudgesAdminPage />);

    await waitFor(() => screen.getAllByTestId('stat-card'));

    const dispatchBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('dispatch now')
    );
    // HeroUI disabled buttons carry data-disabled attribute
    if (dispatchBtn) {
      expect(
        dispatchBtn.getAttribute('disabled') !== null ||
        dispatchBtn.getAttribute('data-disabled') !== null
      ).toBe(true);
    }
  });
});
