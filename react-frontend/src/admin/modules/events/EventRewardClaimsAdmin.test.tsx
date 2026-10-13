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
const { mockRewards, mockHasFeature } = vi.hoisted(() => ({
  mockRewards: {
    listClaims: vi.fn(),
    retryClaim: vi.fn(),
    reverseClaim: vi.fn(),
  },
  mockHasFeature: vi.fn((_key: string) => true),
}));

vi.mock('../../api/adminApi', () => ({
  adminEventRewards: mockRewards,
}));

// ─── Contexts / meta / confirm ────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: mockHasFeature,
      hasModule: vi.fn((_key: string) => true),
    }),
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
  mockHasFeature.mockImplementation(() => true);
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

  it('shows the empty state when there are no claims, keeping Refresh available', async () => {
    render(<EventRewardClaimsAdmin />);

    await waitFor(() => {
      expect(screen.getByText('No claims yet')).toBeInTheDocument();
    });
    expect(screen.queryByText('No claims match these filters')).not.toBeInTheDocument();
    // Refresh used to vanish with the table whenever the list was empty.
    const callsBefore = mockRewards.listClaims.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => {
      expect(mockRewards.listClaims.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('says the FILTERS matched nothing, and clearing them restores the unfiltered list', async () => {
    render(<EventRewardClaimsAdmin />);
    await screen.findByText('No claims yet');

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });

    await waitFor(() => {
      expect(screen.getByText('No claims match these filters')).toBeInTheDocument();
    });
    expect(screen.queryByText('No claims yet')).not.toBeInTheDocument();
    expect(mockRewards.listClaims).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-09-01' }));
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    await waitFor(() => {
      expect(screen.getByText('No claims yet')).toBeInTheDocument();
    });
    expect(mockRewards.listClaims).toHaveBeenLastCalledWith(expect.not.objectContaining({ from: expect.anything() }));
  });

  it('labels known failure and reversal codes, and keeps an unknown code visible', async () => {
    mockRewards.listClaims.mockResolvedValue(page([
      makeClaim({ id: 51, status: 'failed', failure_code: 'monthly_cap_reached', transaction_id: null }),
      makeClaim({ id: 52, status: 'reversed', reversal_code: 'attendance_undone' }),
      makeClaim({ id: 53, status: 'failed', failure_code: 'something_new', transaction_id: null }),
    ]));

    render(<EventRewardClaimsAdmin />);

    expect(await screen.findByText('Monthly reward cap reached')).toBeInTheDocument();
    expect(screen.getByText('Check-in was undone')).toBeInTheDocument();
    expect(screen.getByText('Other reason:')).toBeInTheDocument();
    expect(screen.getByText('something_new')).toBeInTheDocument();
    // Known codes are never shown raw.
    expect(screen.queryByText('monthly_cap_reached')).not.toBeInTheDocument();
    expect(screen.queryByText('attendance_undone')).not.toBeInTheDocument();
  });

  it('explains that the community feature is off, and where to switch it on', async () => {
    mockHasFeature.mockImplementation((key: string) => key !== 'event_attendance_credits');
    mockRewards.listClaims.mockResolvedValue(
      page([makeClaim({ id: 61, status: 'failed', failure_code: 'mint_failed', transaction_id: null })])
    );

    render(<EventRewardClaimsAdmin />);

    expect(await screen.findByText('Attendance rewards are switched off for this community')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Open Module Configuration/ });
    expect(link).toHaveAttribute('href', '/test/admin/module-configuration');
    // The ledger still renders, but retry needs the feature.
    expect(await screen.findByText('Payment could not be made')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('shows no feature-off notice when the community feature is on', async () => {
    render(<EventRewardClaimsAdmin />);
    await screen.findByText('No claims yet');
    expect(screen.queryByText('Attendance rewards are switched off for this community')).not.toBeInTheDocument();
  });
});
