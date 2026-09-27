// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── stable mock refs ──────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test', currency: 'GBP' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

// Mock admin sub-components that reference their own contexts
vi.mock('../../components', () => ({
  StatCard: ({ label, value }: { label: string; value: number }) => (
    <div data-testid="stat-card">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
  PageHeader: ({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
      {actions}
    </div>
  ),
}));

import { api } from '@/lib/api';
import { MarketplaceAdmin } from './MarketplaceAdmin';

const mockStats = {
  total_listings: 42,
  active_listings: 30,
  total_sellers: 10,
  pending_moderation: 5,
  total_orders: 100,
  revenue: 2500,
  currency: 'GBP',
  revenue_by_currency: [{ currency: 'GBP', total: 2500 }],
};

const mockListings = [
  {
    id: 1,
    title: 'Test Listing',
    price: 9.99,
    price_currency: 'GBP',
    price_type: 'fixed',
    status: 'active',
    moderation_status: 'approved',
    seller_type: 'individual',
    views_count: 50,
    image: null,
    category: 'books',
    user: { id: 7, name: 'Alice' },
    created_at: '2025-01-15T10:00:00Z',
  },
];

describe('MarketplaceAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading spinner while fetching', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<MarketplaceAdmin />);
    // Loading state: the aria-busy div is present
    const statusEls = screen.queryAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders stats cards after successful load', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: mockStats })
      .mockResolvedValueOnce({ success: true, data: mockListings });

    render(<MarketplaceAdmin />);

    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText('30')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
    });

    // Loading spinner should be gone after data loaded
    const statusEls = screen.queryAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeUndefined();
  });

  it('renders empty state when no listings', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: mockStats })
      .mockResolvedValueOnce({ success: true, data: [] });

    render(<MarketplaceAdmin />);

    await waitFor(() => {
      // Loading spinner gone
      const statusEls = screen.queryAllByRole('status');
      const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });
  });

  it('shows error toast on load failure', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));

    render(<MarketplaceAdmin />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders listings from the paginated shape (rows in data, pagination in meta)', async () => {
    // Mirrors what the shared api client (src/lib/api.ts) really resolves with for
    // this paginated endpoint: `data` is the bare row array and pagination lives on
    // the sibling `meta`. An earlier fixture nested the rows inside `data`, a shape
    // the client never produces.
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: mockStats })
      .mockResolvedValueOnce({ success: true, data: mockListings, meta: { current_page: 1, per_page: 10, total: 1, total_pages: 1, has_more: false } });

    render(<MarketplaceAdmin />);

    await waitFor(() => {
      expect(screen.getByText('Test Listing')).toBeInTheDocument();
    });
  });

  it('re-fetches on Refresh button click', async () => {
    vi.mocked(api.get)
      .mockResolvedValue({ success: true, data: mockStats });
    // Second call pair for listings
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: mockStats })
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: mockStats })
      .mockResolvedValueOnce({ success: true, data: mockListings });

    render(<MarketplaceAdmin />);

    await waitFor(() => {
      const statusEls = screen.queryAllByRole('status');
      const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });

    const user = userEvent.setup();
    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    await user.click(refreshBtn);

    // api.get should have been called again
    await waitFor(() => {
      expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('renders moderation and sellers navigation links', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: mockStats })
      .mockResolvedValueOnce({ success: true, data: [] });

    render(<MarketplaceAdmin />);

    await waitFor(() => {
      const statusEls = screen.queryAllByRole('status');
      const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });

    // Quick action cards rendered as links
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
  });

  it('shows table grid when listings data is loaded', async () => {
    const listings = [
      { ...mockListings[0], id: 1, moderation_status: 'approved', status: 'active' },
      { ...mockListings[0], id: 2, title: 'Pending', moderation_status: 'pending', status: 'inactive' },
      { ...mockListings[0], id: 3, title: 'Rejected', moderation_status: 'rejected', status: 'active' },
    ];
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: mockStats })
      .mockResolvedValueOnce({ success: true, data: listings });

    render(<MarketplaceAdmin />);

    await waitFor(() => {
      // React Aria Table renders as role=grid
      expect(screen.getByRole('grid')).toBeInTheDocument();
    });
  });
});
