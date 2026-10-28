// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Toast / Auth / Tenant ───────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({ user: { id: 1, name: 'Seller' }, isAuthenticated: true, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle' as const, error: null }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub heavy child components ─────────────────────────────────────────────
vi.mock('@/components/marketplace', () => ({
  OrderStatusBadge: ({ status }: { status: string }) => <span data-testid="order-status">{status}</span>,
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('@/components/seo/PageMeta', () => ({
  PageMeta: () => null,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeOrder = (overrides = {}) => ({
  id: 42,
  order_number: 'ORD-001',
  status: 'paid',
  total_price: 25,
  currency: 'EUR',
  quantity: 1,
  created_at: '2025-05-01T10:00:00Z',
  tracking_number: null,
  tracking_url: null,
  shipping_method: null,
  ratings: [],
  listing: { id: 7, title: 'Handmade Candle', image: { url: null } },
  buyer: { id: 3, name: 'Bob Buyer', avatar_url: null },
  ...overrides,
});

const makeResponse = (orders = [] as object[], meta = {}) => ({
  success: true,
  data: orders,
  meta: { has_more: false, cursor: null, ...meta },
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SellerOrdersPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue(makeResponse());
  });

  it('shows a loading spinner initially', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));
    const { SellerOrdersPage } = await import('./SellerOrdersPage');
    render(<SellerOrdersPage />);

    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders empty state when no orders returned', async () => {
    const { SellerOrdersPage } = await import('./SellerOrdersPage');
    render(<SellerOrdersPage />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders order cards when orders are returned', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder()]));
    const { SellerOrdersPage } = await import('./SellerOrdersPage');
    render(<SellerOrdersPage />);

    await waitFor(() => {
      expect(screen.getByText('Handmade Candle')).toBeInTheDocument();
      // Buyer name appears inline with translation text; search by substring
      expect(screen.getByText(/Bob Buyer/)).toBeInTheDocument();
    });
  });

  it('renders historical orders whose listing has been removed', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ listing: null })]));
    const { SellerOrdersPage } = await import('./SellerOrdersPage');
    render(<SellerOrdersPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/listing.*not.found/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Bob Buyer/)).toBeInTheDocument();
    });
  });

  it('shows order status badge', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ status: 'paid' })]));
    const { SellerOrdersPage } = await import('./SellerOrdersPage');
    render(<SellerOrdersPage />);

    await waitFor(() => {
      expect(screen.getByTestId('order-status')).toHaveTextContent('paid');
    });
  });

  it('renders Mark Shipped button for paid orders', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ status: 'paid' })]));
    const { SellerOrdersPage } = await import('./SellerOrdersPage');
    render(<SellerOrdersPage />);

    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('ship')
      );
      expect(btn).toBeInTheDocument();
    });
  });

  it('opens ship modal when Mark Shipped is clicked', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ status: 'paid' })]));
    const { SellerOrdersPage } = await import('./SellerOrdersPage');
    render(<SellerOrdersPage />);

    await waitFor(() => screen.getByText('Handmade Candle'));

    const shipBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('ship')
    );
    if (shipBtn) fireEvent.click(shipBtn);

    await waitFor(() => {
      // Modal opens — look for a dialog or heading containing "ship"
      const modal = document.querySelector('[role="dialog"]');
      expect(modal).toBeTruthy();
    });
  });

  it('calls PUT /ship endpoint when modal is confirmed', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ status: 'paid' })]));
    mockApi.put.mockResolvedValue({ success: true });

    const { SellerOrdersPage } = await import('./SellerOrdersPage');
    render(<SellerOrdersPage />);

    await waitFor(() => screen.getByText('Handmade Candle'));

    const shipBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('ship')
    );
    if (shipBtn) fireEvent.click(shipBtn);

    // Wait for modal
    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Find confirm button inside modal
    const confirmBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('confirm') || b.textContent?.toLowerCase().includes('shipped')
    );

    if (confirmBtn) {
      fireEvent.click(confirmBtn);
      await waitFor(() => {
        expect(mockApi.put).toHaveBeenCalledWith(
          '/v2/marketplace/orders/42/ship',
          expect.objectContaining({ shipping_method: 'standard' }),
        );
      });
    }
  });

  it('shows load more button when has_more is true', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder()], { has_more: true }));
    const { SellerOrdersPage } = await import('./SellerOrdersPage');
    render(<SellerOrdersPage />);

    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('more') || b.textContent?.toLowerCase().includes('load')
      );
      expect(btn).toBeInTheDocument();
    });
  });

  it('renders shipped order with awaiting confirmation state', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ status: 'shipped' })]));
    const { SellerOrdersPage } = await import('./SellerOrdersPage');
    render(<SellerOrdersPage />);

    await waitFor(() => screen.getByText('Handmade Candle'));
    // The shipped status should show "awaiting confirmation" disabled button
    const awaiting = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('await') || b.getAttribute('disabled') !== null
    );
    // At least one disabled/awaiting element exists for shipped orders
    expect(awaiting).toBeDefined();
  });

  it('shows error toast when API fails', async () => {
    mockApi.get.mockRejectedValue(new Error('network'));
    const { SellerOrdersPage } = await import('./SellerOrdersPage');
    render(<SellerOrdersPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('displays order number and date', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder()]));
    const { SellerOrdersPage } = await import('./SellerOrdersPage');
    render(<SellerOrdersPage />);

    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });
  });

  // ─── Cancel an order (R1) ────────────────────────────────────────────────
  // Laravel lets either party cancel an order that has not been paid for
  // (status pending_payment) and requires a reason; paid orders need a refund.
  it('offers Cancel order only while the order is awaiting payment', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ status: 'paid' })]));
    const { SellerOrdersPage } = await import('./SellerOrdersPage');
    const { unmount } = render(<SellerOrdersPage />);
    await waitFor(() => expect(screen.getByText('Handmade Candle')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
    unmount();

    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ status: 'pending_payment' })]));
    render(<SellerOrdersPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument());
  });

  it('requires a reason, then cancels through the API and marks the order cancelled', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ status: 'pending_payment' })]));
    mockApi.put.mockResolvedValue({ success: true, data: { id: 42, status: 'cancelled' } });
    const { SellerOrdersPage } = await import('./SellerOrdersPage');
    render(<SellerOrdersPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel order' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Cancel this order?');

    // No reason: the server would reject it, so nothing is sent.
    const confirm = () => screen.getAllByRole('button', { name: 'Cancel order' }).find((b) => dialog.contains(b))!;
    fireEvent.click(confirm());
    expect(await screen.findByText('Enter a reason for cancelling.')).toBeInTheDocument();
    expect(mockApi.put).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Reason for cancelling/), { target: { value: '  Changed my plans  ' } });
    fireEvent.click(confirm());

    await waitFor(() =>
      expect(mockApi.put).toHaveBeenCalledWith('/v2/marketplace/orders/42/cancel', { reason: 'Changed my plans' }),
    );
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('The order has been cancelled.'));
    await waitFor(() => expect(screen.getByTestId('order-status')).toHaveTextContent('cancelled'));
  });

  it('shows the server message and keeps the order when cancelling is refused', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ status: 'pending_payment' })]));
    mockApi.put.mockResolvedValue({ success: false, error: 'A paid order needs a refund instead.' });
    const { SellerOrdersPage } = await import('./SellerOrdersPage');
    render(<SellerOrdersPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel order' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText(/Reason for cancelling/), { target: { value: 'No longer needed' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel order' }).find((b) => dialog.contains(b))!);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('A paid order needs a refund instead.'));
    expect(screen.getByTestId('order-status')).toHaveTextContent('pending_payment');
  });
});
