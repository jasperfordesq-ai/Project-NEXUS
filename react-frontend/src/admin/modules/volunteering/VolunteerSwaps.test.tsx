// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockAdminVolunteering } = vi.hoisted(() => ({
  mockAdminVolunteering: {
    getPendingSwaps: vi.fn(),
    decideSwap: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminVolunteering: mockAdminVolunteering,
}));

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

vi.mock('../../AdminMetaContext', () => ({ useAdminPageMeta: vi.fn() }));

vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const swap = (id = 5) => ({
  id,
  status: 'admin_pending',
  message: null,
  requester: { id: 1, name: 'Brendan VolunteerB' },
  recipient: { id: 2, name: 'Aoife VolunteerA' },
  original_shift: { id: 80, start_time: '2026-10-24 10:00:00', end_time: '2026-10-24 13:00:00', opportunity_title: 'Garden shifts' },
  proposed_shift: { id: 81, start_time: '2026-10-26 10:00:00', end_time: '2026-10-26 13:00:00', opportunity_title: 'Garden shifts' },
  created_at: '2026-10-19 14:00:00',
});

async function renderPage() {
  const mod = await import('./VolunteerSwaps');
  const Component = mod.default;
  render(<Component />);
}

describe('VolunteerSwaps (admin)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('lists a request waiting for approval and approves it', async () => {
    mockAdminVolunteering.getPendingSwaps.mockResolvedValue({ success: true, data: [swap()] });
    mockAdminVolunteering.decideSwap.mockResolvedValue({ success: true, data: { id: 5, status: 'admin_approved' } });
    await renderPage();

    expect(await screen.findByText('Brendan VolunteerB')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Approve$/ }));
    // The confirmation dialog's own Approve button.
    const buttons = await screen.findAllByRole('button', { name: /^Approve$/ });
    await userEvent.click(buttons[buttons.length - 1] as HTMLElement);

    await waitFor(() => expect(mockAdminVolunteering.decideSwap).toHaveBeenCalledWith(5, 'approve'));
    await waitFor(() => expect(screen.queryByText('Brendan VolunteerB')).not.toBeInTheDocument());
  });

  /*
    Found walking the swaps journey on 19 Oct 2026: a request that could no longer
    complete (a volunteer had given up the shift it named) sat in this queue, and
    Approve answered only "Failed to update swap request". The server's reason is now
    shown and the queue reloaded, so the dead request drops out.
  */
  it('shows the server reason when a decision is refused and reloads the queue', async () => {
    mockAdminVolunteering.getPendingSwaps
      .mockResolvedValueOnce({ success: true, data: [swap()] })
      .mockResolvedValueOnce({ success: true, data: [] });
    mockAdminVolunteering.decideSwap.mockResolvedValue({
      success: false,
      errors: [{ code: 'DECISION_CONFLICT', message: 'This swap request has expired: a shift has started, or one of you is no longer on the shift it names.' }],
    });
    await renderPage();

    await screen.findByText('Brendan VolunteerB');
    await userEvent.click(screen.getByRole('button', { name: /^Approve$/ }));
    const buttons = await screen.findAllByRole('button', { name: /^Approve$/ });
    await userEvent.click(buttons[buttons.length - 1] as HTMLElement);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('This swap request has expired')));
    await waitFor(() => expect(mockAdminVolunteering.getPendingSwaps).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Brendan VolunteerB')).not.toBeInTheDocument());
  });
});
