// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── hoisted mock data ────────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

// A stable mock ref for the confirm function
const mockConfirm = vi.hoisted(() => vi.fn());

const mockCoupon = vi.hoisted(() => ({
  id: 10,
  seller_id: 3,
  code: 'SUMMER20',
  title: 'Summer Sale',
  discount_type: 'percent' as const,
  discount_value: 20,
  status: 'active',
  usage_count: 5,
  valid_until: '2026-12-31T23:59:59Z',
  created_at: '2026-01-01T00:00:00Z',
}));

const mockPausedCoupon = vi.hoisted(() => ({
  ...mockCoupon,
  id: 11,
  status: 'paused',
  code: 'PAUSED10',
}));

// ── mocks ────────────────────────────────────────────────────────────────────
// Mutable so a test can switch the tenant currency (JPY has no minor unit).
const mockTenant = vi.hoisted(() => ({ id: 2, name: 'Test Tenant', slug: 'test', currency: 'GBP' }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: mockTenant,
      tenantPath: (path: string) => `/test${path}`,
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

// useConfirm is imported from @/components/ui — mock that module's export
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    useConfirm: () => mockConfirm,
  };
});

import { api } from '@/lib/api';
import AdminCouponsPage from './AdminCouponsPage';

// ── helpers ──────────────────────────────────────────────────────────────────
function mockSuccessfulLoad(items: Array<Record<string, unknown>> = [mockCoupon]) {
  vi.mocked(api.get).mockResolvedValue({
    success: true,
    data: { items },
  } as never);
}

function mockEmptyLoad() {
  vi.mocked(api.get).mockResolvedValue({
    success: true,
    data: { items: [] },
  } as never);
}

function mockFailedLoad() {
  vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
}

