// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { createMockContexts } from '@/test/mock-contexts';

const mockGetApprovals = vi.hoisted(() => vi.fn());
const mockGetApprovalStats = vi.hoisted(() => vi.fn());
const mockApproveMatch = vi.hoisted(() => vi.fn());
const mockRejectMatch = vi.hoisted(() => vi.fn());

vi.mock('@/admin/api/adminApi', () => ({
  adminMatching: {
    getApprovals: mockGetApprovals,
    getApprovalStats: mockGetApprovalStats,
    approveMatch: mockApproveMatch,
    rejectMatch: mockRejectMatch,
  },
}));

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

import { MatchApprovalsPage } from './MatchApprovalsPage';

const APPROVAL = {
  id: 11,
  user_1_id: 1,
  user_1_name: 'Alice Member',
  user_1_avatar: null,
  user_2_id: 2,
  user_2_name: 'Bob Owner',
  user_2_avatar: null,
  listing_id: 5,
  listing_title: 'Garden help wanted',
  match_score: 82,
  match_type: 'one_way',
  match_reasons: ['Category match'],
  distance_km: 2.4,
  status: 'pending' as const,
  created_at: '2026-06-30T10:00:00Z',
};

const STATS = {
  pending_count: 3,
  approved_count: 10,
  rejected_count: 2,
  avg_approval_time: 4,
  approval_rate: 83.3,
};

function renderPage(initialPath = '/test/broker/match-approvals') {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <MatchApprovalsPage />
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe('MatchApprovalsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mirrors what the shared api client (src/lib/api.ts) really resolves with for
    // paginated endpoints: `data` is the bare row array and pagination lives on the
    // sibling `meta`. Earlier fixtures nested `meta` inside `data`, a shape the
    // client never produces for these endpoints.
    mockGetApprovals.mockResolvedValue({
      success: true,
      data: [APPROVAL], meta: { current_page: 1, per_page: 20, total: 1, total_pages: 1, has_more: false },
    });
    mockGetApprovalStats.mockResolvedValue({ success: true, data: STATS });
  });

  it('renders the page title and stat cards', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Match Approvals' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Pending Review')).toBeInTheDocument();
      expect(screen.getByText('Approval Rate')).toBeInTheDocument();
    });
  });

  it('lists a pending match with both parties and its score', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Alice Member')).toBeInTheDocument();
      expect(screen.getByText('Bob Owner')).toBeInTheDocument();
      expect(screen.getByText('Garden help wanted')).toBeInTheDocument();
      expect(screen.getByText('82%')).toBeInTheDocument();
    });
  });

  it('requests the pending queue by default', async () => {
    renderPage();
    await waitFor(() => {
      expect(mockGetApprovals).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    });
  });

  it('honours a deep-linked ?status=approved filter', async () => {
    renderPage('/test/broker/match-approvals?status=approved');
    await waitFor(() => {
      expect(mockGetApprovals).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }));
    });
  });

  it('approves a match from the row action', async () => {
    mockApproveMatch.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Alice Member')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Approve Match' }));

    await waitFor(() => {
      expect(mockApproveMatch).toHaveBeenCalledWith(11);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('surfaces the backend self-guard message on a 403 approve', async () => {
    mockApproveMatch.mockResolvedValue({
      success: false,
      error: 'Brokers cannot review a match they are a party to.',
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Alice Member')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Approve Match' }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Brokers cannot review a match they are a party to.');
    });
  });

  it('opens the reject modal and requires a reason before submitting', async () => {
    mockRejectMatch.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Alice Member')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Reject Match' }));

    const textarea = await screen.findByLabelText(/rejection reason/i);
    // Submit disabled while reason is empty
    const submitButtons = screen.getAllByRole('button', { name: 'Reject Match' });
    const modalSubmit = submitButtons[submitButtons.length - 1];
    expect(modalSubmit).toBeDisabled();

    await user.type(textarea, 'Too far apart');
    expect(modalSubmit).not.toBeDisabled();

    await user.click(modalSubmit);
    await waitFor(() => {
      expect(mockRejectMatch).toHaveBeenCalledWith(11, 'Too far apart');
    });
  });

  it('shows the all-caught-up empty state when the pending queue is empty', async () => {
    mockGetApprovals.mockResolvedValue({ success: true, data: [], meta: { current_page: 1, per_page: 20, total: 0, total_pages: 0, has_more: false } });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No matches waiting')).toBeInTheDocument();
    });
  });
});
