// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi, stableTenantPath, stableT } = vi.hoisted(() => ({
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
}));

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
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
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
vi.mock('@/contexts/TenantContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/TenantContext')>();
  return { ...actual, useTenant: () => ({
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

// ─────────────────────────────────────────────────────────────────────────────
describe('MarketplaceListingPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupMocks();
  });

  it('shows skeleton loading state initially', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { MarketplaceListingPage } = await import('./MarketplaceListingPage');
    render(<MarketplaceListingPage />);

    // Multiple role=status elements may exist (ToastProvider etc.); find the busy one
    const statusEls = screen.getAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders listing title after load', async () => {
    const { MarketplaceListingPage } = await import('./MarketplaceListingPage');
    render(<MarketplaceListingPage />);

    await waitFor(() => {
      expect(screen.getByText('Cosy Armchair')).toBeInTheDocument();
    });
  });

  it('renders price display for fixed-price listing', async () => {
    const { MarketplaceListingPage } = await import('./MarketplaceListingPage');
    render(<MarketplaceListingPage />);

    await waitFor(() => {
      // €50 formatted — depends on Intl, look for "50"
      const priceEl = screen.getAllByText(/50/)[0];
      expect(priceEl).toBeDefined();
    });
  });

  it('renders listing description', async () => {
    const { MarketplaceListingPage } = await import('./MarketplaceListingPage');
    render(<MarketplaceListingPage />);

    await waitFor(() => {
      expect(screen.getByText(/wonderfully comfortable armchair/)).toBeInTheDocument();
    });
  });

  it('shows EmptyState on API error', async () => {
    mockApi.get.mockResolvedValue({ success: false, error: 'Not found' });
    const { MarketplaceListingPage } = await import('./MarketplaceListingPage');
    render(<MarketplaceListingPage />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders Buy Now button for fixed-price listing', async () => {
    const { MarketplaceListingPage } = await import('./MarketplaceListingPage');
    render(<MarketplaceListingPage />);

    await waitFor(() => {
      expect(screen.getByTestId('buy-now-btn')).toBeInTheDocument();
    });
  });

  it('renders Make Offer button for non-free listing', async () => {
    const { MarketplaceListingPage } = await import('./MarketplaceListingPage');
    render(<MarketplaceListingPage />);

    await waitFor(() => {
      const offerBtn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('offer')
      );
      expect(offerBtn).toBeDefined();
    });
  });

  it('renders Message Seller element (button or link)', async () => {
    const { MarketplaceListingPage } = await import('./MarketplaceListingPage');
    render(<MarketplaceListingPage />);

    await waitFor(() => {
      // Message Seller may render as a button or as a Link (role=link) when user is set.
      // The t() key renders as 'listing.message_seller' via stableT.
      // Look for it in any interactive element or text node.
      const el =
        screen.queryByText(/message.*seller/i) ??
        screen.queryByText('listing.message_seller') ??
        [...screen.getAllByRole('button'), ...screen.queryAllByRole('link')].find(
          (b) => b.textContent?.toLowerCase().includes('message')
        );
      expect(el).toBeDefined();
    });
  });

  it('defaults a hybrid listing to cash and lets the buyer choose time credits', async () => {
    setupMocks({ price: 50, price_type: 'fixed', time_credit_price: 3 });
    const { MarketplaceListingPage } = await import('./MarketplaceListingPage');
    render(<MarketplaceListingPage />);

    const buyNow = await screen.findByTestId('buy-now-btn');
    const cashButton = screen.getByText('checkout.pay_with_money').closest('button');
    const timeCreditButton = screen.getByText('checkout.pay_with_time_credits').closest('button');

    expect(buyNow).toHaveAttribute('data-payment-method', 'cash');
    expect(cashButton).toHaveAttribute('aria-pressed', 'true');
    expect(timeCreditButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(timeCreditButton!);

    await waitFor(() => {
      expect(buyNow).toHaveAttribute('data-payment-method', 'time_credits');
      expect(timeCreditButton).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('hides buyer actions when the viewer owns the listing', async () => {
    setupMocks({ is_own: true, user: { id: 10, name: 'Logged User' } });
    const { MarketplaceListingPage } = await import('./MarketplaceListingPage');
    render(<MarketplaceListingPage />);

    await waitFor(() => expect(screen.getByText('Cosy Armchair')).toBeInTheDocument());
    expect(screen.queryByTestId('buy-now-btn')).not.toBeInTheDocument();
    expect(screen.queryByText('listing.make_offer')).not.toBeInTheDocument();
    expect(screen.queryByText('listing.message_seller')).not.toBeInTheDocument();
  });

  it('escapes less-than characters in JSON-LD structured data', async () => {
    setupMocks({ title: '</script><script>alert(1)</script>' });
    const { MarketplaceListingPage } = await import('./MarketplaceListingPage');
    render(<MarketplaceListingPage />);

    await waitFor(() => {
      const script = document.querySelector('script[type="application/ld+json"]');
      expect(script).toBeTruthy();
      expect(script?.textContent).toContain('\\u003c/script>');
      expect(script?.textContent).not.toContain('</script>');
    });
  });

  it('renders seller name', async () => {
    const { MarketplaceListingPage } = await import('./MarketplaceListingPage');
    render(<MarketplaceListingPage />);

    await waitFor(() => {
      expect(screen.getByText('Chair Seller')).toBeInTheDocument();
    });
  });

  it('renders "more from this seller" section when seller listings load', async () => {
    const { MarketplaceListingPage } = await import('./MarketplaceListingPage');
    render(<MarketplaceListingPage />);

    await waitFor(() => {
      expect(screen.getByText('Side Table')).toBeInTheDocument();
    });
  });

  it('renders report listing button', async () => {
    const { MarketplaceListingPage } = await import('./MarketplaceListingPage');
    render(<MarketplaceListingPage />);

    await waitFor(() => {
      const reportBtn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('report')
      );
      expect(reportBtn).toBeDefined();
    });
  });

  it('shows Free chip for free listing', async () => {
    setupMocks({ price: null, price_type: 'free' });
    const { MarketplaceListingPage } = await import('./MarketplaceListingPage');
    render(<MarketplaceListingPage />);

    await waitFor(() => {
      // Free badge / chip or free label text
      const freeEls = screen.getAllByText(/free/i);
      expect(freeEls.length).toBeGreaterThan(0);
    });
  });

  it('calls POST /save when save heart button is clicked', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    const { MarketplaceListingPage } = await import('./MarketplaceListingPage');
    render(<MarketplaceListingPage />);

    await waitFor(() => screen.getByText('Cosy Armchair'));

    const heartBtn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('save')
    );
    if (heartBtn) {
      fireEvent.click(heartBtn);
      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith(
          '/v2/marketplace/listings/55/save'
        );
      });
    }
  });
});
