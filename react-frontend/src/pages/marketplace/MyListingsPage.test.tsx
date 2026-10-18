// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Hoist mock api ───────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/safeStorage', () => ({
  safeLocalStorageGet: vi.fn(() => null),
  safeLocalStorageSet: vi.fn(),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Toast + auth ─────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 5, name: 'Seller User' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/components/feedback', () => ({
  EmptyState: ({
    title,
    action,
  }: {
    icon?: React.ReactNode;
    title: string;
    description?: string;
    action?: { label: string; onClick: () => void };
  }) => (
    <div data-testid="empty-state">
      {title}
      {action && <button onClick={action.onClick}>{action.label}</button>}
    </div>
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeListing = (overrides = {}) => ({
  id: 1,
  title: 'My Cool Item',
  price: 10,
  price_currency: 'EUR',
  views_count: 42,
  status: 'active',
  image: null,
  inventory_count: null,
  low_stock_threshold: null,
  is_own: true,
  ...overrides,
});

const makeListingsResponse = (data: object[] = [], meta = {}) => ({
  success: true,
  data,
  meta: { has_more: false, cursor: null, next_cursor: null, ...meta },
});

const makeStatsResponse = () => ({
  success: true,
  data: {
    active_listings: 3,
    draft_listings: 1,
    sold_listings: 2,
    expired_listings: 0,
    total_views: 100,
    total_revenue: 50,
    revenue_currency: 'EUR',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
describe('MyListingsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: stats + listings + onboarding
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/seller/dashboard')) return Promise.resolve(makeStatsResponse());
      if (url.includes('/merchant-onboarding')) return Promise.resolve({ success: true, data: { onboarding_completed: true } });
      return Promise.resolve(makeListingsResponse());
    });
    mockApi.delete.mockResolvedValue({ success: true });
    mockApi.post.mockResolvedValue({ success: true });
  });

  it('shows a loading spinner while listings are being fetched', async () => {
    // Make the listings call pend
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/seller/dashboard')) return Promise.resolve(makeStatsResponse());
      if (url.includes('/merchant-onboarding')) return Promise.resolve({ success: true, data: { onboarding_completed: true } });
      return new Promise(() => {});
    });

    const { MyListingsPage } = await import('./MyListingsPage');
    render(<MyListingsPage />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders empty state when no listings returned for active tab', async () => {
    const { MyListingsPage } = await import('./MyListingsPage');
    render(<MyListingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders listing cards when listings are returned', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/seller/dashboard')) return Promise.resolve(makeStatsResponse());
      if (url.includes('/merchant-onboarding')) return Promise.resolve({ success: true, data: { onboarding_completed: true } });
      return Promise.resolve(makeListingsResponse([makeListing()]));
    });

    const { MyListingsPage } = await import('./MyListingsPage');
    render(<MyListingsPage />);

    await waitFor(() => {
      expect(screen.getByText('My Cool Item')).toBeInTheDocument();
    });
  });

  it('renders seller dashboard stats when loaded', async () => {
    const { MyListingsPage } = await import('./MyListingsPage');
    render(<MyListingsPage />);

    await waitFor(() => {
      // Stats cards render numbers from the stats response
      expect(screen.getByText('3')).toBeInTheDocument(); // active_listings
    });
  });

  it('shows error toast when listings fetch fails', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/seller/dashboard')) return Promise.resolve(makeStatsResponse());
      if (url.includes('/merchant-onboarding')) return Promise.resolve({ success: true, data: { onboarding_completed: true } });
      return Promise.reject(new Error('network'));
    });

    const { MyListingsPage } = await import('./MyListingsPage');
    render(<MyListingsPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders the Create Listing button', async () => {
    const { MyListingsPage } = await import('./MyListingsPage');
    render(<MyListingsPage />);

    await waitFor(() => screen.getByTestId('empty-state'));

    // i18n resolves hub.sell_something → "Create Listing" (rendered as <a> link)
    const sellBtn = screen.getAllByRole('link').find((el) =>
      el.textContent?.includes('Create Listing')
    );
    expect(sellBtn).toBeDefined();
  });

  it('opens remove confirm modal when remove button is clicked', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/seller/dashboard')) return Promise.resolve(makeStatsResponse());
      if (url.includes('/merchant-onboarding')) return Promise.resolve({ success: true, data: { onboarding_completed: true } });
      return Promise.resolve(makeListingsResponse([makeListing({ id: 77 })]));
    });

    const { MyListingsPage } = await import('./MyListingsPage');
    render(<MyListingsPage />);

    await waitFor(() => screen.getByText('My Cool Item'));

    // Remove button is icon-only with aria-label "Remove" (i18n resolves my_listings.action_remove → "Remove")
    const removeBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label') === 'Remove'
    );
    expect(removeBtn).toBeDefined();
    if (removeBtn) fireEvent.click(removeBtn);

    await waitFor(() => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      expect(dialogs.length).toBeGreaterThan(0);
    });
  });

  it('calls DELETE endpoint and removes listing on confirm remove', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/seller/dashboard')) return Promise.resolve(makeStatsResponse());
      if (url.includes('/merchant-onboarding')) return Promise.resolve({ success: true, data: { onboarding_completed: true } });
      return Promise.resolve(makeListingsResponse([makeListing({ id: 77 })]));
    });

    const { MyListingsPage } = await import('./MyListingsPage');
    render(<MyListingsPage />);

    await waitFor(() => screen.getByText('My Cool Item'));

    // Open remove confirm modal via icon button with aria-label "Remove"
    const removeBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label') === 'Remove'
    );
    if (removeBtn) fireEvent.click(removeBtn);

    // Wait for modal to appear
    await waitFor(() => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      expect(dialogs.length).toBeGreaterThan(0);
    });

    // Click the danger confirm "Remove" button in the modal footer
    // i18n resolves my_listings.action_remove → "Remove"
    const allRemoveBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.trim() === 'Remove'
    );
    // The last "Remove" button is the danger confirm one in the modal footer
    const confirmRemoveBtn = allRemoveBtns[allRemoveBtns.length - 1];
    if (confirmRemoveBtn) {
      fireEvent.click(confirmRemoveBtn);
      await waitFor(() => {
        expect(mockApi.delete).toHaveBeenCalledWith('/v2/marketplace/listings/77');
        expect(mockToast.success).toHaveBeenCalled();
      });
    }
  });

  it('shows Load More button when has_more is true', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/seller/dashboard')) return Promise.resolve(makeStatsResponse());
      if (url.includes('/merchant-onboarding')) return Promise.resolve({ success: true, data: { onboarding_completed: true } });
      return Promise.resolve(makeListingsResponse([makeListing()], { has_more: true }));
    });

    const { MyListingsPage } = await import('./MyListingsPage');
    render(<MyListingsPage />);

    await waitFor(() => screen.getByText('My Cool Item'));

    // i18n resolves common.load_more → "Load More"
    const loadMoreBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Load More')
    );
    expect(loadMoreBtn).toBeDefined();
  });

  it('renders listing price correctly', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/seller/dashboard')) return Promise.resolve(makeStatsResponse());
      if (url.includes('/merchant-onboarding')) return Promise.resolve({ success: true, data: { onboarding_completed: true } });
      return Promise.resolve(makeListingsResponse([makeListing({ price: 0, price_currency: 'EUR' })]));
    });

    const { MyListingsPage } = await import('./MyListingsPage');
    render(<MyListingsPage />);

    await waitFor(() => screen.getByText('My Cool Item'));
    // Free listing: i18n resolves common.free → "Free"
    expect(screen.getByText('Free')).toBeInTheDocument();
  });
});
