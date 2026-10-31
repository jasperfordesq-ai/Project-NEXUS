// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi, stableTenantPath, stableT, tenantGates } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
  // Stable function references — prevents effect re-runs from identity churn
  stableTenantPath: (p: string) => `/test${p}`,
  stableT: (key: string) => key,
  // Tenant gates the page reads. Everything is on by default; a test flips
  // `messaging` off to exercise the no-messaging branch.
  tenantGates: { messaging: true },
}));

const gateAnswer = (key: string): boolean =>
  key === 'messages' || key === 'direct_messaging' ? tenantGates.messaging : true;

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Stable i18n — prevents t() reference churn in useEffect deps ────────────
vi.mock('react-i18next', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-i18next')>();
  return {
    ...orig,
    useTranslation: () => ({
      t: stableT,
      i18n: { changeLanguage: vi.fn(), language: 'en' },
    }),
    Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

// ─── Toast / Auth / Tenant ───────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: '55' }),
  };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 10, name: 'Logged User' },
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
      tenantPath: stableTenantPath,
      hasFeature: vi.fn(gateAnswer),
      hasModule: vi.fn(gateAnswer),
      branding: { name: 'Test Platform' },
    }),
  })
);

vi.mock('@/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/AuthContext')>();
  return { ...actual, useAuth: () => ({
    user: { id: 10, name: 'Logged User' },
    isAuthenticated: true,
  }) };
});
vi.mock('@/contexts/ToastContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/ToastContext')>();
  return { ...actual, useToast: () => mockToast };
});
// 🔴 Both gates are required even when nothing in this file reads them: shared
// components (Breadcrumbs, headers, menus) ask the tenant context whether a
// destination is enabled, and a partial mock makes that call throw during render.
// Granting everything keeps these cases about their own subject.
vi.mock('@/contexts/TenantContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/TenantContext')>();
  return { ...actual, useTenant: () => ({
    hasFeature: vi.fn(gateAnswer),
    hasModule: vi.fn(gateAnswer),
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantPath: stableTenantPath,
    branding: { name: 'Test Platform' },
  }) };
});

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">{title}{description && <p>{description}</p>}</div>
  ),
}));

// Stub marketplace child components
vi.mock('@/components/marketplace', () => ({
  BuyNowButton: ({ listingTitle, paymentMethod }: { listingTitle?: string; paymentMethod?: string }) => (
    <button data-testid="buy-now-btn" data-payment-method={paymentMethod}>Buy Now: {listingTitle}</button>
  ),
  LoyaltyRedemptionCard: () => <div data-testid="loyalty-card" />,
  MarketplaceListingDetailSkeleton: () => <div data-testid="listing-skeleton" />,
}));

vi.mock('@/components/marketplace/BuyNowButton', () => ({
  BuyNowButton: ({ listingTitle, paymentMethod }: { listingTitle?: string; paymentMethod?: string }) => (
    <button data-testid="buy-now-btn" data-payment-method={paymentMethod}>Buy Now: {listingTitle}</button>
  ),
}));
vi.mock('@/components/marketplace/LoyaltyRedemptionCard', () => ({
  LoyaltyRedemptionCard: () => <div data-testid="loyalty-card" />,
}));
vi.mock('@/components/marketplace/MarketplaceListingDetailSkeleton', () => ({
  MarketplaceListingDetailSkeleton: () => <div data-testid="listing-skeleton" />,
}));
vi.mock('@/components/marketplace/ShippingSelector', () => ({
  ShippingSelector: () => <div data-testid="shipping-selector" />,
}));

// Stub verification badge
vi.mock('@/components/verification/VerificationBadge', () => ({
  VerificationBadgeRow: () => <div data-testid="verification-badges" />,
}));

