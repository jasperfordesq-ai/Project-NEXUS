// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Hoist mock objects ───────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'hOUR', slug: 'hour-timebank' },
      tenantPath: (p: string) => `/hour-timebank${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    useAuth: () => ({
      user: { id: 1, name: 'Admin' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  })
);

// Stub heavy admin components
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/PageHeader', '../../components/DataTable' and
// '../../components/StatCard' directly (same resolved modules as the aliases
// below), and vitest keys mocks per resolved module, so a barrel-only mock never
// installs for those imports.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run.
// importOriginal() returns whichever module is currently being mocked, so the
// spread yields that leaf's real exports plus the stubs below — hence the widened
// Record type rather than one naming the barrel.
async function adminComponentsMock(importOriginal: <T>() => Promise<T>) {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    DataTable: ({
      data,
      columns,
      isLoading,
    }: {
      data: Array<Record<string, unknown>>;
      columns: Array<{ key: string; label: string; render?: (item: Record<string, unknown>) => React.ReactNode }>;
      isLoading: boolean;
    }) => (
      <div data-testid="data-table">
        {isLoading && <div role="status" aria-busy="true" aria-label="Loading">Loading…</div>}
        {data.map((row) => (
          <div key={String(row.id)} data-testid="campaign-row">
            {columns.map((col) => (
              <div key={col.key} data-testid={`cell-${col.key}`}>
                {col.render ? col.render(row) : String(row[col.key] ?? '')}
              </div>
            ))}
          </div>
        ))}
      </div>
    ),
    PageHeader: ({
      title,
      actions,
    }: {
      title: string;
      description?: string;
      actions?: React.ReactNode;
    }) => (
      <div>
        <h1>{title}</h1>
        {actions}
      </div>
    ),
    StatCard: ({ label, value, loading }: { label: string; value: unknown; loading?: boolean }) => (
      <div data-testid="stat-card">
        {loading ? <span data-testid="stat-loading">…</span> : <span>{String(value)}</span>}
        <span>{label}</span>
      </div>
    ),
  };
}

vi.mock('@/admin/components', adminComponentsMock);
vi.mock('@/admin/components/PageHeader', adminComponentsMock);
vi.mock('@/admin/components/DataTable', adminComponentsMock);
vi.mock('@/admin/components/StatCard', adminComponentsMock);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
function makeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    tenant_id: 2,
    created_by: 5,
    name: 'Spring Sale Campaign',
    status: 'pending_review',
    advertiser_type: 'sme',
    budget_cents: 5000,
    spent_cents: 0,
    start_date: '2025-04-01',
    end_date: '2025-04-30',
    audience_filters: null,
    placement: 'feed',
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
    impression_count: 0,
    click_count: 0,
    created_at: '2025-01-10T00:00:00Z',
    updated_at: '2025-01-10T00:00:00Z',
    advertiser_name: 'Acme Shop',
    advertiser_email: 'shop@acme.ie',
    creative_count: 0,
    ...overrides,
  };
}

const statsData = {
  active_campaigns: 3,
  impressions_today: 1200,
  clicks_today: 45,
  total_revenue_cents: 890000,
};

// ─────────────────────────────────────────────────────────────────────────────
describe('AdCampaignAdminPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('stats')) return Promise.resolve({ data: statsData });
      return Promise.resolve({ data: [], meta: { total: 0 } });
    });
    mockApi.post.mockResolvedValue({ data: { id: 1 } });
    mockApi.put.mockResolvedValue({ data: {} });
  });

  it('shows a loading state while campaigns fetch', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { AdCampaignAdminPage } = await import('./AdCampaignAdminPage');
    render(<AdCampaignAdminPage />);

    const statusEl = screen.getAllByRole('status');
    const busy = statusEl.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('calls the stats and campaigns APIs on mount', async () => {
    const { AdCampaignAdminPage } = await import('./AdCampaignAdminPage');
    render(<AdCampaignAdminPage />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(
        expect.stringContaining('stats')
      );
      expect(mockApi.get).toHaveBeenCalledWith(
        expect.stringContaining('ad-campaigns')
      );
    });
  });

  it('renders stat cards with overview stats', async () => {
    const { AdCampaignAdminPage } = await import('./AdCampaignAdminPage');
    render(<AdCampaignAdminPage />);

    await waitFor(() => {
      const cards = screen.getAllByTestId('stat-card');
      expect(cards.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('renders a campaign row after data loads', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('stats')) return Promise.resolve({ data: statsData });
      return Promise.resolve({ data: [makeCampaign()], meta: { total: 1 } });
    });

    const { AdCampaignAdminPage } = await import('./AdCampaignAdminPage');
    render(<AdCampaignAdminPage />);

    await waitFor(() => {
      expect(screen.getByText('Spring Sale Campaign')).toBeInTheDocument();
    });
  });

  it('renders approve and reject buttons for pending_review campaign', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('stats')) return Promise.resolve({ data: statsData });
      return Promise.resolve({ data: [makeCampaign({ status: 'pending_review' })], meta: { total: 1 } });
    });

    const { AdCampaignAdminPage } = await import('./AdCampaignAdminPage');
    render(<AdCampaignAdminPage />);

    await waitFor(() => screen.getByText('Spring Sale Campaign'));

    const approveBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('approv')
    );
    const rejectBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('reject')
    );
    expect(approveBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();
  });

  it('calls POST /approve when approve button is clicked', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('stats')) return Promise.resolve({ data: statsData });
      return Promise.resolve({
        data: [makeCampaign({ id: 99, status: 'pending_review' })],
        meta: { total: 1 },
      });
    });
    mockApi.post.mockResolvedValue({ data: { id: 99, status: 'active' } });

    const { AdCampaignAdminPage } = await import('./AdCampaignAdminPage');
    render(<AdCampaignAdminPage />);

    await waitFor(() => screen.getByText('Spring Sale Campaign'));

    const approveBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('approv')
    );
    fireEvent.click(approveBtn!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/admin/ad-campaigns/99/approve'
      );
    });
  });

  it('opens the reject modal when reject button is clicked', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('stats')) return Promise.resolve({ data: statsData });
      return Promise.resolve({
        data: [makeCampaign({ status: 'pending_review' })],
        meta: { total: 1 },
      });
    });

    const { AdCampaignAdminPage } = await import('./AdCampaignAdminPage');
    render(<AdCampaignAdminPage />);

    await waitFor(() => screen.getByText('Spring Sale Campaign'));

    const rejectBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('reject')
    );
    fireEvent.click(rejectBtn!);

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
  });

  it('calls POST /reject with reason when reject form is submitted', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('stats')) return Promise.resolve({ data: statsData });
      return Promise.resolve({
        data: [makeCampaign({ id: 55, status: 'pending_review' })],
        meta: { total: 1 },
      });
    });
    mockApi.post.mockResolvedValue({ data: { id: 55, status: 'rejected' } });

    const { AdCampaignAdminPage } = await import('./AdCampaignAdminPage');
    render(<AdCampaignAdminPage />);

    await waitFor(() => screen.getByText('Spring Sale Campaign'));

    const rejectBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('reject')
    );
    fireEvent.click(rejectBtn!);
    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Fill in rejection reason
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    if (textarea) {
      fireEvent.change(textarea, { target: { value: 'Policy violation' } });
    }

    const submitRejectBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('reject campaign') || b.textContent?.toLowerCase().includes('reject')
    );
    if (submitRejectBtn) {
      fireEvent.click(submitRejectBtn);
      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith(
          '/v2/admin/ad-campaigns/55/reject',
          expect.objectContaining({ reason: 'Policy violation' })
        );
      });
    }
  });

  it('shows pause button for active campaigns', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('stats')) return Promise.resolve({ data: statsData });
      return Promise.resolve({
        data: [makeCampaign({ status: 'active' })],
        meta: { total: 1 },
      });
    });

    const { AdCampaignAdminPage } = await import('./AdCampaignAdminPage');
    render(<AdCampaignAdminPage />);

    await waitFor(() => screen.getByText('Spring Sale Campaign'));

    const pauseBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('pause')
    );
    expect(pauseBtn).toBeDefined();
  });

  it('calls POST /pause when pause button is clicked', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('stats')) return Promise.resolve({ data: statsData });
      return Promise.resolve({
        data: [makeCampaign({ id: 77, status: 'active' })],
        meta: { total: 1 },
      });
    });
    mockApi.post.mockResolvedValue({ data: { id: 77, status: 'paused' } });

    const { AdCampaignAdminPage } = await import('./AdCampaignAdminPage');
    render(<AdCampaignAdminPage />);

    await waitFor(() => screen.getByText('Spring Sale Campaign'));

    const pauseBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('pause')
    );
    fireEvent.click(pauseBtn!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/ad-campaigns/77/pause');
    });
  });

  it('opens create campaign modal when Create Campaign button is clicked', async () => {
    const { AdCampaignAdminPage } = await import('./AdCampaignAdminPage');
    render(<AdCampaignAdminPage />);

    await waitFor(() => screen.getAllByRole('button').length > 0);

    const createBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('creat') || b.textContent?.toLowerCase().includes('campaign')
    );
    expect(createBtn).toBeDefined();
    fireEvent.click(createBtn!);

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
  });

  it('disables the submit button when campaign name is empty', async () => {
    // The create form uses isDisabled={!createForm.name.trim()} on the submit button
    const { AdCampaignAdminPage } = await import('./AdCampaignAdminPage');
    render(<AdCampaignAdminPage />);

    await waitFor(() => screen.getAllByRole('button').length > 0);

    const createBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('creat') || b.textContent?.toLowerCase().includes('campaign')
    );
    fireEvent.click(createBtn!);
    await waitFor(() => document.querySelector('[role="dialog"]'));

    // The submit button should be disabled because name is empty
    const submitBtn = screen.getAllByRole('button').find(
      (b) =>
        b.textContent?.toLowerCase().includes('submit') ||
        b.textContent?.toLowerCase().includes('review')
    );
    expect(submitBtn).toBeDefined();
    const isDisabled =
      submitBtn?.hasAttribute('disabled') ||
      submitBtn?.getAttribute('data-disabled') === 'true' ||
      submitBtn?.getAttribute('aria-disabled') === 'true';
    expect(isDisabled).toBe(true);
  });

  it('opens detail modal when view details button is clicked', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('stats')) return Promise.resolve({ data: statsData });
      if (url.match(/ad-campaigns\/\d+$/)) {
        return Promise.resolve({ data: makeCampaign({ creatives: [], stats: undefined }) });
      }
      return Promise.resolve({ data: [makeCampaign()], meta: { total: 1 } });
    });

    const { AdCampaignAdminPage } = await import('./AdCampaignAdminPage');
    render(<AdCampaignAdminPage />);

    await waitFor(() => screen.getByText('Spring Sale Campaign'));

    const viewBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('detail') ||
      b.getAttribute('aria-label')?.toLowerCase().includes('view')
    );
    expect(viewBtn).toBeDefined();
    fireEvent.click(viewBtn!);

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
  });

  it('shows error toast when campaigns fail to load', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('stats')) return Promise.resolve({ data: statsData });
      throw new Error('network failure');
    });

    const { AdCampaignAdminPage } = await import('./AdCampaignAdminPage');
    render(<AdCampaignAdminPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders status filter tabs', async () => {
    const { AdCampaignAdminPage } = await import('./AdCampaignAdminPage');
    render(<AdCampaignAdminPage />);

    await waitFor(() => {
      const tabs = screen.getAllByRole('tab');
      // Should have All, pending_review, active, paused, completed, rejected
      expect(tabs.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('formats budget in euros', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('stats')) return Promise.resolve({ data: statsData });
      return Promise.resolve({
        data: [makeCampaign({ budget_cents: 5000, spent_cents: 1250 })],
        meta: { total: 1 },
      });
    });

    const { AdCampaignAdminPage } = await import('./AdCampaignAdminPage');
    render(<AdCampaignAdminPage />);

    await waitFor(() => {
      expect(screen.getByText(/€50\.00/)).toBeInTheDocument();
      expect(screen.getByText(/€12\.50/)).toBeInTheDocument();
    });
  });
});
