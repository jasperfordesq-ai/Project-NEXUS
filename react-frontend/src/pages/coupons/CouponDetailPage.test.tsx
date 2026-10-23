// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for CouponDetailPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { api } from '@/lib/api';

const toDataURL = vi.fn();
vi.mock('qrcode', () => ({ toDataURL: (...args: unknown[]) => toDataURL(...args) }));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// The real crawler-status tag, so a test can see it (setup.ts makes the barrel a no-op).
vi.mock('@/components/seo', async () => ({
  PageMeta: () => null,
  PrerenderStatusCode: (await import('@/components/seo/PrerenderStatusCode')).PrerenderStatusCode,
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

// Mock useParams so the component gets id='42'
vi.mock('react-router-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...original,
    useParams: () => ({ id: '42' }),
  };
});

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () => ({
  useToast: () => mockToast,
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle' as const, error: null }),
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test' }, tenantPath: (p: string) => `/test${p}`, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
  useTheme: () => ({ resolvedTheme: 'light', theme: 'system', toggleTheme: vi.fn(), setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  usePresence: () => ({ status: 'offline', setStatus: vi.fn(), getPresence: vi.fn(), isOnline: vi.fn(() => false) }),
  usePresenceOptional: () => null,
}));

// Mock clipboard API
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn(() => Promise.resolve()) },
  configurable: true,
  writable: true,
});

import CouponDetailPage from './CouponDetailPage';

const COUPON_PERCENT = {
  id: 42,
  code: 'SAVE20',
  title: '20% Off Everything',
  description: 'Get 20% off your order today',
  discount_type: 'percent' as const,
  discount_value: 20,
  min_order_cents: null,
  valid_until: null,
  status: 'active',
};

const COUPON_FIXED = {
  id: 42,
  code: 'FLAT5',
  title: '€5 Off',
  description: null,
  discount_type: 'fixed' as const,
  discount_value: 500,
  min_order_cents: null,
  valid_until: '2024-12-31T23:59:59Z',
  status: 'active',
};

const COUPON_BOGO = {
  id: 42,
  code: 'BOGO',
  title: 'Buy One Get One',
  description: null,
  discount_type: 'bogo' as const,
  discount_value: 0,
  min_order_cents: null,
  valid_until: null,
  status: 'active',
};

describe('CouponDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toDataURL.mockResolvedValue('data:image/png;base64,LOCAL');
  });

  it('shows a loading spinner initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<CouponDetailPage />);
    // HeroUI Spinner renders multiple role=status elements
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('renders the coupon title after loading', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: COUPON_PERCENT });
    render(<CouponDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('20% Off Everything')).toBeInTheDocument();
    });
  });

  it('renders the coupon code prominently', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: COUPON_PERCENT });
    render(<CouponDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('SAVE20')).toBeInTheDocument();
    });
  });

  it('shows description when present', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: COUPON_PERCENT });
    render(<CouponDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Get 20% off your order today')).toBeInTheDocument();
    });
  });

  it('displays percent discount in the chip', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: COUPON_PERCENT });
    render(<CouponDetailPage />);

    await waitFor(() => {
      // Chip shows "20% off" (percent type via formatDiscount — i18n: type_percent = "% off")
      // Multiple matches are fine — the discount chip + possibly the code text; just confirm it exists
      const els = screen.getAllByText(/20%/);
      expect(els.length).toBeGreaterThan(0);
    });
  });

  it('shows valid_until date when set', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: COUPON_FIXED });
    render(<CouponDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/2024|Dec|31/)).toBeInTheDocument();
    });
  });

  it('copies coupon code to clipboard when "Use Online" button is pressed', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: COUPON_PERCENT });
    render(<CouponDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('SAVE20')).toBeInTheDocument();
    });

    const copyBtn = screen.getByRole('button', { name: /copy|use online|online/i });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('SAVE20');
    });
  });

  it('shows a success toast after copying', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: COUPON_PERCENT });
    render(<CouponDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('SAVE20')).toBeInTheDocument();
    });

    const copyBtn = screen.getByRole('button', { name: /copy|use online|online/i });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('calls POST /v2/coupons/:id/qr when "Redeem in Store" is clicked', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: COUPON_PERCENT });
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      data: { token: 'tok-abc', expires_at: '2024-01-15T11:00:00Z', coupon_code: 'SAVE20' },
    });
    render(<CouponDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('SAVE20')).toBeInTheDocument();
    });

    const qrBtn = screen.getByRole('button', { name: /qr|store|redeem/i });
    fireEvent.click(qrBtn);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/coupons/42/qr', {});
    });
  });

  it('renders redemption QR data locally without a third-party image request', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: COUPON_PERCENT });
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      data: { token: 'private-redemption-token', expires_at: '2024-01-15T11:00:00Z', coupon_code: 'SAVE20' },
    });
    render(<CouponDetailPage />);

    fireEvent.click(await screen.findByRole('button', { name: /qr|store|redeem/i }));

    await waitFor(() => {
      expect(toDataURL).toHaveBeenCalledWith(
        'private-redemption-token',
        expect.objectContaining({ width: 300 }),
      );
      expect(screen.getByRole('img', { name: /qr/i })).toHaveAttribute(
        'src',
        'data:image/png;base64,LOCAL',
      );
    });

    expect(document.querySelector('img[src^="http"]')).toBeNull();
  });

  it('shows "not found" fallback (back button) when coupon data is null', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: null });
    render(<CouponDetailPage />);

    await waitFor(() => {
      // Should show a back button but no coupon title
      expect(screen.queryByText('20% Off Everything')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: /back|coupons/i })).toHaveAttribute(
        'href',
        '/test/coupons',
      );
    });
  });

  // 2026-10-23 SEO audit: a missing coupon answered crawlers 200 (a soft 404).
  it('tells crawlers 404 only when the server says the coupon does not exist', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, code: 'NOT_FOUND' });
    const { unmount } = render(<CouponDetailPage />);
    await waitFor(() =>
      expect(document.querySelector('meta[name="prerender-status-code"]')?.getAttribute('content')).toBe('404'),
    );
    unmount();

    vi.mocked(api.get).mockResolvedValue({ success: false, code: 'SERVER_ERROR' });
    render(<CouponDetailPage />);
    await waitFor(() => expect(screen.getByRole('link', { name: /back|coupons/i })).toBeInTheDocument());
    expect(document.querySelector('meta[name="prerender-status-code"]')).toBeNull();
  });

  it('calls the correct API endpoint for the coupon id from params', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: COUPON_PERCENT });
    render(<CouponDetailPage />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v2/coupons/42');
    });
  });

  it('renders bogo discount label', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: COUPON_BOGO });
    render(<CouponDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Buy One Get One')).toBeInTheDocument();
    });
  });
});
