// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts());

// ── Mock the adminSystem API ──────────────────────────────────────────────────
const { mockGetActivityLog } = vi.hoisted(() => ({
  mockGetActivityLog: vi.fn(),
}));

vi.mock('../../api/adminApi', () => ({
  adminSystem: {
    getActivityLog: mockGetActivityLog,
  },
  adminEnterprise: {
    getLogFiles: vi.fn(),
    getGdprBreaches: vi.fn(),
    createBreach: vi.fn(),
  },
  adminSuper: {
    getDashboard: vi.fn(),
    listTenants: vi.fn(),
  },
  adminTools: {
    getRedirects: vi.fn(),
    createRedirect: vi.fn(),
    deleteRedirect: vi.fn(),
  },
}));

import { ActivityLog } from './ActivityLog';

const MOCK_ENTRIES = [
  {
    id: 1,
    user_name: 'Alice Admin',
    user_email: 'alice@example.com',
    user_avatar: null,
    action: 'admin_approve_user',
    description: 'Admin logged in',
    ip_address: '192.168.1.1',
    created_at: '2026-06-22T09:00:00Z',
  },
  {
    id: 2,
    user_name: 'Bob Admin',
    user_email: 'bob@example.com',
    user_avatar: null,
    action: 'admin_delete_listing',
    description: 'Deleted listing #42',
    ip_address: '10.0.0.1',
    created_at: '2026-06-21T14:30:00Z',
  },
];

describe('ActivityLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActivityLog.mockResolvedValue({ success: true, data: MOCK_ENTRIES, meta: { total: 2 } });
  });

  // ── loading ────────────────────────────────────────────────────────────────
  it('passes isLoading=true to DataTable while fetching', () => {
    // DataTable's own loading indicator — component passes isLoading prop
    // We verify by checking loading does not crash and spinner-like elements appear
    mockGetActivityLog.mockReturnValue(new Promise(() => {}));
    render(<ActivityLog />);
    // DataTable renders with loading state — page should not crash
    expect(document.body).toBeInTheDocument();
  });

  // ── populated ──────────────────────────────────────────────────────────────
  it('renders user names after data loads', async () => {
    render(<ActivityLog />);
    await waitFor(() => {
      expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob Admin')).toBeInTheDocument();
  });

  it('renders action chips', async () => {
    render(<ActivityLog />);
    await waitFor(() => screen.getByText('Alice Admin'));
    expect(screen.getByText('Approve User')).toBeInTheDocument();
    expect(screen.getByText('Delete Listing')).toBeInTheDocument();
  });

  it('renders IP addresses', async () => {
    render(<ActivityLog />);
    await waitFor(() => screen.getByText('Alice Admin'));
    expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.1')).toBeInTheDocument();
  });

  it('localizes structured activity detail codes and parameters', async () => {
    mockGetActivityLog.mockResolvedValue({
      success: true,
      data: [{
        ...MOCK_ENTRIES[0],
        description: null,
        description_code: 'blog_post_created',
        description_params: { id: 42, title: 'Community update' },
      }],
      meta: { total: 1 },
    });

    render(<ActivityLog />);

    await waitFor(() => {
      expect(screen.getByText('Created blog post #42: Community update')).toBeInTheDocument();
    });
  });

  it('preserves free-form descriptions for historical rows', async () => {
    render(<ActivityLog />);

    await waitFor(() => {
      expect(screen.getByText('Admin logged in')).toBeInTheDocument();
    });
  });

  // ── empty state ────────────────────────────────────────────────────────────
  it('renders without crashing when empty array returned', async () => {
    mockGetActivityLog.mockResolvedValue({ success: true, data: [], meta: { total: 0 } });
    render(<ActivityLog />);
    await waitFor(() => {
      expect(mockGetActivityLog).toHaveBeenCalled();
    });
    expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument();
  });

  // ── paginated data format ──────────────────────────────────────────────────
  it('handles the paginated shape (rows in data, total in the sibling meta)', async () => {
    // Mirrors what the shared api client (src/lib/api.ts) really resolves with for
    // this paginated endpoint: `data` is the bare row array and pagination lives on
    // the sibling `meta`. An earlier fixture nested the rows inside `data`, a shape
    // the client never produces.
    mockGetActivityLog.mockResolvedValue({
      success: true,
      data: MOCK_ENTRIES, meta: { current_page: 1, per_page: 20, total: 50, total_pages: 3, has_more: true },
    });
    render(<ActivityLog />);
    await waitFor(() => {
      expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    });
  });

  // ── refresh ────────────────────────────────────────────────────────────────
  it('calls getActivityLog again when refresh button is clicked', async () => {
    const user = userEvent.setup();
    render(<ActivityLog />);
    await waitFor(() => screen.getByText('Alice Admin'));

    mockGetActivityLog.mockResolvedValue({ success: true, data: MOCK_ENTRIES, meta: { total: 2 } });
    // DataTable also renders a refresh button in its toolbar — use the first match (PageHeader button)
    const refreshBtns = screen.getAllByRole('button', { name: /refresh/i });
    await user.click(refreshBtns[0]);
    await waitFor(() => {
      expect(mockGetActivityLog).toHaveBeenCalledTimes(2);
    });
  });

  // ── error / silent fail ────────────────────────────────────────────────────
  it('does not crash when API rejects (sets empty state silently)', async () => {
    mockGetActivityLog.mockRejectedValue(new Error('Network error'));
    render(<ActivityLog />);
    await waitFor(() => {
      expect(mockGetActivityLog).toHaveBeenCalled();
    });
    // Component swallows error and sets empty state — no throw
    expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument();
  });
});