// Stub Helmet — must include HelmetProvider because test-utils wraps with it
vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  HelmetProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// Stub motion lib
vi.mock('@/lib/motion', () => ({
  motion: {
    img: ({ src, alt, className }: { src?: string; alt?: string; className?: string }) => (
      <img src={src} alt={alt} className={className} />
    ),
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// Stub HeroUI Modal to avoid portal issues; stub Select to avoid loops
// MarketplaceListingPage imports its Modal parts from '@/components/ui/Modal', so registering them
// on the barrel alone left them dead and the real HeroUI Modal (portal included) was what rendered
// — the thing this block exists to avoid. Hoisted so the barrel factory and the direct path share
// one definition; the stubs are prop-driven, so sharing is safe.
const modalStub = vi.hoisted(() => ({
  Modal: ({ isOpen, children, onOpenChange }: {
    isOpen?: boolean;
    children?: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) =>
    isOpen ? <div role="dialog" aria-label="Dialog">{typeof children === 'function' ? (children as (close: () => void) => React.ReactNode)(() => onOpenChange?.(false)) : children}</div> : null,
  ModalContent: ({ children }: { children?: React.ReactNode | ((onClose: () => void) => React.ReactNode) }) => (
    <div>{typeof children === 'function' ? (children as (onClose: () => void) => React.ReactNode)(() => {}) : children}</div>
  ),
  ModalHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ModalBody: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  ModalFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/Modal', () => modalStub);

vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    // useDisclosure is deliberately NOT overridden. The page imports it from
    // '@/components/ui/useDisclosure', so the always-closed stub that used to sit here was dead and
    // the real hook has always been what ran. Re-registering it on the direct path would make
    // onOpen a no-op and wedge every dialog shut — live but wrong, which is worse than dead.
    ...modalStub,
  };
});

// ─── Fixtures ────────────────────────────────────────────────────────────────
const { makeListing, makeSellerListings } = vi.hoisted(() => ({
  makeListing: (overrides: Partial<{
    id: number;
    title: string;
    description: string;
    price: number | null;
    price_type: string;
    price_currency: string;
    time_credit_price: number | null;
    loan_terms: string | null;
    condition: string;
    is_own: boolean;
    is_saved: boolean;
    status: string;
    user: unknown;
    images: unknown[];
    seller_type: string;
    delivery_method: string;
    template_data: Record<string, unknown> | null;
  }> = {}) => ({
    id: 55,
    title: 'Cosy Armchair',
    description: 'A wonderfully comfortable armchair, perfect for reading.',
    tagline: 'Great chair',
    price: 50,
    price_currency: 'EUR',
    price_type: 'fixed',
    time_credit_price: null,
    condition: 'good',
    quantity: 1,
    category: { id: 5, name: 'Furniture', slug: 'furniture', icon: null },
    location: 'Cork',
    latitude: 51.898,
    longitude: -8.476,
    shipping_available: false,
    local_pickup: true,
    delivery_method: 'pickup',
    seller_type: 'individual',
    images: [
      { id: 1, url: 'https://example.com/chair.jpg', thumbnail_url: 'https://example.com/chair-thumb.jpg', alt_text: 'Armchair', is_primary: true },
    ],
    video_url: null,
    user: {
      id: 20,
      name: 'Chair Seller',
      avatar_url: null,
      is_verified: true,
      member_since: '2023-01-15T00:00:00Z',
    },
    template_data: null,
    views_count: 12,
    saves_count: 3,
    is_saved: false,
    is_own: false,
    is_promoted: false,
    status: 'active',
    expires_at: undefined,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-02T00:00:00Z',
    ...overrides,
  }),
  makeSellerListings: () => [
    {
      id: 56,
      title: 'Side Table',
      price: 20,
      price_type: 'fixed',
      price_currency: 'EUR',
      images: [{ url: 'https://example.com/table.jpg', thumbnail_url: 'https://example.com/table-thumb.jpg' }],
    },
  ],
}));

function setupMocks(listingOverrides = {}) {
  mockApi.get.mockImplementation((url: string) => {
    if (url.includes('/marketplace/listings/55')) {
      return Promise.resolve({ success: true, data: makeListing(listingOverrides) });
    }
    if (url.includes('/marketplace/sellers/')) {
      return Promise.resolve({ success: true, data: makeSellerListings() });
    }
    return Promise.resolve({ success: true, data: [] });
  });
}

// Owner, 31 Oct 2026: the item itself must be translatable, not only its
// comments. One Translate press translates the description and the title.
function mockTranslations() {
  mockApi.post.mockImplementation((url: string, body: { content_type: string }) => {
    if (url !== '/v2/ugc-translate') return Promise.resolve({ success: true, data: {} });
    const translated = body.content_type === 'marketplace_listing_title' ? 'Fauteuil douillet' : 'Un fauteuil merveilleusement confortable.';
    return Promise.resolve({
      success: true,
      data: { translated_text: translated, source_locale: 'en', target_locale: 'fr', cached: false },
    });
  });
}

describe('MarketplaceListingPage — Translate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    tenantGates.messaging = true;
    setupMocks();
    mockTranslations();
  });

  it('translates the description and title together, then restores the original', async () => {
    const { MarketplaceListingPage } = await import('./MarketplaceListingPage');
    render(<MarketplaceListingPage />);

    await screen.findByRole('heading', { level: 1, name: 'Cosy Armchair' });
    fireEvent.click(screen.getByRole('button', { name: 'translate.translate' }));

    await screen.findByText('Un fauteuil merveilleusement confortable.');
    expect(screen.getByRole('heading', { level: 1, name: 'Fauteuil douillet' })).toBeInTheDocument();
    expect(mockApi.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'marketplace_listing',
      content_id: 55,
      source_text: 'A wonderfully comfortable armchair, perfect for reading.',
    }));
    expect(mockApi.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'marketplace_listing_title',
      content_id: 55,
      source_text: 'Cosy Armchair',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'translate.show_original' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Cosy Armchair' })).toBeInTheDocument());
    expect(screen.getByText('A wonderfully comfortable armchair, perfect for reading.')).toBeInTheDocument();
    expect(screen.queryByText('Fauteuil douillet')).not.toBeInTheDocument();
  });
});
