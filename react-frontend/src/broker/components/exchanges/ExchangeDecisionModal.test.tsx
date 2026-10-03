// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

const { mockAdminBroker, mockToast } = vi.hoisted(() => ({
  mockAdminBroker: { approveExchange: vi.fn(), rejectExchange: vi.fn() },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/admin/api/adminApi', () => ({ adminBroker: mockAdminBroker }));
vi.mock('@/contexts', () => createMockContexts({ useToast: () => mockToast }));

import { ExchangeDecisionModal } from './ExchangeDecisionModal';

describe('ExchangeDecisionModal', () => {
  const onClose = vi.fn();
  const onDecided = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('approves with optional notes, then closes and reports the decision', async () => {
    mockAdminBroker.approveExchange.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<ExchangeDecisionModal exchangeId={5} type="approve" onClose={onClose} onDecided={onDecided} />);

    expect(screen.getByText('Approve Exchange')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(mockAdminBroker.approveExchange).toHaveBeenCalledWith(5, undefined));
    expect(mockToast.success).toHaveBeenCalledWith('Exchange action succeeded');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDecided).toHaveBeenCalledTimes(1);
  });

  it('refuses to reject without a reason and sends nothing', async () => {
    const user = userEvent.setup();
    render(<ExchangeDecisionModal exchangeId={5} type="reject" onClose={onClose} onDecided={onDecided} />);

    await user.click(screen.getByRole('button', { name: 'Reject' }));

    expect(mockToast.error).toHaveBeenCalledWith('A reason is required to reject an exchange');
    expect(mockAdminBroker.rejectExchange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('rejects with the typed reason', async () => {
    mockAdminBroker.rejectExchange.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<ExchangeDecisionModal exchangeId={7} type="reject" onClose={onClose} onDecided={onDecided} />);

    await user.type(screen.getByLabelText(/Reason \(required\)/), 'Not a safe exchange');
    await user.click(screen.getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(mockAdminBroker.rejectExchange).toHaveBeenCalledWith(7, 'Not a safe exchange'));
    expect(onDecided).toHaveBeenCalledTimes(1);
  });

  // The server refuses a broker who is a party to the exchange; its message
  // must reach the broker and the typed reason must survive the refusal.
  it('keeps the modal and the typed reason when the server refuses', async () => {
    mockAdminBroker.rejectExchange.mockResolvedValue({ success: false, error: 'You are a party to this exchange.' });
    const user = userEvent.setup();
    render(<ExchangeDecisionModal exchangeId={7} type="reject" onClose={onClose} onDecided={onDecided} />);

    await user.type(screen.getByLabelText(/Reason \(required\)/), 'Reason text');
    await user.click(screen.getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('You are a party to this exchange.'));
    expect(onClose).not.toHaveBeenCalled();
    expect(onDecided).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Reason \(required\)/)).toHaveValue('Reason text');
  });

  it('shows the generic failure message when the request throws', async () => {
    mockAdminBroker.approveExchange.mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    render(<ExchangeDecisionModal exchangeId={5} type="approve" onClose={onClose} onDecided={onDecided} />);

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Exchange action failed'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel closes without deciding', async () => {
    const user = userEvent.setup();
    render(<ExchangeDecisionModal exchangeId={5} type="approve" onClose={onClose} onDecided={onDecided} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDecided).not.toHaveBeenCalled();
    expect(mockAdminBroker.approveExchange).not.toHaveBeenCalled();
  });
});
