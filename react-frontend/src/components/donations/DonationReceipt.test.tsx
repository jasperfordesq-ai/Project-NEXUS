// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for DonationReceipt component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { api } from '@/lib/api';
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

vi.mock('@/contexts', () => createMockContexts());

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

// Stub window.print so the print button doesn't throw in jsdom
Object.defineProperty(window, 'print', { value: vi.fn(), writable: true });

import { DonationReceipt } from './DonationReceipt';

// The shape StripeDonationService::getDonationReceipt() actually returns. The
// fixture used to invent `community_name` / `reference` / `id`, so these tests
// passed while every real receipt showed a blank Community line.
const MOCK_RECEIPT = {
  donation_id: 42,
  donor_name: 'Jane Smith',
  amount: '5000.00',
  currency: 'EUR',
  date: '2024-06-01T10:00:00Z',
  tenant_name: 'Test Timebank',
  organization_name: null as string | null,
  giving_day_title: null as string | null,
  message: 'Keep up the good work',
  status: 'completed',
  payment_method: 'stripe',
  payment_reference: 'pi_12345',
};

describe('DonationReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading spinner while fetching', () => {
    // Never resolve so we stay in the loading state
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<DonationReceipt donationId={42} />);
    // HeroUI Spinner nests multiple role="status" elements with the same label.
    // The outer wrapper is the aria-busy div; assert at least one status is visible.
    const statusEls = screen.getAllByRole('status', { name: /loading/i });
    expect(statusEls.length).toBeGreaterThan(0);
  });

  it('renders donor name, reference, community, and payment method after load', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: MOCK_RECEIPT });

    render(<DonationReceipt donationId={42} />);

    await waitFor(() => expect(screen.getByText('Jane Smith')).toBeInTheDocument());
    expect(screen.getByText(/pi_12345/)).toBeInTheDocument();
    expect(screen.getByText('Test Timebank')).toBeInTheDocument();
    // The stored method key 'stripe' is shown as the member-facing label.
    expect(screen.getByText('Card')).toBeInTheDocument();
    expect(screen.queryByText(/stripe/i)).not.toBeInTheDocument();
  });

  it('names the organisation and campaign the gift went to', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { ...MOCK_RECEIPT, organization_name: 'Food Bank', giving_day_title: 'Winter appeal' },
    });

    render(<DonationReceipt donationId={42} />);

    await waitFor(() => expect(screen.getByText('Food Bank')).toBeInTheDocument());
    expect(screen.getByText('Organisation')).toBeInTheDocument();
    expect(screen.getByText('Winter appeal')).toBeInTheDocument();
    expect(screen.getByText('Campaign')).toBeInTheDocument();
  });

  it('says the community holds the gift on the organisation’s behalf', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { ...MOCK_RECEIPT, organization_name: 'Food Bank' },
    });

    render(<DonationReceipt donationId={42} />);

    expect(await screen.findByText('Held by Test Timebank on behalf of Food Bank.')).toBeInTheDocument();
  });

  it('leaves out the organisation and campaign rows for a general gift', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: MOCK_RECEIPT });

    render(<DonationReceipt donationId={42} />);

    await waitFor(() => expect(screen.getByText('Jane Smith')).toBeInTheDocument());
    expect(screen.queryByText('Organisation')).not.toBeInTheDocument();
    expect(screen.queryByText('Campaign')).not.toBeInTheDocument();
  });

  it('renders the optional donor message when present', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: MOCK_RECEIPT });

    render(<DonationReceipt donationId={42} />);

    await waitFor(() =>
      expect(screen.getByText('Keep up the good work')).toBeInTheDocument()
    );
  });

  it('does not render a message section when message is null', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { ...MOCK_RECEIPT, message: null },
    });

    render(<DonationReceipt donationId={42} />);

    await waitFor(() => expect(screen.getByText('Jane Smith')).toBeInTheDocument());
    expect(screen.queryByText('Keep up the good work')).not.toBeInTheDocument();
  });

  it('shows an error state when the API returns success=false', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: false,
      error: 'Not found',
    });

    render(<DonationReceipt donationId={99} />);

    // Wait for the loading spinner (aria-busy) to disappear
    await waitFor(() =>
      expect(screen.queryAllByRole('status', { name: /loading/i }).length).toBe(0)
    );
    // Error or fallback text should be visible; the donor name must not appear
    expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument();
  });

  it('shows an error state when the API throws', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'));

    render(<DonationReceipt donationId={99} />);

    await waitFor(() =>
      expect(screen.queryAllByRole('status', { name: /loading/i }).length).toBe(0)
    );
    expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument();
  });

  it('announces the error in an alert region and retries on button press (VOL-RX-006)', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: false, error: 'boom' });

    render(<DonationReceipt donationId={99} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);

    // A second failure lets us assert the retry button re-issues the request.
    vi.mocked(api.get).mockResolvedValueOnce({ success: false, error: 'still boom' });
    screen.getByRole('button').click();

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('calls the correct API endpoint with the given donationId', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: MOCK_RECEIPT });

    render(<DonationReceipt donationId={42} />);

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/v2/donations/42/receipt'));
  });

  it('renders a print button', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: MOCK_RECEIPT });

    render(<DonationReceipt donationId={42} />);

    await waitFor(() => expect(screen.getByText('Jane Smith')).toBeInTheDocument());

    // The print button is the sole button on the receipt
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('calls window.print() when the print button is pressed', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: MOCK_RECEIPT });

    render(<DonationReceipt donationId={42} />);

    await waitFor(() => expect(screen.getByText('Jane Smith')).toBeInTheDocument());

    // Find the print button by its icon button role
    const printButtons = screen.getAllByRole('button');
    // Click the first (and only) button — the Print Receipt button
    printButtons[0].click();

    expect(window.print).toHaveBeenCalled();
  });
});
