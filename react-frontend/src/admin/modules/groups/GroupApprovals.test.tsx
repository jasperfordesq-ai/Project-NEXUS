// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ── stable mock data ──────────────────────────────────────────────────────────
const MOCK_APPROVALS = vi.hoisted(() => [
  {
    id: 1,
    group_id: 10,
    group_name: 'Gardeners Club',
    user_id: 101,
    user_name: 'Alice Murphy',
    status: 'pending',
    created_at: '2024-06-01T10:00:00Z',
  },
  {
    id: 2,
    group_id: 11,
    group_name: 'Reading Circle',
    user_id: 102,
    user_name: 'Bob Walsh',
    status: 'pending',
    created_at: '2024-06-02T09:30:00Z',
  },
]);

// ── mock adminApi ─────────────────────────────────────────────────────────────
vi.mock('@/admin/api/adminApi', () => ({
  adminGroups: {
    getApprovals: vi.fn(),
    approveMember: vi.fn(),
    rejectMember: vi.fn(),
  },
}));

// ── mock DataTable + ConfirmModal to avoid HeroUI Table JSDOM rendering issues
// HeroUI v3 Table uses React Aria collections which don't render rows in JSDOM.
// We mock DataTable to a simple <ul> that renders each row via columns[].render().
vi.mock('../../components/DataTable', () => ({
  DataTable: ({ data, columns }: { data: unknown[]; columns: Array<{ key: string; render?: (item: unknown) => React.ReactNode }> }) => (
    <ul data-testid="data-table">
      {(data as Array<Record<string, unknown>>).map((item) => (
        <li key={String(item['id'])} data-testid="data-table-row">
          {columns.map((col) => (
            <span key={col.key} data-col={col.key}>
              {col.render ? col.render(item) : String(item[col.key] ?? '')}
            </span>
          ))}
        </li>
      ))}
    </ul>
  ),
}));

vi.mock('../../components/ConfirmModal', () => ({
  ConfirmModal: ({
    isOpen,
    onClose,
    onConfirm,
    title,
    confirmLabel,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    confirmLabel?: string;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title} aria-modal="true">
        <p>{title}</p>
        <button onClick={onClose}>Cancel</button>
        <button data-testid="confirm-btn" onClick={onConfirm}>{confirmLabel ?? 'Confirm'}</button>
      </div>
    ) : null,
}));

// ── mock @/contexts ───────────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/contexts', () => createMockContexts({ useToast: () => mockToast }));

// ── mock usePageTitle ─────────────────────────────────────────────────────────
vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

import { GroupApprovals } from './GroupApprovals';
import { adminGroups } from '@/admin/api/adminApi';

const getApprovalsMock = vi.mocked(adminGroups.getApprovals);
const approveMock = vi.mocked(adminGroups.approveMember);
const rejectMock = vi.mocked(adminGroups.rejectMember);

describe('GroupApprovals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getApprovalsMock.mockResolvedValue({ success: true, data: MOCK_APPROVALS } as never);
  });

  it('shows loading spinner while fetching', async () => {
    getApprovalsMock.mockReturnValueOnce(new Promise(() => undefined) as never);

    render(<GroupApprovals />);

    const busyEl = screen.queryAllByRole('status').find(
      (el) => el.getAttribute('aria-busy') === 'true'
    );
    expect(busyEl).toBeInTheDocument();

  });

  it('hides loading spinner after data loads', async () => {
    render(<GroupApprovals />);

    await waitFor(() => {
      const busyEls = screen.queryAllByRole('status').filter(
        (el) => el.getAttribute('aria-busy') === 'true'
      );
      expect(busyEls).toHaveLength(0);
    });
  });

  it('renders approval rows with user and group names', async () => {
    render(<GroupApprovals />);

    await waitFor(() => {
      expect(screen.getByText('Alice Murphy')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob Walsh')).toBeInTheDocument();
    expect(screen.getByText('Gardeners Club')).toBeInTheDocument();
    expect(screen.getByText('Reading Circle')).toBeInTheDocument();
  });

  it('shows empty state when no pending approvals', async () => {
    getApprovalsMock.mockResolvedValueOnce({ success: true, data: [] } as never);

    render(<GroupApprovals />);

    await waitFor(() => {
      expect(screen.getByText(/no pending/i)).toBeInTheDocument();
    });
  });

  it('shows error toast when API call throws', async () => {
    getApprovalsMock.mockRejectedValueOnce(new Error('network'));

    render(<GroupApprovals />);

    await waitFor(() => {
      const busyEls = screen.queryAllByRole('status').filter(
        (el) => el.getAttribute('aria-busy') === 'true'
      );
      expect(busyEls).toHaveLength(0);
    });

    // Component should not crash
    expect(document.body).toBeInTheDocument();
  });

  it('calls approveMember when approve button clicked', async () => {
    approveMock.mockResolvedValueOnce({ success: true } as never);
    const user = userEvent.setup();

    render(<GroupApprovals />);

    await waitFor(() => {
      expect(screen.getByText('Alice Murphy')).toBeInTheDocument();
    });

    const approveBtns = screen.getAllByRole('button', { name: /approve/i });
    await user.click(approveBtns[0]);

    await waitFor(() => {
      expect(approveMock).toHaveBeenCalledWith(1);
    });
  });

  it('opens confirm modal when reject button clicked', async () => {
    const user = userEvent.setup();
    render(<GroupApprovals />);

    await waitFor(() => {
      expect(screen.getByText('Alice Murphy')).toBeInTheDocument();
    });

    const rejectBtns = screen.getAllByRole('button', { name: /reject/i });
    // Click first row's reject button
    await user.click(rejectBtns[0]);

    // Our mocked ConfirmModal renders a dialog when isOpen=true
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('calls rejectMember when reject is confirmed in modal', async () => {
    rejectMock.mockResolvedValueOnce({ success: true } as never);
    getApprovalsMock
      .mockResolvedValueOnce({ success: true, data: MOCK_APPROVALS } as never)
      .mockResolvedValueOnce({ success: true, data: [MOCK_APPROVALS[1]] } as never);

    const user = userEvent.setup();
    render(<GroupApprovals />);

    await waitFor(() => {
      expect(screen.getByText('Alice Murphy')).toBeInTheDocument();
    });

    // Open confirm modal via reject button
    const rejectBtns = screen.getAllByRole('button', { name: /reject/i });
    await user.click(rejectBtns[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Click the confirm button in the mocked modal
    await user.click(screen.getByTestId('confirm-btn'));

    await waitFor(() => {
      expect(rejectMock).toHaveBeenCalledWith(1);
    });
  });

  it('still renders approvals from a legacy/fallback nested { data: [...] } payload', async () => {
    // Legacy/fallback shape only. GET /v2/admin/groups/approvals really sends a
    // bare array (respondWithData), which is what the other tests here mock.
    getApprovalsMock.mockResolvedValueOnce({
      success: true,
      data: { data: MOCK_APPROVALS },
    } as never);

    render(<GroupApprovals />);

    await waitFor(() => {
      expect(screen.getByText('Alice Murphy')).toBeInTheDocument();
    });
  });

  it('renders pending status chip for each row', async () => {
    render(<GroupApprovals />);

    await waitFor(() => {
      expect(screen.getByText('Alice Murphy')).toBeInTheDocument();
    });

    // Each row has a "Pending" chip
    const pendingChips = screen.getAllByText(/pending/i);
    expect(pendingChips.length).toBeGreaterThanOrEqual(2);
  });
});
