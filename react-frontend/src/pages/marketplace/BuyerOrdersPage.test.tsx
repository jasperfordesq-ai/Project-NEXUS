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

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return { ...orig, useNavigate: () => mockNavigate };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({ user: { id: 1, name: 'Alice' }, isAuthenticated: true, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle' as const, error: null }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// Stub heavy children (mirrors SellerOrdersPage.test — the real PageMeta has no
// provider in the harness and spins).
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
}));
vi.mock('@/components/marketplace', () => ({
  OrderStatusBadge: ({ status }: { status: string }) => <span data-testid="order-status">{status}</span>,
  RatingModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="rating-modal" /> : null),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeOrder = (overrides = {}) => ({
  id: 10,
  status: 'paid',
  total_price: 20,
  currency: 'EUR',
  quantity: 1,
  created_at: '2025-03-01T00:00:00Z',
  tracking_number: null,
  tracking_url: null,
  ratings: [] as Array<{ rater_role: string; rating: number }>,
  listing: { id: 5, title: 'Hand-knitted scarf', image: { url: null } },
  seller: { id: 99, name: 'Bob Seller', avatar_url: null },
  ...overrides,
});

const makeResponse = (orders = [] as object[], meta = {}) => ({
  success: true,
  data: orders,
  meta: { has_more: false, cursor: null, ...meta },
});

function busySpinner() {
  return screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('BuyerOrdersPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue(makeResponse());
  });

  it('shows a loading spinner initially', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));
    const { BuyerOrdersPage } = await import('./BuyerOrdersPage');
    render(<BuyerOrdersPage />);
    expect(busySpinner()).toBeDefined();
  });

  it('renders the page heading and tab options after load', async () => {
    const { BuyerOrdersPage } = await import('./BuyerOrdersPage');
    render(<BuyerOrdersPage />);
    await waitFor(() => expect(busySpinner()).toBeUndefined());
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').length).toBeGreaterThanOrEqual(4);
  });

  it('shows the empty state when no orders are returned', async () => {
    const { BuyerOrdersPage } = await import('./BuyerOrdersPage');
    render(<BuyerOrdersPage />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
  });

  it('calls the purchases endpoint on mount', async () => {
    const { BuyerOrdersPage } = await import('./BuyerOrdersPage');
    render(<BuyerOrdersPage />);
    await waitFor(() =>
      expect(mockApi.get).toHaveBeenCalledWith(expect.stringContaining('/v2/marketplace/orders/purchases')),
    );
  });

  it('renders order cards (listing title + seller name)', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder()]));
    const { BuyerOrdersPage } = await import('./BuyerOrdersPage');
    render(<BuyerOrdersPage />);
    await waitFor(() => expect(screen.getByText('Hand-knitted scarf')).toBeInTheDocument());
    expect(screen.getByText(/Bob Seller/)).toBeInTheDocument();
  });

  it('renders historical orders whose listing has been removed', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ listing: null })]));
    const { BuyerOrdersPage } = await import('./BuyerOrdersPage');
    render(<BuyerOrdersPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/listing.*not.found/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Bob Seller/)).toBeInTheDocument();
    });
  });

  it('shows the order status badge', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ status: 'shipped' })]));
    const { BuyerOrdersPage } = await import('./BuyerOrdersPage');
    render(<BuyerOrdersPage />);
    await waitFor(() => expect(screen.getByTestId('order-status')).toHaveTextContent('shipped'));
  });

  it('shows the tracking number for a shipped order', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ status: 'shipped', tracking_number: 'TRACK123' })]));
    const { BuyerOrdersPage } = await import('./BuyerOrdersPage');
    render(<BuyerOrdersPage />);
    await waitFor(() => expect(screen.getByText(/TRACK123/)).toBeInTheDocument());
  });

  it('renders a confirm-delivery action for a shipped order', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ status: 'shipped' })]));
    const { BuyerOrdersPage } = await import('./BuyerOrdersPage');
    render(<BuyerOrdersPage />);
    await waitFor(() => expect(screen.getByText('Hand-knitted scarf')).toBeInTheDocument());
    const confirmBtn = screen.getAllByRole('button').find(
      (b) => !b.hasAttribute('disabled') && /confirm|deliver/i.test(b.textContent ?? ''),
    );
    expect(confirmBtn).toBeDefined();
  });

  it('renders a rate action for a delivered order without a rating', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ status: 'delivered' })]));
    const { BuyerOrdersPage } = await import('./BuyerOrdersPage');
    render(<BuyerOrdersPage />);
    await waitFor(() => expect(screen.getByText('Hand-knitted scarf')).toBeInTheDocument());
    const rateBtn = screen.getAllByRole('button').find((b) => /rate|rating/i.test(b.textContent ?? ''));
    expect(rateBtn).toBeDefined();
  });

  it('does not render a rate action when the order already has a buyer rating', async () => {
    mockApi.get.mockResolvedValue(
      makeResponse([makeOrder({ status: 'completed', ratings: [{ rater_role: 'buyer', rating: 5 }] })]),
    );
    const { BuyerOrdersPage } = await import('./BuyerOrdersPage');
    render(<BuyerOrdersPage />);
    await waitFor(() => expect(screen.getByText('Hand-knitted scarf')).toBeInTheDocument());
    const rateBtns = screen.queryAllByRole('button').filter((b) => /leave.?rating|rate order/i.test(b.textContent ?? ''));
    expect(rateBtns.length).toBe(0);
  });

  it('shows an error toast when the fetch fails', async () => {
    mockApi.get.mockRejectedValue(new Error('network'));
    const { BuyerOrdersPage } = await import('./BuyerOrdersPage');
    render(<BuyerOrdersPage />);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  // ─── Cancel an order (R1) ────────────────────────────────────────────────
  // Laravel lets either party cancel an order that has not been paid for
  // (status pending_payment) and requires a reason; paid orders need a refund.
  it('offers Cancel order only while the order is awaiting payment', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ status: 'paid' })]));
    const { BuyerOrdersPage } = await import('./BuyerOrdersPage');
    const { unmount } = render(<BuyerOrdersPage />);
    await waitFor(() => expect(screen.getByText('Hand-knitted scarf')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
    unmount();

    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ status: 'pending_payment' })]));
    render(<BuyerOrdersPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument());
  });

  it('requires a reason, then cancels through the API and marks the order cancelled', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ status: 'pending_payment' })]));
    mockApi.put.mockResolvedValue({ success: true, data: { id: 10, status: 'cancelled' } });
    const { BuyerOrdersPage } = await import('./BuyerOrdersPage');
    render(<BuyerOrdersPage />);

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
      expect(mockApi.put).toHaveBeenCalledWith('/v2/marketplace/orders/10/cancel', { reason: 'Changed my plans' }),
    );
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('The order has been cancelled.'));
    await waitFor(() => expect(screen.getByTestId('order-status')).toHaveTextContent('cancelled'));
  });

  it('shows the server message and keeps the order when cancelling is refused', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeOrder({ status: 'pending_payment' })]));
    mockApi.put.mockResolvedValue({ success: false, error: 'A paid order needs a refund instead.' });
    const { BuyerOrdersPage } = await import('./BuyerOrdersPage');
    render(<BuyerOrdersPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel order' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText(/Reason for cancelling/), { target: { value: 'No longer needed' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel order' }).find((b) => dialog.contains(b))!);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('A paid order needs a refund instead.'));
    expect(screen.getByTestId('order-status')).toHaveTextContent('pending_payment');
  });
});