// ── tests ────────────────────────────────────────────────────────────────────
describe('AdminCouponsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: confirm resolves to true (user clicks OK)
    mockConfirm.mockResolvedValue(true);
  });

  it('shows loading spinner while fetching', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<AdminCouponsPage />);

    const loadingEl = screen.queryAllByRole('status').find(
      el => el.getAttribute('aria-busy') === 'true'
    );
    expect(loadingEl).toBeInTheDocument();
  });

  it('removes loading spinner once data loads', async () => {
    mockSuccessfulLoad();
    render(<AdminCouponsPage />);

    await waitFor(() => {
      expect(screen.getByText('SUMMER20')).toBeInTheDocument();
    });

    const busyStatus = screen.queryAllByRole('status').find(
      el => el.getAttribute('aria-busy') === 'true'
    );
    expect(busyStatus).toBeUndefined();
  });

  it('renders coupon code and title after load', async () => {
    mockSuccessfulLoad();
    render(<AdminCouponsPage />);

    await waitFor(() => {
      expect(screen.getByText('SUMMER20')).toBeInTheDocument();
    });
    expect(screen.getByText('Summer Sale')).toBeInTheDocument();
  });

  it('shows empty table content when no coupons exist', async () => {
    mockEmptyLoad();
    render(<AdminCouponsPage />);

    // Table renders but no rows with coupon code
    await waitFor(() => {
      expect(screen.queryByText('SUMMER20')).not.toBeInTheDocument();
    });
  });

  it('shows error toast when fetch fails', async () => {
    mockFailedLoad();
    render(<AdminCouponsPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('formats percent discount correctly', async () => {
    // discount_value=25 is unique — no other field has value 25 in mockCoupon
    mockSuccessfulLoad([{ ...mockCoupon, discount_type: 'percent', discount_value: 25, seller_id: 3, usage_count: 0 }]);
    render(<AdminCouponsPage />);

    await waitFor(() => {
      expect(screen.getByText('SUMMER20')).toBeInTheDocument();
    });

    // The discount column renders the i18n key result containing "25" — use a function matcher
    // to avoid matching the seller_id (3) or usage_count (0) columns
    const discountCell = screen.getByText((content, element) => {
      // Must be a td cell containing "25" and not a th
      return element?.tagName === 'TD' && content.includes('25') && !content.includes('Summer Sale');
    });
    expect(discountCell).toBeInTheDocument();
  });

  it('formats fixed discounts in the tenant currency', async () => {
    // discount_value is stored in the currency's minor unit (pence here), the
    // same way MerchantCouponService::calculateDiscountMinor() reads it.
    mockSuccessfulLoad([{ ...mockCoupon, discount_type: 'fixed', discount_value: 500 }]);
    render(<AdminCouponsPage />);

    expect(await screen.findByText('£5.00')).toBeInTheDocument();
  });

  it('does not divide a fixed discount by 100 for a zero-decimal currency', async () => {
    mockTenant.currency = 'JPY';
    try {
      mockSuccessfulLoad([{ ...mockCoupon, discount_type: 'fixed', discount_value: 500 }]);
      render(<AdminCouponsPage />);

      // 500 yen is 500 yen ("¥500" or "JP¥500" depending on the formatting
      // locale); "¥5" would be the old /100 bug.
      expect(await screen.findByText(/^(JP)?[¥￥]500$/)).toBeInTheDocument();
      expect(screen.queryByText(/^(JP)?[¥￥]5$/)).not.toBeInTheDocument();
    } finally {
      mockTenant.currency = 'GBP';
    }
  });

  it('calls POST /suspend endpoint when Suspend is confirmed', async () => {
    mockSuccessfulLoad();
    vi.mocked(api.post).mockResolvedValue({ success: true } as never);
    // After suspend, reload
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { items: [mockCoupon] },
    } as never);

    const user = userEvent.setup();
    render(<AdminCouponsPage />);

    await waitFor(() => {
      expect(screen.getByText('SUMMER20')).toBeInTheDocument();
    });

    const suspendBtn = screen.getByRole('button', { name: /suspend/i });
    await user.click(suspendBtn);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        `/v2/admin/marketplace/coupons/${mockCoupon.id}/suspend`,
        {}
      );
    });
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('does NOT call suspend when confirm is cancelled', async () => {
    mockConfirm.mockResolvedValue(false);
    mockSuccessfulLoad();

    const user = userEvent.setup();
    render(<AdminCouponsPage />);

    await waitFor(() => {
      expect(screen.getByText('SUMMER20')).toBeInTheDocument();
    });

    const suspendBtn = screen.getByRole('button', { name: /suspend/i });
    await user.click(suspendBtn);

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalled();
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('calls DELETE endpoint when Delete is confirmed', async () => {
    // First load: with coupon. Second load (after delete): empty.
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: { items: [mockCoupon] } } as never)
      .mockResolvedValueOnce({ success: true, data: { items: [] } } as never);
    vi.mocked(api.delete).mockResolvedValue({ success: true } as never);

    const user = userEvent.setup();
    render(<AdminCouponsPage />);

    await waitFor(() => {
      expect(screen.getByText('SUMMER20')).toBeInTheDocument();
    });

    const deleteBtn = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteBtn);

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith(
        `/v2/admin/marketplace/coupons/${mockCoupon.id}`
      );
    });
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('Suspend button is disabled for already-paused coupons', async () => {
    mockSuccessfulLoad([mockPausedCoupon]);
    const user = userEvent.setup();
    render(<AdminCouponsPage />);

    await waitFor(() => {
      expect(screen.getByText('PAUSED10')).toBeInTheDocument();
    });

    // HeroUI buttons use data-disabled or disabled attribute for isDisabled prop.
    // Verify that clicking suspend when paused does NOT call api.post.
    const suspendBtn = screen.getByRole('button', { name: /suspend/i });
    // The button renders as disabled in some form — verify via attribute presence
    const isDisabled = suspendBtn.hasAttribute('disabled') ||
                       suspendBtn.getAttribute('aria-disabled') === 'true' ||
                       suspendBtn.getAttribute('data-disabled') === 'true';
    expect(isDisabled).toBe(true);
  });

  it('shows error toast when delete API returns failure', async () => {
    mockSuccessfulLoad();
    vi.mocked(api.delete).mockResolvedValue({
      success: false,
      error: 'Cannot delete active coupon',
    } as never);

    const user = userEvent.setup();
    render(<AdminCouponsPage />);

    await waitFor(() => {
      expect(screen.getByText('SUMMER20')).toBeInTheDocument();
    });

    const deleteBtn = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});
