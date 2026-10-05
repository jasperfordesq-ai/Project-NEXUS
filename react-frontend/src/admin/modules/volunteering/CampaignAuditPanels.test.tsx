// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockFundraising, mockToast } = vi.hoisted(() => ({
  mockFundraising: {
    history: vi.fn(),
    handovers: vi.fn(),
    recordHandover: vi.fn(),
    cancelHandover: vi.fn(),
  },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../api/fundraisingApi', () => ({ adminFundraising: mockFundraising }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/contexts', () => createMockContexts({ useToast: () => mockToast }));

import { CampaignHistoryPanel, CampaignHandoversPanel } from './CampaignAuditPanels';

const summary = { raised: 100, handed_over: 40, still_held: 60, currency: 'EUR' };
const openHandover = {
  id: 7, giving_day_id: 3, organization_id: 9, amount: 40, currency: 'EUR', handed_over_on: '2026-10-01',
  method: 'bank_transfer', reference: 'TRF-1', note: null, status: 'recorded', recorded_by_name: 'Ada Admin',
  created_at: '2026-10-01 10:00:00', confirmed_by_name: null, confirmed_at: null, cancelled_by_name: null,
  cancelled_at: null, cancel_reason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFundraising.handovers.mockResolvedValue({ success: true, data: { items: [openHandover], summary } });
});

describe('CampaignHistoryPanel', () => {
  it('loads and shows the campaign history with Stripe references', async () => {
    mockFundraising.history.mockResolvedValue({ success: true, data: { items: [{
      id: 1, event: 'donation_paid', actor_kind: 'stripe', actor_name: null, amount: 25, currency: 'EUR',
      donation_id: 44, handover_id: null, details: null, stripe_object_id: 'pi_9', created_at: '2026-10-05 12:00:00',
    }] } });

    render(<CampaignHistoryPanel givingDayId={3} />);

    await waitFor(() => expect(screen.getByText('Gift paid')).toBeInTheDocument());
    expect(mockFundraising.history).toHaveBeenCalledWith(3);
    expect(screen.getByText('Stripe reference pi_9')).toBeInTheDocument();
  });

  it('says so when the history cannot load', async () => {
    mockFundraising.history.mockResolvedValue({ success: false, error: 'boom' });
    render(<CampaignHistoryPanel givingDayId={3} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument());
  });
});

describe('CampaignHandoversPanel', () => {
  it('explains there is nothing to pass on for a community-wide campaign', () => {
    render(<CampaignHandoversPanel givingDayId={3} hasOrganisation={false} />);
    expect(screen.getByText('This campaign is for the whole community, so there is nothing to pass on.')).toBeInTheDocument();
    expect(mockFundraising.handovers).not.toHaveBeenCalled();
  });

  it('shows the totals and records a hand-over', async () => {
    mockFundraising.recordHandover.mockResolvedValue({ success: true, data: { ...openHandover, id: 8 } });
    render(<CampaignHandoversPanel givingDayId={3} hasOrganisation />);

    await waitFor(() => expect(screen.getByText('€60.00')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Record a hand-over' }));

    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText(/^Payment reference/), { target: { value: 'TRF-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record hand-over' }));

    await waitFor(() => expect(mockFundraising.recordHandover).toHaveBeenCalled());
    expect(mockFundraising.recordHandover).toHaveBeenCalledWith(3, expect.objectContaining({
      amount: 25, method: 'bank_transfer', reference: 'TRF-2',
    }));
    expect(mockToast.success).toHaveBeenCalledWith('Hand-over recorded. The organisation has been told.');
    expect(mockFundraising.handovers).toHaveBeenCalledTimes(2);
  });

  it('refuses more than is still held before asking the server', async () => {
    render(<CampaignHandoversPanel givingDayId={3} hasOrganisation />);
    await waitFor(() => expect(screen.getByText('€60.00')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Record a hand-over' }));

    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '75' } });
    fireEvent.change(screen.getByLabelText(/^Payment reference/), { target: { value: 'TRF-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record hand-over' }));

    expect(await screen.findByText('That is more than this campaign still holds (€60.00).')).toBeInTheDocument();
    expect(mockFundraising.recordHandover).not.toHaveBeenCalled();
  });

  it('shows the server’s reason when it refuses', async () => {
    mockFundraising.recordHandover.mockResolvedValue({ success: false, error: 'Enter a payment reference so the transfer can be traced.' });
    render(<CampaignHandoversPanel givingDayId={3} hasOrganisation />);
    await waitFor(() => expect(screen.getByText('€60.00')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Record a hand-over' }));
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/^Payment reference/), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record hand-over' }));

    expect(await screen.findByText('Enter a payment reference so the transfer can be traced.')).toBeInTheDocument();
  });

  it('cancels a hand-over only once a reason is given', async () => {
    mockFundraising.cancelHandover.mockResolvedValue({ success: true, data: { ...openHandover, status: 'cancelled' } });
    render(<CampaignHandoversPanel givingDayId={3} hasOrganisation />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel hand-over' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel hand-over' }));
    const confirm = screen.getByRole('button', { name: 'Cancel it' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Why is this being cancelled/), { target: { value: 'Typed twice' } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(mockFundraising.cancelHandover).toHaveBeenCalledWith(7, 'Typed twice'));
    expect(mockToast.success).toHaveBeenCalledWith('Hand-over cancelled.');
  });
});
