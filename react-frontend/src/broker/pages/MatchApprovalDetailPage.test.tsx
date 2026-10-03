// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { createMockContexts } from '@/test/mock-contexts';

const mockGetApproval = vi.hoisted(() => vi.fn());
const mockApproveMatch = vi.hoisted(() => vi.fn());
const mockRejectMatch = vi.hoisted(() => vi.fn());

vi.mock('@/admin/api/adminApi', () => ({
  adminMatching: {
    getApproval: mockGetApproval,
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

vi.mock('@/lib/serverTime', () => ({
  formatServerDate: (v: string) => `server:${v}`,
  formatServerDateTime: (v: string) => `server-dt:${v}`,
}));

import { MatchApprovalDetailPage } from './MatchApprovalDetailPage';

const DETAIL = {
  id: 11,
  user_1_id: 1,
  user_1_name: 'Alice Member',
  user_1_email: 'alice@example.com',
  user_1_avatar: null,
  user_1_bio: 'Loves gardening',
  user_1_location: 'Northside',
  user_2_id: 2,
  user_2_name: 'Bob Owner',
  user_2_email: 'bob@example.com',
  user_2_avatar: null,
  user_2_bio: null,
  user_2_location: null,
  listing_id: 5,
  listing_title: 'Garden help wanted',
  listing_type: 'request',
  listing_status: 'active',
  listing_description: 'Weekly weeding',
  category_name: 'Gardening',
  match_score: 91,
  match_type: 'one_way',
  match_reasons: ['Category match', 'Nearby'],
  distance_km: 2.4,
  status: 'pending' as const,
  notes: null,
  created_at: '2026-06-30T10:00:00Z',
  reviewed_at: null,
  reviewer_id: null,
  reviewer_name: null,
};

function renderPage(id = '11') {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[`/test/broker/match-approvals/${id}`]}>
        <Routes>
          <Route path="/test/broker/match-approvals/:id" element={<MatchApprovalDetailPage />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe('MatchApprovalDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetApproval.mockResolvedValue({ success: true, data: DETAIL });
  });

  it('renders the score gauge, quality label and match reasons', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('91%')).toBeInTheDocument();
      expect(screen.getByText('Excellent match')).toBeInTheDocument();
      expect(screen.getByText('Category match')).toBeInTheDocument();
      expect(screen.getByText('Nearby')).toBeInTheDocument();
    });
  });

  it('renders both party cards and the associated listing', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Alice Member')).toBeInTheDocument();
      expect(screen.getByText('Bob Owner')).toBeInTheDocument();
      expect(screen.getByText('Garden help wanted')).toBeInTheDocument();
      expect(screen.getByText('Gardening')).toBeInTheDocument();
    });
  });

  it('approves a pending match from the decision bar', async () => {
    mockApproveMatch.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('91%')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Approve Match' }));

    await waitFor(() => {
      expect(mockApproveMatch).toHaveBeenCalledWith(11);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows review details instead of the decision bar once reviewed', async () => {
    mockGetApproval.mockResolvedValue({
      success: true,
      data: {
        ...DETAIL,
        status: 'rejected',
        reviewed_at: '2026-07-01T09:00:00Z',
        reviewer_name: 'Rita Broker',
        notes: 'Too far apart',
      },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Review Details')).toBeInTheDocument();
      expect(screen.getByText('Rita Broker')).toBeInTheDocument();
      expect(screen.getByText('Too far apart')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Approve Match' })).not.toBeInTheDocument();
  });

  it('renders an honest not-found state when the load fails', async () => {
    mockGetApproval.mockResolvedValue({ success: false, error: 'Not found' });
    renderPage('999');
    await waitFor(() => {
      expect(screen.getByText('Match not found')).toBeInTheDocument();
    });
  });

  // A thrown request used to escape the loader and leave the skeleton up for
  // ever. Now it is a distinct error with a Retry.
  it('shows an error state with Retry when the request throws, and reloads on Retry', async () => {
    mockGetApproval
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ success: true, data: DETAIL });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Failed to load match approval')).toBeInTheDocument();
    expect(screen.queryByText('Match not found')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('91%')).toBeInTheDocument());
    expect(mockGetApproval).toHaveBeenCalledTimes(2);
  });

  it('keeps the reject modal and the typed reason open when the request fails', async () => {
    mockRejectMatch.mockResolvedValue({ success: false, error: 'Server said no' });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('91%')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Reject Match' }));
    await user.type(await screen.findByLabelText(/rejection reason/i), 'Too far apart');
    const submitButtons = screen.getAllByRole('button', { name: 'Reject Match' });
    await user.click(submitButtons[submitButtons.length - 1] as HTMLElement);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Server said no'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/rejection reason/i)).toHaveValue('Too far apart');
  });

  it('does not leave the approve button spinning when the approve request throws', async () => {
    mockApproveMatch.mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('91%')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Approve Match' }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Failed to approve match'));
    expect(screen.getByRole('button', { name: 'Approve Match' })).not.toHaveAttribute('aria-busy', 'true');
  });

  it('describes the page and links to its guide article', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('91%')).toBeInTheDocument());
    expect(
      screen.getByText('Check why these two were matched, then approve or reject before the member is told.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'How this page works' })).toHaveAttribute(
      'href',
      '/test/broker/help/broker_exchanges/broker_match_approvals',
    );
  });

  it('translates the listing type instead of printing the raw slug', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('91%')).toBeInTheDocument());
    expect(screen.getByText('Request')).toBeInTheDocument();
    expect(screen.queryByText('request')).not.toBeInTheDocument();
  });

  it('shows the review time in server time', async () => {
    mockGetApproval.mockResolvedValue({
      success: true,
      data: { ...DETAIL, status: 'approved', reviewed_at: '2026-07-01T09:00:00Z', reviewer_name: 'Rita Broker' },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('server-dt:2026-07-01T09:00:00Z')).toBeInTheDocument());
  });
});
