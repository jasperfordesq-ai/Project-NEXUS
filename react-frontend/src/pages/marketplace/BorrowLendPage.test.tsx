// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Stable mock references ────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const mockTenantPath = (p: string) => `/test${p}`;
const mockHasFeature = vi.fn((f: string) => f === 'marketplace');
const mockNavigate = vi.fn();

const MOCK_AUTH_AUTHED = {
  user: { id: 1, name: 'Alice' }, isAuthenticated: true,
  login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(),
  refreshUser: vi.fn(), status: 'idle' as const, error: null,
};

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return { ...orig, useNavigate: () => mockNavigate };
});

// Default: authenticated, marketplace feature on
vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => MOCK_AUTH_AUTHED,
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: mockTenantPath,
      hasFeature: mockHasFeature,
      hasModule: vi.fn(() => true),
    }),
  }),
);

// Stub heavy sub-components
vi.mock('@/components/marketplace', () => ({
  MarketplaceListingGrid: ({ listings }: { listings: unknown[] }) => (
    <div data-testid="listing-grid">{listings.length} items</div>
  ),
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, action }: { title: string; action?: { label: string; onClick: () => void } }) => (
    <div data-testid="empty-state">
      {title}
      {action && <button type="button" onClick={action.onClick}>{action.label}</button>}
    </div>
  ),
}));

vi.mock('@/components/seo/PageMeta', () => ({
  PageMeta: () => null,
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

import { api } from '@/lib/api';
import { BorrowLendPage } from './BorrowLendPage';

const LEND_LISTING = {
  id: 10, title: 'Cordless Drill', price: null, price_currency: 'EUR', price_type: 'lend' as const,
  loan_terms: 'Back within a week please', condition: 'good' as const, delivery_method: 'pickup',
  seller_type: 'private', status: 'active', image: null, image_count: 0, is_saved: false,
  is_own: false, is_promoted: false, views_count: 0, created_at: '2026-01-01',
};

describe('BorrowLendPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasFeature.mockImplementation((f: string) => f === 'marketplace');
  });

  it('shows a loading spinner initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<BorrowLendPage />);
    expect(screen.getAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true')).toBeInTheDocument();
  });

  it('renders the listing grid on successful load', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [LEND_LISTING],
      meta: { per_page: 24, has_more: false, cursor: null },
    });
    render(<BorrowLendPage />);
    await waitFor(() => {
      expect(screen.getByTestId('listing-grid')).toBeInTheDocument();
    });
    expect(screen.getByText('1 items')).toBeInTheDocument();
  });

  it('shows feature-gate empty state when marketplace feature is off', () => {
    mockHasFeature.mockImplementation(() => false);
    render(<BorrowLendPage />);
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });

  it('shows error UI when API call fails', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('network'));
    render(<BorrowLendPage />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows empty state when API returns 0 items', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { per_page: 24, has_more: false, cursor: null },
    });
    render(<BorrowLendPage />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('calls api.get with price_type=lend', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { per_page: 24, has_more: false },
    });
    render(<BorrowLendPage />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('price_type=lend'),
      );
    });
  });

  it('shows the "Lend something" CTA for authenticated users', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [LEND_LISTING],
      meta: { per_page: 24, has_more: false },
    });
    render(<BorrowLendPage />);
    await waitFor(() => {
      expect(screen.getByTestId('listing-grid')).toBeInTheDocument();
    });
    expect(screen.getAllByText(/lend something/i).length).toBeGreaterThan(0);
  });

  it('routes the empty-state action through the router (no full-page reload)', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { per_page: 24, has_more: false },
    });
    render(<BorrowLendPage />);
    const action = await screen.findByRole('button', { name: /lend something/i });
    fireEvent.click(action);
    expect(mockNavigate).toHaveBeenCalledWith('/test/marketplace/sell');
  });

  it('shows "Load more" button when has_more=true', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: Array.from({ length: 24 }, (_, i) => ({ ...LEND_LISTING, id: i + 1 })),
      meta: { per_page: 24, has_more: true, cursor: 'next-cursor' },
    });
    render(<BorrowLendPage />);
    await waitFor(() => {
      expect(screen.getByTestId('listing-grid')).toBeInTheDocument();
    });
    const loadMoreBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.match(/load.more|load_more/i),
    );
    expect(loadMoreBtn).toBeDefined();
  });

  it('calls api.get again when "Try again" is clicked in the error state', async () => {
    vi.mocked(api.get)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ success: true, data: [], meta: { per_page: 24, has_more: false } });

    render(<BorrowLendPage />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    const retryBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.match(/try.again|retry/i),
    );
    expect(retryBtn).toBeDefined();
    fireEvent.click(retryBtn!);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(2);
    });
  });
});
