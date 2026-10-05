// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Router — provide id param ───────────────────────────────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useParams: () => ({ id: '42' }),
    useNavigate: () => vi.fn(),
  };
});

// ─── Contexts ────────────────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Test User' },
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
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub PageMeta (SEO component, not testable in jsdom) ────────────────────
vi.mock('@/components/seo/PageMeta', () => ({
  PageMeta: () => null,
}));

// ─── Stub DonationReceipt — it has its own API calls ─────────────────────────
// We test that DonationReceiptPage passes the correct donationId prop.
// DonationReceipt itself is a separate component; stub it to isolate the page.
vi.mock('@/components/donations/DonationReceipt', () => ({
  DonationReceipt: ({ donationId }: { donationId: number }) => (
    <div data-testid="donation-receipt" data-donation-id={String(donationId)} />
  ),
  default: ({ donationId }: { donationId: number }) => (
    <div data-testid="donation-receipt" data-donation-id={String(donationId)} />
  ),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────
// Mirrors StripeDonationService::getDonationReceipt().
const makeReceipt = (overrides = {}) => ({
  donation_id: 42,
  donor_name: 'Jane Doe',
  amount: '50.00',
  currency: 'EUR',
  date: '2025-06-01T10:00:00Z',
  tenant_name: 'hOUR Timebank',
  message: null,
  status: 'completed',
  payment_method: 'stripe',
  payment_reference: 'pi_001',
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DonationReceiptPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: makeReceipt() });
  });

  it('renders without crashing', async () => {
    const { default: DonationReceiptPage } = await import('./DonationReceiptPage');
    const { container } = render(<DonationReceiptPage />);
    expect(container).toBeTruthy();
  });

  it('mounts the DonationReceipt child component', async () => {
    const { default: DonationReceiptPage } = await import('./DonationReceiptPage');
    render(<DonationReceiptPage />);

    const receipt = screen.getByTestId('donation-receipt');
    expect(receipt).toBeInTheDocument();
  });

  it('passes the numeric donationId derived from the route param to DonationReceipt', async () => {
    // useParams returns { id: '42' } so donationId should be 42
    const { default: DonationReceiptPage } = await import('./DonationReceiptPage');
    render(<DonationReceiptPage />);

    const receipt = screen.getByTestId('donation-receipt');
    expect(receipt).toHaveAttribute('data-donation-id', '42');
  });

  it('renders within a constrained max-width container', async () => {
    const { default: DonationReceiptPage } = await import('./DonationReceiptPage');
    const { container } = render(<DonationReceiptPage />);

    // The wrapping div uses max-w-3xl — verify a wrapper element exists between
    // the fragment root and the DonationReceipt stub
    const receipt = screen.getByTestId('donation-receipt');
    const wrapper = receipt.parentElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain('max-w-3xl');
  });

  it('sets the page title via usePageTitle', async () => {
    const { usePageTitle } = await import('@/hooks');
    const { default: DonationReceiptPage } = await import('./DonationReceiptPage');
    render(<DonationReceiptPage />);

    // usePageTitle is called with the i18n-resolved title for this page
    expect(usePageTitle).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration-style: render the REAL DonationReceipt to test loading + data
// ─────────────────────────────────────────────────────────────────────────────
describe('DonationReceiptPage (with real DonationReceipt child)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Re-mock the donations module to the REAL implementation for these tests
  // We do this by clearing the module registry so the real component loads.
  // Simplest approach: import and render DonationReceipt directly to verify
  // the API contract the page relies on.

  it('DonationReceipt shows loading spinner while fetching', async () => {
    // Never-resolving promise simulates in-flight request
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));

    // Reset the vi.mock for donations so the real component renders
    vi.doMock('@/components/donations/DonationReceipt', async (importOriginal) => {
      return await importOriginal<typeof import('@/components/donations/DonationReceipt')>();
    });

    const { DonationReceipt } = await import('@/components/donations/DonationReceipt');
    render(<DonationReceipt donationId={42} />);

    // The loading state renders a role=status with aria-busy=true
    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('DonationReceipt shows receipt data after successful fetch', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: makeReceipt() });

    vi.doMock('@/components/donations/DonationReceipt', async (importOriginal) => {
      return await importOriginal<typeof import('@/components/donations/DonationReceipt')>();
    });

    const { DonationReceipt } = await import('@/components/donations/DonationReceipt');
    render(<DonationReceipt donationId={42} />);

    await waitFor(() => {
      // Donor name appears on the receipt
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
  });

  it('DonationReceipt shows error state when API fails', async () => {
    mockApi.get.mockResolvedValue({ success: false, error: 'Not found' });

    vi.doMock('@/components/donations/DonationReceipt', async (importOriginal) => {
      return await importOriginal<typeof import('@/components/donations/DonationReceipt')>();
    });

    const { DonationReceipt } = await import('@/components/donations/DonationReceipt');
    render(<DonationReceipt donationId={99} />);

    await waitFor(() => {
      // Error state shows the API error or fallback text
      expect(screen.getByText(/not found|failed to load|receipt/i)).toBeInTheDocument();
    });
  });

  it('DonationReceipt calls the correct API endpoint', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: makeReceipt() });

    vi.doMock('@/components/donations/DonationReceipt', async (importOriginal) => {
      return await importOriginal<typeof import('@/components/donations/DonationReceipt')>();
    });

    const { DonationReceipt } = await import('@/components/donations/DonationReceipt');
    render(<DonationReceipt donationId={42} />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/donations/42/receipt');
    });
  });

  it('DonationReceipt shows community name in receipt', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: makeReceipt({ tenant_name: 'hOUR Timebank' }),
    });

    vi.doMock('@/components/donations/DonationReceipt', async (importOriginal) => {
      return await importOriginal<typeof import('@/components/donations/DonationReceipt')>();
    });

    const { DonationReceipt } = await import('@/components/donations/DonationReceipt');
    render(<DonationReceipt donationId={42} />);

    await waitFor(() => {
      expect(screen.getByText('hOUR Timebank')).toBeInTheDocument();
    });
  });

  it('DonationReceipt renders print button after data loads', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: makeReceipt() });

    vi.doMock('@/components/donations/DonationReceipt', async (importOriginal) => {
      return await importOriginal<typeof import('@/components/donations/DonationReceipt')>();
    });

    const { DonationReceipt } = await import('@/components/donations/DonationReceipt');
    render(<DonationReceipt donationId={42} />);

    await waitFor(() => {
      const printBtn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('print')
      );
      expect(printBtn).toBeInTheDocument();
    });
  });
});
