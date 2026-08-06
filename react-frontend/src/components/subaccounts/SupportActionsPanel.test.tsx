// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/contexts', () => createMockContexts());

import { api } from '@/lib/api';
import { SupportActionsPanel } from './SupportActionsPanel';

const mockedGet = vi.mocked(api.get);
const mockedPost = vi.mocked(api.post);
const mockedDelete = vi.mocked(api.delete);

const pendingIncoming = {
  id: 7,
  action_type: 'credit_transfer' as const,
  status: 'pending' as const,
  payload_summary: { amount: 3 },
  other_party_name: 'Carer Smith',
  created_at: '2026-08-06T10:00:00Z',
  expires_at: '2026-08-20T10:00:00Z',
};

function mockLists(incoming: unknown[], outgoing: unknown[] = []) {
  mockedGet.mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('role=supporter')
        ? ({ success: true, data: { actions: outgoing } } as never)
        : ({ success: true, data: { actions: incoming, pending_count: incoming.length } } as never),
    ),
  );
}

describe('SupportActionsPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing at all when neither side has actions', async () => {
    mockLists([]);

    const { container } = render(<SupportActionsPanel />);

    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('lists a pending action with who prepared it', async () => {
    mockLists([pendingIncoming]);

    render(<SupportActionsPanel />);

    await waitFor(() => expect(screen.getByText('Waiting for your approval')).toBeInTheDocument());
    expect(screen.getByText(/A time-credit transfer — 3/)).toBeInTheDocument();
    expect(screen.getByText(/Prepared by Carer Smith/)).toBeInTheDocument();
  });

  it('approving posts the confirm endpoint', async () => {
    mockLists([pendingIncoming]);
    mockedPost.mockResolvedValue({ success: true, data: { status: 'confirmed', result_id: 1 } } as never);

    render(<SupportActionsPanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/v2/users/me/support-actions/7/confirm'),
    );
  });

  /**
   * 🔴 Declining confirms first and the reason is OPTIONAL — an empty reason
   * must send NO reason field at all, and the hint says a reason is never
   * required. Requiring somebody to justify refusing is pressure to consent.
   */
  it('declining without a reason sends no reason field', async () => {
    mockLists([pendingIncoming]);
    mockedPost.mockResolvedValue({ success: true, data: { status: 'declined' } } as never);

    render(<SupportActionsPanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(await screen.findByText('You never have to give a reason.')).toBeInTheDocument();
    // The confirm dialog's own Decline button (the last one rendered).
    const declineButtons = await screen.findAllByRole('button', { name: 'Decline' });
    const dialogDecline = declineButtons[declineButtons.length - 1];
    expect(dialogDecline).toBeDefined();
    fireEvent.click(dialogDecline as HTMLElement);

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/v2/users/me/support-actions/7/decline', {}),
    );
  });

  it('a supporter can withdraw their own pending preparation', async () => {
    mockLists([], [{ ...pendingIncoming, id: 9, other_party_name: 'Supported Member' }]);
    mockedDelete.mockResolvedValue({ success: true, data: { status: 'cancelled' } } as never);

    render(<SupportActionsPanel />);

    await waitFor(() => expect(screen.getByText('Prepared by you')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));

    await waitFor(() =>
      expect(mockedDelete).toHaveBeenCalledWith('/v2/users/me/support-actions/9'),
    );
  });
});
