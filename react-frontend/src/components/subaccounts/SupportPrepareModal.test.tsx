// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/contexts', () => createMockContexts());

import { api } from '@/lib/api';
import { SupportPrepareModal } from './SupportPrepareModal';

const mockedGet = vi.mocked(api.get);
const mockedPost = vi.mocked(api.post);

describe('SupportPrepareModal', () => {
  beforeEach(() => vi.clearAllMocks());

  function renderTransfer(tier: 'co_decide' | 'represent') {
    return render(
      <SupportPrepareModal
        isOpen
        onOpenChange={() => {}}
        actionType="credit_transfer"
        supportedUserId={42}
        supportedName="Molly Member"
        tier={tier}
      />,
    );
  }

  async function pickRecipientAndAmount() {
    mockedGet.mockResolvedValue({
      success: true,
      data: { users: [{ id: 7, first_name: 'Rita', last_name: 'Recipient' }] },
    } as never);

    fireEvent.change(screen.getByLabelText('Who is it for?'), { target: { value: 'Rita' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Rita Recipient' }));
    fireEvent.change(screen.getByLabelText('Hours'), { target: { value: '2.5' } });
  }

  /**
   * 🔴 The co_decide submit goes to the PREPARE endpoint and the copy says
   * nothing happens without the member — a co-decider must never reach the
   * direct proxy endpoint from this modal.
   */
  it('co_decide prepares — it does not act', async () => {
    mockedPost.mockResolvedValue({ success: true, data: { id: 1, status: 'pending' } } as never);
    renderTransfer('co_decide');

    expect(screen.getByText(/Nothing happens yet/)).toBeInTheDocument();
    await pickRecipientAndAmount();
    fireEvent.click(screen.getByRole('button', { name: 'Send for their approval' }));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith('/v2/users/me/support-actions', {
        supported_user_id: 42,
        action_type: 'credit_transfer',
        payload: { recipient: 7, amount: 2.5 },
      });
    });
    expect(mockedPost).not.toHaveBeenCalledWith(
      expect.stringContaining('/sub-accounts/'),
      expect.anything(),
    );
  });

  it('represent submits the direct proxy endpoint and says it acts immediately', async () => {
    mockedPost.mockResolvedValue({ success: true, data: {} } as never);
    renderTransfer('represent');

    expect(screen.getByText(/This will happen immediately/)).toBeInTheDocument();
    await pickRecipientAndAmount();
    fireEvent.click(screen.getByRole('button', { name: 'Do it now' }));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith('/v2/users/me/sub-accounts/42/transfer', {
        recipient: 7,
        amount: 2.5,
      });
    });
  });

  it('refuses to submit an incomplete form and sends nothing', async () => {
    renderTransfer('co_decide');

    fireEvent.click(screen.getByRole('button', { name: 'Send for their approval' }));

    await waitFor(() => expect(mockedPost).not.toHaveBeenCalled());
  });

  /**
   * 🔴 The balance being checked is the SUPPORTED member's, not the
   * supporter's. Reading the supporter's wallet would let a helper with a
   * healthy balance overspend a dependent's empty one, and the refusal would
   * only arrive from the server after they had filled the form in.
   */
  it("validates the amount against the supported member's balance, not the supporter's", async () => {
    mockedGet.mockImplementation((url: string) => {
      if (url.includes('/sub-accounts/42/wallet')) {
        return Promise.resolve({ success: true, data: { balance: 3 } } as never);
      }
      if (url.includes('/wallet/config')) {
        return Promise.resolve({ success: true, data: { max_transfer: 1000 } } as never);
      }
      return Promise.resolve({
        success: true,
        data: { users: [{ id: 7, first_name: 'Rita', last_name: 'Recipient' }] },
      } as never);
    });

    renderTransfer('represent');

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/v2/users/me/sub-accounts/42/wallet'));

    fireEvent.change(screen.getByLabelText('Who is it for?'), { target: { value: 'Rita' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Rita Recipient' }));
    fireEvent.change(screen.getByLabelText('Hours'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Do it now' }));

    // Over their balance — refused on screen, and nothing is sent.
    await waitFor(() => expect(mockedPost).not.toHaveBeenCalled());
  });

  it('sends when the amount is within their balance', async () => {
    mockedGet.mockImplementation((url: string) => {
      if (url.includes('/sub-accounts/42/wallet')) {
        return Promise.resolve({ success: true, data: { balance: 20 } } as never);
      }
      if (url.includes('/wallet/config')) {
        return Promise.resolve({ success: true, data: { max_transfer: 1000 } } as never);
      }
      return Promise.resolve({
        success: true,
        data: { users: [{ id: 7, first_name: 'Rita', last_name: 'Recipient' }] },
      } as never);
    });
    mockedPost.mockResolvedValue({ success: true, data: {} } as never);

    renderTransfer('represent');
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/v2/users/me/sub-accounts/42/wallet'));

    fireEvent.change(screen.getByLabelText('Who is it for?'), { target: { value: 'Rita' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Rita Recipient' }));
    fireEvent.change(screen.getByLabelText('Hours'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Do it now' }));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith('/v2/users/me/sub-accounts/42/transfer', {
        recipient: 7,
        amount: 9,
      });
    });
  });
});
