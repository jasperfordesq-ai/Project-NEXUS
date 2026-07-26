// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── viewport toggle ─────────────────────────────────────────────────────────
// src/test/setup.ts stubs window.matchMedia to answer `matches: false` for every
// query, so without this the phone branch would get zero coverage. Deliberately a
// plain function, NOT vi.fn: the suite's beforeEach calls vi.resetAllMocks(),
// which would strip a vi.fn implementation and make useMediaQuery return
// undefined. Query-aware so a min-width consumer can never see an impossible
// viewport (both a phone AND a desktop at once).
let isPhoneViewport = false;
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: (query: string) => (query.includes('min-width') ? !isPhoneViewport : isPhoneViewport),
}));

// ─── hoisted mock data ────────────────────────────────────────────────────────
const { mockHasFeature } = vi.hoisted(() => ({
  mockHasFeature: vi.fn(() => true),
}));

// ─── api mock ─────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Toast / Auth / Tenant ───────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Alice' },
      isAuthenticated: true,
      login: vi.fn(), logout: vi.fn(), register: vi.fn(),
      updateUser: vi.fn(), refreshUser: vi.fn(),
      status: 'idle' as const, error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: mockHasFeature,
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/AuthContext')>();
  return { ...actual, useAuth: () => ({ user: { id: 1, name: 'Alice' }, isAuthenticated: true }) };
});
vi.mock('@/contexts/ToastContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/ToastContext')>();
  return { ...actual, useToast: () => mockToast };
});
vi.mock('@/contexts/TenantContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/TenantContext')>();
  return {
    ...actual,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (path: string) => `/test${path}`,
      hasFeature: mockHasFeature,
      hasModule: vi.fn(() => true),
    }),
  };
});

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub heavy marketplace sub-components ────────────────────────────────────
vi.mock('@/components/marketplace', () => ({
  MarketplaceListingGrid: ({ listings }: { listings: object[] }) => (
    <div data-testid="listing-grid">
      {(listings as Array<{ id: number; title: string }>).map((l) => (
        <div key={l.id} data-testid="listing-card">{l.title}</div>
      ))}
    </div>
  ),
  MarketplaceListingGridSkeleton: () => (
    <div data-testid="listing-skeleton" role="status" aria-busy="true" aria-label="loading" />
  ),
  CategoryChips: ({ categories }: { categories: object[] }) => (
    <div data-testid="category-chips">
      {(categories as Array<{ id: number; name: string }>).map((c) => (
        <button key={c.id}>{c.name}</button>
      ))}
    </div>
  ),
}));

vi.mock('@/components/marketplace/MarketplaceListingGrid', () => ({
  MarketplaceListingGrid: ({ listings }: { listings: object[] }) => (
    <div data-testid="listing-grid">
      {(listings as Array<{ id: number; title: string }>).map((listing) => (
        <div key={listing.id} data-testid="listing-card">{listing.title}</div>
      ))}
    </div>
  ),
}));
vi.mock('@/components/marketplace/MarketplaceListingGridSkeleton', () => ({
  MarketplaceListingGridSkeleton: () => (
    <div data-testid="listing-skeleton" role="status" aria-busy="true" aria-label="loading" />
  ),
}));
vi.mock('@/components/marketplace/CategoryChips', () => ({
  CategoryChips: ({ categories }: { categories: object[] }) => (
    <div data-testid="category-chips">
      {(categories as Array<{ id: number; name: string }>).map((category) => (
        <button key={category.id}>{category.name}</button>
      ))}
    </div>
  ),
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));
vi.mock('@/components/feedback/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('@/components/public/PublicPageHero', () => ({
  PublicPageHero: ({ title }: { title: string }) => <div data-testid="hero">{title}</div>,
}));

