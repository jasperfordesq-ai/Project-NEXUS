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

const mockInvoice = vi.hoisted(() => ({
  id: 'in_123',
  number: 'INV-001',
  date: '2026-05-01T00:00:00Z',
  amount: 9900,    // €99.00
  currency: 'EUR',
  status: 'paid' as const,
  hosted_invoice_url: 'https://stripe.com/invoice/in_123',
  invoice_pdf: 'https://stripe.com/invoice/in_123/pdf',
}));

const mockOpenInvoice = vi.hoisted(() => ({
  ...mockInvoice,
  id: 'in_456',
  number: 'INV-002',
  status: 'open' as const,
  hosted_invoice_url: null,
  invoice_pdf: null,
}));

// ── mocks ────────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

vi.mock('../../api/billingApi', () => ({
  billingApi: {
    getPlans: vi.fn(),
    getSubscription: vi.fn(),
    createCheckout: vi.fn(),
    createPortal: vi.fn(),
    getInvoices: vi.fn(),
  },
}));

import { billingApi } from '../../api/billingApi';
import { InvoiceHistory } from './InvoiceHistory';

// ── helpers ──────────────────────────────────────────────────────────────────
function mockSuccessfulLoad(invoices = [mockInvoice]) {
  vi.mocked(billingApi.getInvoices).mockResolvedValue({
    success: true,
    data: invoices,
  } as never);
}

function mockEmptyLoad() {
  vi.mocked(billingApi.getInvoices).mockResolvedValue({
    success: true,
    data: [],
  } as never);
}

function mockFailedLoad() {
  vi.mocked(billingApi.getInvoices).mockRejectedValue(new Error('Network error'));
}

// ── tests ────────────────────────────────────────────────────────────────────
describe('InvoiceHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset window.open between tests
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('shows loading spinner while fetching invoices', () => {
    vi.mocked(billingApi.getInvoices).mockReturnValue(new Promise(() => {}));
    render(<InvoiceHistory />);

    const loadingEl = screen.queryAllByRole('status').find(
      el => el.getAttribute('aria-busy') === 'true'
    );
    expect(loadingEl).toBeInTheDocument();
  });

  it('removes loading spinner after invoices load', async () => {
    mockSuccessfulLoad();
    render(<InvoiceHistory />);

    await waitFor(() => {
      expect(screen.getByText('INV-001')).toBeInTheDocument();
    });

    const busyStatus = screen.queryAllByRole('status').find(
      el => el.getAttribute('aria-busy') === 'true'
    );
    expect(busyStatus).toBeUndefined();
  });

  it('renders invoice number after successful load', async () => {
    mockSuccessfulLoad();
    render(<InvoiceHistory />);

    await waitFor(() => {
      expect(screen.getByText('INV-001')).toBeInTheDocument();
    });
  });

  it('renders formatted amount', async () => {
    mockSuccessfulLoad();
    render(<InvoiceHistory />);

    await waitFor(() => {
      expect(screen.getByText('INV-001')).toBeInTheDocument();
    });

    // amount=9900 → formatAmount(9900, 'EUR') → new Intl.NumberFormat(undefined, { style:'currency', currency:'EUR' }).format(9900)
    // JSDOM locale formats this differently but always contains '9,900' or '9.900' or '€9,900'.
    // Use a function matcher to be locale-agnostic.
    const amountCell = screen.getByText((content) =>
      content.replace(/\s/g, '').includes('9,900') || content.replace(/\s/g, '').includes('9.900') || content.includes('9900')
    );
    expect(amountCell).toBeInTheDocument();
  });

  // The status chip is TRANSLATED — t(`billing.invoice_status_${status}`) — so the
  // raw Stripe status 'paid' is never on screen and this query matched nothing,
  // reading as a missing chip. Assert the label an admin sees, and that the raw
  // Stripe value does not leak through.
  it('renders invoice status chip', async () => {
    mockSuccessfulLoad();
    render(<InvoiceHistory />);

    await waitFor(() => {
      expect(screen.getByText('Paid')).toBeInTheDocument();
    });
    expect(screen.queryByText('paid')).not.toBeInTheDocument();
  });

  it('shows empty state when no invoices exist', async () => {
    mockEmptyLoad();
    render(<InvoiceHistory />);

    await waitFor(() => {
      expect(screen.queryByText('INV-001')).not.toBeInTheDocument();
    });
  });

  it('shows error toast when fetch fails', async () => {
    mockFailedLoad();
    render(<InvoiceHistory />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('View button opens hosted_invoice_url in new tab', async () => {
    mockSuccessfulLoad();
    const user = userEvent.setup();
    render(<InvoiceHistory />);

    await waitFor(() => {
      expect(screen.getByText('INV-001')).toBeInTheDocument();
    });

    const viewBtn = screen.getByRole('button', { name: /view/i });
    await user.click(viewBtn);

    expect(window.open).toHaveBeenCalledWith(
      mockInvoice.hosted_invoice_url,
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('Download button opens invoice_pdf in new tab', async () => {
    mockSuccessfulLoad();
    const user = userEvent.setup();
    render(<InvoiceHistory />);

    await waitFor(() => {
      expect(screen.getByText('INV-001')).toBeInTheDocument();
    });

    const downloadBtn = screen.getByRole('button', { name: /download/i });
    await user.click(downloadBtn);

    expect(window.open).toHaveBeenCalledWith(
      mockInvoice.invoice_pdf,
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('does NOT render View/Download buttons for invoices without URLs', async () => {
    mockSuccessfulLoad([mockOpenInvoice]);
    render(<InvoiceHistory />);

    await waitFor(() => {
      expect(screen.getByText('INV-002')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /view/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
  });

  it('renders multiple invoices correctly', async () => {
    mockSuccessfulLoad([mockInvoice, mockOpenInvoice]);
    render(<InvoiceHistory />);

    await waitFor(() => {
      expect(screen.getByText('INV-001')).toBeInTheDocument();
      expect(screen.getByText('INV-002')).toBeInTheDocument();
    });
  });
});
