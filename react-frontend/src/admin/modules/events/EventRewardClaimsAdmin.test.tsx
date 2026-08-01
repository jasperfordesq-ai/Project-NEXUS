// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { AdminAttendanceClaim } from '../../api/adminApi';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockRewards } = vi.hoisted(() => ({
  mockRewards: {
    listClaims: vi.fn(),
    retryClaim: vi.fn(),
    reverseClaim: vi.fn(),
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminEventRewards: mockRewards,
}));

// ─── Contexts / meta / confirm ────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

vi.mock('../../AdminMetaContext', () => ({ useAdminPageMeta: vi.fn() }));

// Auto-approve the retry confirm dialog; reversal uses its own modal.
vi.mock('@/components/ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn(async () => true),
}));

function adminComponentsMock() {
  return {
    PageHeader: ({ title }: { title: string }) => (
      <div data-testid="page-header">
        <span>{title}</span>
      </div>
    ),
  };
}
vi.mock('../../components/PageHeader', adminComponentsMock);

import EventRewardClaimsAdmin from './EventRewardClaimsAdmin';

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeClaim = (overrides: Partial<AdminAttendanceClaim> = {}): AdminAttendanceClaim => ({
  id: 11,
  event_id: 5,
  event_title: 'Wassail Night',
  user_id: 42,
  member_name: 'Marie Curie',
  claim_type: 'attendance_reward',
  amount: 1.5,
  status: 'completed',
  failure_code: null,
  reversal_code: null,
  transaction_id: 900,
  parent_claim_id: null,
  created_at: '2026-08-01T10:00:00Z',
  completed_at: '2026-08-01T10:00:01Z',
  failed_at: null,
  reversed_at: null,
  ...overrides,
});

const page = (claims: AdminAttendanceClaim[], total = claims.length) => ({
  success: true as const,
  data: { claims, pagination: { page: 1, per_page: 25, total, total_pages: 1 } },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRewards.listClaims.mockResolvedValue(page([]));
});

describe('EventRewardClaimsAdmin', () => {
  it('lists claims with event, member, amount, and status', async () => {
    mockRewards.listClaims.mockResolvedValue(page([makeClaim()]));

    render(<EventRewardClaimsAdmin />);

    await waitFor(() => {
      expect(screen.getByText('Wassail Night')).toBeInTheDocument();
    });
    expect(screen.getByText('Marie Curie')).toBeInTheDocument();
    expect(screen.getByText('1.50')).toBeInTheDocument();
    // "Completed" also appears as a filter option, so scope to any match.
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
  });

  it('retries a failed reward claim through the confirm dialog', async () => {
    mockRewards.listClaims.mockResolvedValue(
      page([makeClaim({ id: 21, status: 'failed', failure_code: 'mint_failed', transaction_id: null, completed_at: null })])
    );
    mockRewards.retryClaim.mockResolvedValue({ success: true, data: { status: 'settled', claim_id: 21, transaction_id: 901 } });

    render(<EventRewardClaimsAdmin />);

    const retryButton = await screen.findByRole('button', { name: 'Retry' });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(mockRewards.retryClaim).toHaveBeenCalledWith(21);
    });
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
    // The list reloads after remediation.
    expect(mockRewards.listClaims.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('requires a reason of at least 3 characters before reversing', async () => {
    mockRewards.listClaims.mockResolvedValue(page([makeClaim()]));
    mockRewards.reverseClaim.mockResolvedValue({ success: true, data: { status: 'reversed', claim_id: 31, transaction_id: 902 } });

    render(<EventRewardClaimsAdmin />);

    const reverseButton = await screen.findByRole('button', { name: 'Reverse' });
    fireEvent.click(reverseButton);

    const confirmButton = await screen.findByTestId('reverse-claim-confirm');
    expect(confirmButton).toBeDisabled();
    expect(mockRewards.reverseClaim).not.toHaveBeenCalled();

    const reason = screen.getByLabelText('Reason');
    fireEvent.change(reason, { target: { value: 'Paid in error' } });

    await waitFor(() => {
      expect(screen.getByTestId('reverse-claim-confirm')).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId('reverse-claim-confirm'));

    await waitFor(() => {
      expect(mockRewards.reverseClaim).toHaveBeenCalledWith(11, 'Paid in error');
    });
  });

  it('offers no actions on reversal claims', async () => {
    mockRewards.listClaims.mockResolvedValue(
      page([makeClaim({ id: 41, claim_type: 'attendance_reward_reversal', parent_claim_id: 11 })])
    );

    render(<EventRewardClaimsAdmin />);

    await waitFor(() => {
      expect(screen.getByText('Wassail Night')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no claims', async () => {
    render(<EventRewardClaimsAdmin />);

    await waitFor(() => {
      expect(screen.getByText('No claims yet')).toBeInTheDocument();
    });
  });
});