vi.mock('@/components/seo/PageMeta', () => ({
  PageMeta: () => null,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────
const LISTING = {
  id: 1,
  title: 'Handmade Candle',
  price: 10,
  currency: 'EUR',
  is_saved: false,
  status: 'active',
  seller: { id: 5, name: 'Carol' },
  image: null,
};

const CATEGORY = { id: 3, name: 'Crafts', slug: 'crafts', icon: null, listing_count: 5 };

const listingsOk = { success: true, data: [LISTING], meta: { has_more: false } };
const categoriesOk = { success: true, data: [CATEGORY] };
const featuredOk = { success: true, data: [] };

// ─────────────────────────────────────────────────────────────────────────────
describe('MarketplacePage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    isPhoneViewport = false;
    mockHasFeature.mockReturnValue(true);

    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('categories')) return Promise.resolve(categoriesOk);
      if (url.includes('featured')) return Promise.resolve(featuredOk);
      return Promise.resolve(listingsOk);
    });
  });

  it('shows loading skeleton on initial render', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('categories')) return Promise.resolve(categoriesOk);
      if (url.includes('featured')) return Promise.resolve(featuredOk);
      // Slow down the main listings request
      return new Promise(() => {});
    });

    const { MarketplacePage } = await import('./MarketplacePage');
    render(<MarketplacePage />);

    const skeletons = screen.queryAllByTestId('listing-skeleton');
    const statuses = screen.queryAllByRole('status').filter(
      (el) => el.getAttribute('aria-busy') === 'true'
    );
    expect(skeletons.length > 0 || statuses.length > 0).toBe(true);
  });

  it('renders listing cards after data loads', async () => {
    const { MarketplacePage } = await import('./MarketplacePage');
    render(<MarketplacePage />);

    await waitFor(() => {
      expect(screen.getByText('Handmade Candle')).toBeInTheDocument();
    });
  });

  it('renders category chips when categories are loaded', async () => {
    const { MarketplacePage } = await import('./MarketplacePage');
    render(<MarketplacePage />);

    await waitFor(() => {
      expect(screen.getByTestId('category-chips')).toBeInTheDocument();
      expect(screen.getByText('Crafts')).toBeInTheDocument();
    });
  });

  it('shows empty state when no listings are returned', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('categories')) return Promise.resolve(categoriesOk);
      if (url.includes('featured')) return Promise.resolve(featuredOk);
      return Promise.resolve({ success: true, data: [], meta: { has_more: false } });
    });

    const { MarketplacePage } = await import('./MarketplacePage');
    render(<MarketplacePage />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders error state when API call fails', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('categories')) return Promise.resolve(categoriesOk);
      if (url.includes('featured')) return Promise.resolve(featuredOk);
      return Promise.reject(new Error('network error'));
    });

    const { MarketplacePage } = await import('./MarketplacePage');
    render(<MarketplacePage />);

    await waitFor(() => {
      const alerts = screen.queryAllByRole('alert');
      expect(alerts.length).toBeGreaterThan(0);
    });
  });

  it('shows feature gate empty state when marketplace feature is disabled', async () => {
    mockHasFeature.mockReturnValue(false);

    const { MarketplacePage } = await import('./MarketplacePage');
    render(<MarketplacePage />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });

    // API shouldn't be called when feature is gated
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  it('shows load more button when has_more is true', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('categories')) return Promise.resolve(categoriesOk);
      if (url.includes('featured')) return Promise.resolve(featuredOk);
      return Promise.resolve({ success: true, data: [LISTING], meta: { has_more: true } });
    });

    const { MarketplacePage } = await import('./MarketplacePage');
    render(<MarketplacePage />);

    await waitFor(() => {
      const loadMore = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('more') || b.textContent?.toLowerCase().includes('load')
      );
      expect(loadMore).toBeInTheDocument();
    });
  });

  it('renders hero section', async () => {
    const { MarketplacePage } = await import('./MarketplacePage');
    render(<MarketplacePage />);

    await waitFor(() => {
      expect(screen.getByTestId('hero')).toBeInTheDocument();
    });
  });

  it('shows sell something button for authenticated users', async () => {
    const { MarketplacePage } = await import('./MarketplacePage');
    render(<MarketplacePage />);

    await waitFor(() => screen.getByText('Handmade Candle'));

    const sellBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('sell')
    );
    // authenticated user -> sell button should appear (sidebar or hero)
    // Link rendered as button or anchor
    const sellLink = document.querySelector('[href*="sell"]');
    const hasSellerAction = sellBtn !== undefined || sellLink !== null;
    expect(hasSellerAction).toBe(true);
  });

  describe('phone layout', () => {
    beforeEach(() => {
      isPhoneViewport = true;
    });

    it('renders the sticky control bar instead of the desktop hero, search field and category row', async () => {
      const { MarketplacePage } = await import('./MarketplacePage');
      render(<MarketplacePage />);

      await waitFor(() => {
        expect(screen.getByTestId('marketplace-mobile-controls')).toBeInTheDocument();
      });

      // Sticky bar: search pill + Filters button.
      expect(screen.getByLabelText('More filters')).toBeInTheDocument();
      expect(screen.getByText('Search marketplace...')).toBeInTheDocument();

      // Desktop chrome is gone (the pill's label is a span, not a placeholder).
      expect(screen.queryByTestId('hero')).not.toBeInTheDocument();
      expect(screen.queryByTestId('category-chips')).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Search marketplace...')).not.toBeInTheDocument();
    });

    it('keeps the hero-only Sell action and the lg-only quick links reachable', async () => {
      const { MarketplacePage } = await import('./MarketplacePage');
      render(<MarketplacePage />);

      await waitFor(() => {
        expect(screen.getByTestId('marketplace-mobile-controls')).toBeInTheDocument();
      });

      // Re-homed from the hero's action slot into the sticky bar's trailing slot.
      expect(screen.getByLabelText('Sell Something')).toHaveAttribute('href', '/test/marketplace/sell');

      // Re-homed from the `hidden lg:block` sidebar.
      const quickLinks = screen.getByRole('navigation', { name: 'Quick Links' });
      expect(within(quickLinks).getByText('Advanced Search')).toBeInTheDocument();
      expect(within(quickLinks).getByText('My Orders')).toBeInTheDocument();
      expect(within(quickLinks).getByText('Saved Items')).toBeInTheDocument();
    });

    it('opens the filter sheet with the category chip group', async () => {
      const { MarketplacePage } = await import('./MarketplacePage');
      render(<MarketplacePage />);

      await waitFor(() => {
        expect(screen.getByLabelText('More filters')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByLabelText('More filters'));

      // Real HeroUI single-select ToggleButtonGroup ⇒ radiogroup / radio.
      const group = await waitFor(() => screen.getByRole('radiogroup', { name: 'Filter by category' }));
      expect(within(group).getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
      expect(within(group).getByRole('radio', { name: 'Crafts' })).toBeInTheDocument();
    });

    it('applies a category immediately on tap and shows it as a removable chip', async () => {
      const { MarketplacePage } = await import('./MarketplacePage');
      render(<MarketplacePage />);

      await waitFor(() => {
        expect(mockApi.get).toHaveBeenCalledWith(expect.stringMatching(/^\/v2\/marketplace\/listings\?/));
      });
      mockApi.get.mockClear();

      fireEvent.click(screen.getByLabelText('More filters'));
      const crafts = await waitFor(() => screen.getByRole('radio', { name: 'Crafts' }));

      // Simple archetype: no draft, no apply footer — the tap refetches at once.
      fireEvent.click(crafts);
      await waitFor(() => {
        expect(mockApi.get).toHaveBeenCalledWith(expect.stringContaining('category_id=3'));
      });

      await waitFor(() => {
        expect(screen.getByLabelText('Remove filter: Crafts')).toBeInTheDocument();
      });
      expect(screen.queryByText('Show results')).not.toBeInTheDocument();
    });
  });
});
