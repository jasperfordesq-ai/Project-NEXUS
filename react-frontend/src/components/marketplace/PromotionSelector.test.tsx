// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for PromotionSelector component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock('@/contexts', () => createMockContexts());

import { api } from '@/lib/api';
import { PromotionSelector } from './PromotionSelector';
import type { MarketplacePromotionProduct } from '@/types/marketplace';

const MOCK_PRODUCTS: MarketplacePromotionProduct[] = [
  {
    type: 'bump',
    label: 'Bump to Top',
    description: 'Moves your listing to the top of search results',
    price: 0,
    currency: 'EUR',
    duration_hours: 24,
  },
  {
    type: 'featured',
    label: 'Featured Listing',
    description: 'Gets a featured badge and higher visibility',
    price: 4.99,
    currency: 'EUR',
    duration_hours: 168,
  },
  {
    type: 'homepage_carousel',
    label: 'Homepage Carousel',
    description: 'Appears in the homepage carousel',
    price: 9.99,
    currency: 'EUR',
    duration_hours: 48,
  },
];

const DEFAULT_PROPS = {
  isOpen: true,
  onClose: vi.fn(),
  listingId: 7,
  listingTitle: 'My Bicycle for Sale',
  onPromoted: vi.fn(),
};

describe('PromotionSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: products load successfully
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/v2/marketplace/promotions/products') {
        return Promise.resolve({ success: true, data: MOCK_PRODUCTS });
      }
      return Promise.resolve({ success: false });
    });
  });

  // ─── Rendering / loading ─────────────────────────────────────────────────────

  it('renders the modal title', async () => {
    render(<PromotionSelector {...DEFAULT_PROPS} />);
    await waitFor(() => {
      expect(screen.getByText('Promote Listing')).toBeInTheDocument();
    });
  });

  it('renders the listing title in the header', async () => {
    render(<PromotionSelector {...DEFAULT_PROPS} />);
    await waitFor(() => {
      expect(screen.getByText('My Bicycle for Sale')).toBeInTheDocument();
    });
  });

  it('shows a loading spinner while fetching products', () => {
    // Never resolve so spinner stays visible
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
    render(<PromotionSelector {...DEFAULT_PROPS} />);
    // Multiple role="status" elements may exist (HeroUI Spinner has several);
    // we just verify at least one is present
    expect(screen.getAllByRole('status', { hidden: true }).length).toBeGreaterThan(0);
  });

  it('renders all promotion options after load', async () => {
    render(<PromotionSelector {...DEFAULT_PROPS} />);
    await waitFor(() => {
      expect(screen.getByText('Bump to Top')).toBeInTheDocument();
      expect(screen.getByText('Featured Listing')).toBeInTheDocument();
      expect(screen.getByText('Homepage Carousel')).toBeInTheDocument();
    });
  });

  it('renders product descriptions', async () => {
    render(<PromotionSelector {...DEFAULT_PROPS} />);
    await waitFor(() => {
      expect(
        screen.getByText('Moves your listing to the top of search results')
      ).toBeInTheDocument();
    });
  });

  it('renders "Free" label for zero-price product', async () => {
    render(<PromotionSelector {...DEFAULT_PROPS} />);
    await waitFor(() => {
      // The bump product (price=0) should show "Free"
      expect(screen.getAllByText('Free')).toHaveLength(1);
    });
  });

  it('renders formatted prices for paid products', async () => {
    render(<PromotionSelector {...DEFAULT_PROPS} />);
    await waitFor(() => {
      expect(screen.getByText('EUR 4.99')).toBeInTheDocument();
      expect(screen.getByText('EUR 9.99')).toBeInTheDocument();
    });
  });

  it('does not force decimal places for zero-decimal promotion currencies', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [{ ...MOCK_PRODUCTS[1], currency: 'JPY', price: 500 }],
    });

    render(<PromotionSelector {...DEFAULT_PROPS} />);

    await waitFor(() => expect(screen.getByText(/JPY\s*500/)).toBeInTheDocument());
    expect(document.body.textContent).not.toContain('500.00');
  });

  it('renders duration for each product (in days when >= 24h)', async () => {
    render(<PromotionSelector {...DEFAULT_PROPS} />);
    await waitFor(() => {
      // 24h → "1 day", 168h → "7 days", 48h → "2 days"
      expect(screen.getByText('1 day')).toBeInTheDocument();
      expect(screen.getByText('7 days')).toBeInTheDocument();
      expect(screen.getByText('2 days')).toBeInTheDocument();
    });
  });

  it('shows an error message when products fail to load (API rejects)', async () => {
    // Note: the component only calls setError() in the catch block. A
    // response with success:false (but no throw) leaves products empty with no
    // error state shown — that is intentional component behaviour. Only a
    // thrown error (network failure etc.) triggers the visible error message.
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/v2/marketplace/promotions/products') {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({ success: false });
    });
    render(<PromotionSelector {...DEFAULT_PROPS} />);
    await waitFor(() => {
      expect(
        screen.getByText("We couldn't load the promotion options.")
      ).toBeInTheDocument();
    });
  });

  // ─── Selection ───────────────────────────────────────────────────────────────

  it('Confirm button is disabled when nothing selected', async () => {
    render(<PromotionSelector {...DEFAULT_PROPS} />);
    await waitFor(() => {
      expect(screen.getByText('Bump to Top')).toBeInTheDocument();
    });
    // HeroUI v3 uses data-disabled="true" for the isDisabled prop (not aria-disabled)
    const confirmButton = screen.getByRole('button', { name: /select a promotion/i });
    expect(confirmButton).toHaveAttribute('data-disabled', 'true');
  });

  it('shows "Select a promotion" label when nothing is selected', async () => {
    render(<PromotionSelector {...DEFAULT_PROPS} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /select a promotion/i })).toBeInTheDocument();
    });
  });

  it('selecting a product enables the Confirm button', async () => {
    render(<PromotionSelector {...DEFAULT_PROPS} />);
    await waitFor(() => {
      expect(screen.getByText('Bump to Top')).toBeInTheDocument();
    });

    // Click the "Bump to Top" card (it's a pressable Card)
    fireEvent.click(screen.getByText('Bump to Top'));

    await waitFor(() => {
      // The confirm button should no longer be disabled
      const btn = screen.queryByRole('button', { name: /promote for/i });
      expect(btn).toBeInTheDocument();
      expect(btn).not.toHaveAttribute('aria-disabled', 'true');
    });
  });

  it('shows price in Confirm button label when a paid product is selected', async () => {
    render(<PromotionSelector {...DEFAULT_PROPS} />);
    await waitFor(() => {
      expect(screen.getByText('Featured Listing')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Featured Listing'));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /promote for EUR\s*4\.99/i })
      ).toBeInTheDocument();
    });
  });

  it('shows "Free" in Confirm button label when free product is selected', async () => {
    render(<PromotionSelector {...DEFAULT_PROPS} />);
    await waitFor(() => {
      expect(screen.getByText('Bump to Top')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Bump to Top'));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /promote for free/i })
      ).toBeInTheDocument();
    });
  });

  // ─── Confirm / submit ────────────────────────────────────────────────────────

  it('calls POST endpoint with correct payload on confirm', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    render(<PromotionSelector {...DEFAULT_PROPS} />);
    await waitFor(() => {
      expect(screen.getByText('Featured Listing')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Featured Listing'));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /promote for/i })
      ).not.toHaveAttribute('aria-disabled', 'true');
    });

    fireEvent.click(screen.getByRole('button', { name: /promote for/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/v2/marketplace/listings/7/promote',
        { promotion_type: 'featured' }
      );
    });
  });

  it('calls onPromoted and onClose on successful promotion', async () => {
    const onPromoted = vi.fn();
    const onClose = vi.fn();
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    render(
      <PromotionSelector
        {...DEFAULT_PROPS}
        onPromoted={onPromoted}
        onClose={onClose}
      />
    );
    await waitFor(() => {
      expect(screen.getByText('Bump to Top')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Bump to Top'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /promote for/i })).not.toHaveAttribute(
        'aria-disabled',
        'true'
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /promote for/i }));

    await waitFor(() => {
      expect(onPromoted).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it('shows error message when confirm API call fails', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: false });

    render(<PromotionSelector {...DEFAULT_PROPS} />);
    await waitFor(() => {
      expect(screen.getByText('Bump to Top')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Bump to Top'));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /promote for/i })
      ).not.toHaveAttribute('aria-disabled', 'true');
    });

    fireEvent.click(screen.getByRole('button', { name: /promote for/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent("We couldn't set up the promotion. Please try again.");
    });
  });

  it('shows error message when confirm API throws', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Network error'));

    render(<PromotionSelector {...DEFAULT_PROPS} />);
    await waitFor(() => {
      expect(screen.getByText('Bump to Top')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Bump to Top'));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /promote for/i })
      ).not.toHaveAttribute('aria-disabled', 'true');
    });

    fireEvent.click(screen.getByRole('button', { name: /promote for/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent("We couldn't set up the promotion. Please try again.");
    });
  });

  // ─── Cancel ───────────────────────────────────────────────────────────────────

  it('calls onClose when Cancel is pressed', async () => {
    const onClose = vi.fn();
    render(<PromotionSelector {...DEFAULT_PROPS} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('Bump to Top')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ─── Duration formatting for sub-24h ─────────────────────────────────────────

  it('renders duration in hours when less than 24', async () => {
    const hourProduct: MarketplacePromotionProduct = {
      type: 'bump',
      label: 'Quick Bump',
      description: 'Short bump',
      price: 0,
      currency: 'EUR',
      duration_hours: 6,
    };
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/v2/marketplace/promotions/products') {
        return Promise.resolve({ success: true, data: [hourProduct] });
      }
      return Promise.resolve({ success: false });
    });

    render(<PromotionSelector {...DEFAULT_PROPS} />);
    await waitFor(() => {
      expect(screen.getByText('6 hours')).toBeInTheDocument();
    });
  });
});
