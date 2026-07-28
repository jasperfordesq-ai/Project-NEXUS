// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── stable mock data ──────────────────────────────────────────────────────────

const MOCK_APPLICATIONS = vi.hoisted(() => [
  {
    id: 1,
    user_id: 10,
    first_name: 'Alice',
    last_name: 'Volunteer',
    email: 'alice@example.com',
    opportunity_title: 'Community Gardening',
    status: 'pending',
    created_at: '2026-06-01T10:00:00Z',
  },
  {
    id: 2,
    user_id: 11,
    first_name: 'Bob',
    last_name: 'Helper',
    email: 'bob@example.com',
    opportunity_title: 'Meals on Wheels',
    status: 'approved',
    created_at: '2026-05-28T09:00:00Z',
  },
  {
    id: 3,
    user_id: 12,
    first_name: 'Carol',
    last_name: 'Applicant',
    email: 'carol@example.com',
    opportunity_title: 'Community Gardening',
    status: 'declined',
    created_at: '2026-05-20T14:00:00Z',
  },
]);

// ── adminApi mock ─────────────────────────────────────────────────────────────

const mockGetApprovals = vi.hoisted(() => vi.fn());
const mockApproveApp = vi.hoisted(() => vi.fn());
const mockDeclineApp = vi.hoisted(() => vi.fn());

vi.mock('../../api/adminApi', () => ({
  adminVolunteering: {
    getApprovals: mockGetApprovals,
    approveApplication: mockApproveApp,
    declineApplication: mockDeclineApp,
  },
}));

// ── contexts ──────────────────────────────────────────────────────────────────

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => mockToast,
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── hooks ─────────────────────────────────────────────────────────────────────

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ── admin components ──────────────────────────────────────────────────────────

// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/DataTable' (and friends) directly, and vitest keys
// mocks per resolved module, so a barrel-only mock never installs for those
// imports — the real components rendered and the stub testids were never in the
// DOM. A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run.
// NOTE: '../../components/ConfirmModal' is deliberately NOT bound here — this
// factory returns no ConfirmModal stub, and vitest throws on a missing export.
function adminComponentsMock() {
  return {
    DataTable: ({
      data,
      columns,
      isLoading,
      topContent,
    }: {
      data: Array<Record<string, unknown>>;
      columns: Array<{ key: string; label: string; render?: (item: Record<string, unknown>) => React.ReactNode }>;
      isLoading?: boolean;
      topContent?: React.ReactNode;
    }) => (
      <div data-testid="data-table">
        {topContent}
        {isLoading ? (
          <div role="status" aria-busy="true">Loading...</div>
        ) : (
          <ul>
            {data.map((item) => (
              <li key={item.id as number} data-testid={`row-${item.id}`}>
                {columns.map((col) => (
                  <span key={col.key} data-testid={`cell-${item.id}-${col.key}`}>
                    {col.render ? col.render(item) : String(item[col.key] ?? '')}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    ),
    PageHeader: ({ title, description }: { title: string; description?: string }) => (
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
    ),
    EmptyState: ({ title }: { title: string }) => (
      <div data-testid="empty-state">{title}</div>
    ),
    StatusBadge: ({ status }: { status: string }) => (
      <span data-testid="status-badge">{status}</span>
    ),
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/DataTable', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/EmptyState', adminComponentsMock);

// ── import after mocks ────────────────────────────────────────────────────────

import { VolunteerApprovals } from './VolunteerApprovals';

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('VolunteerApprovals', () => {
  beforeEach(() => {
    // resetAllMocks clears both calls AND pending once-implementations,
    // preventing leftover mockResolvedValueOnce from leaking across tests.
    vi.resetAllMocks();
    mockApproveApp.mockResolvedValue({ success: true });
    mockDeclineApp.mockResolvedValue({ success: true });
  });

  it('shows loading state initially', () => {
    mockGetApprovals.mockReturnValue(new Promise(() => {}));
    render(<VolunteerApprovals />);
    const loadingEl = screen.queryByRole('status', { name: undefined });
    // DataTable receives isLoading=true → shows loading indicator
    expect(loadingEl || document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('renders applicant names after load', async () => {
    mockGetApprovals.mockResolvedValueOnce({ success: true, data: MOCK_APPLICATIONS });
    render(<VolunteerApprovals />);
    // The column render shows "FirstName LastName" combined — use regex to find
    await waitFor(() => {
      expect(screen.getByText(/Alice Volunteer/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Bob Helper/i)).toBeInTheDocument();
  });

  it('renders opportunity titles', async () => {
    mockGetApprovals.mockResolvedValueOnce({ success: true, data: MOCK_APPLICATIONS });
    render(<VolunteerApprovals />);
    await waitFor(() => {
      // Multiple elements may contain 'Community Gardening' (rows + filter dropdown)
      const matches = screen.getAllByText(/Community Gardening/);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('renders status badges', async () => {
    mockGetApprovals.mockResolvedValueOnce({ success: true, data: MOCK_APPLICATIONS });
    render(<VolunteerApprovals />);
    await waitFor(() => {
      const badges = screen.getAllByTestId('status-badge');
      const statuses = badges.map((b) => b.textContent);
      expect(statuses).toContain('pending');
      expect(statuses).toContain('approved');
      expect(statuses).toContain('declined');
    });
  });

  it('renders Approve button for pending application', async () => {
    mockGetApprovals.mockResolvedValueOnce({ success: true, data: MOCK_APPLICATIONS });
    render(<VolunteerApprovals />);
    await waitFor(() => {
      const approveBtns = screen.getAllByRole('button').filter(
        (b) => /approve/i.test(b.textContent ?? ''),
      );
      expect(approveBtns.length).toBeGreaterThan(0);
    });
  });

  it('renders Decline button for pending application', async () => {
    mockGetApprovals.mockResolvedValueOnce({ success: true, data: MOCK_APPLICATIONS });
    render(<VolunteerApprovals />);
    await waitFor(() => {
      const declineBtns = screen.getAllByRole('button').filter(
        (b) => /decline/i.test(b.textContent ?? ''),
      );
      expect(declineBtns.length).toBeGreaterThan(0);
    });
  });

  it('calls POST approve endpoint on Approve click and shows success toast', async () => {
    mockGetApprovals
      .mockResolvedValueOnce({ success: true, data: MOCK_APPLICATIONS })
      .mockResolvedValueOnce({ success: true, data: MOCK_APPLICATIONS }); // reload after approve
    render(<VolunteerApprovals />);
    await waitFor(() => {
      expect(screen.getAllByRole('button').some((b) => /approve/i.test(b.textContent ?? ''))).toBe(true);
    });
    const approveBtns = screen.getAllByRole('button').filter(
      (b) => /approve/i.test(b.textContent ?? ''),
    );
    await userEvent.click(approveBtns[0]);
    await waitFor(() => {
      expect(mockApproveApp).toHaveBeenCalledWith(1); // id of the pending application
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('confirms before declining, then calls POST decline and shows success toast (VOL-RX-010)', async () => {
    mockGetApprovals
      .mockResolvedValueOnce({ success: true, data: MOCK_APPLICATIONS })
      .mockResolvedValueOnce({ success: true, data: MOCK_APPLICATIONS });
    render(<VolunteerApprovals />);
    await waitFor(() => {
      expect(screen.getAllByRole('button').some((b) => /decline/i.test(b.textContent ?? ''))).toBe(true);
    });

    // The row Decline button opens a confirmation and must NOT decline immediately.
    const rowDecline = screen.getAllByRole('button').filter(
      (b) => /decline/i.test(b.textContent ?? ''),
    )[0];
    await userEvent.click(rowDecline);
    expect(mockDeclineApp).not.toHaveBeenCalled();

    // Confirm inside the dialog to actually decline.
    const dialog = await screen.findByRole('dialog');
    const confirmBtn = within(dialog).getAllByRole('button').filter(
      (b) => /decline/i.test(b.textContent ?? ''),
    )[0];
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockDeclineApp).toHaveBeenCalledWith(1);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when approve fails', async () => {
    mockApproveApp.mockResolvedValueOnce({ success: false });
    mockGetApprovals
      .mockResolvedValueOnce({ success: true, data: MOCK_APPLICATIONS })
      .mockResolvedValueOnce({ success: true, data: MOCK_APPLICATIONS });
    render(<VolunteerApprovals />);
    await waitFor(() => {
      expect(screen.getAllByRole('button').some((b) => /approve/i.test(b.textContent ?? ''))).toBe(true);
    });
    const approveBtns = screen.getAllByRole('button').filter(
      (b) => /approve/i.test(b.textContent ?? ''),
    );
    await userEvent.click(approveBtns[0]);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows error toast when getApprovals throws', async () => {
    mockGetApprovals.mockRejectedValueOnce(new Error('network'));
    render(<VolunteerApprovals />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows empty state when no applications exist', async () => {
    mockGetApprovals.mockResolvedValueOnce({ success: true, data: [] });
    render(<VolunteerApprovals />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders status tabs (All, Pending, Approved, Declined)', async () => {
    mockGetApprovals.mockResolvedValueOnce({ success: true, data: MOCK_APPLICATIONS });
    render(<VolunteerApprovals />);
    await waitFor(() => {
      const tabs = screen.getAllByRole('tab');
      const tabLabels = tabs.map((t) => t.textContent ?? '');
      expect(tabLabels.some((l) => /all/i.test(l))).toBe(true);
      expect(tabLabels.some((l) => /pending/i.test(l))).toBe(true);
    });
  });

  it('filters to pending only when Pending tab clicked', async () => {
    mockGetApprovals.mockResolvedValueOnce({ success: true, data: MOCK_APPLICATIONS });
    render(<VolunteerApprovals />);
    await waitFor(() => {
      expect(screen.getAllByTestId('status-badge').length).toBeGreaterThan(0);
    });
    const pendingTab = screen.getAllByRole('tab').find(
      (t) => /pending/i.test(t.textContent ?? ''),
    );
    if (pendingTab) {
      await userEvent.click(pendingTab);
      await waitFor(() => {
        // After filtering to pending only, approved/declined rows are hidden
        const badges = screen.getAllByTestId('status-badge');
        const shown = badges.map((b) => b.textContent);
        expect(shown.every((s) => s === 'pending')).toBe(true);
      });
    }
  });

  it('renders Export button', async () => {
    mockGetApprovals.mockResolvedValueOnce({ success: true, data: MOCK_APPLICATIONS });
    render(<VolunteerApprovals />);
    await waitFor(() => {
      const exportBtn = screen.getAllByRole('button').find(
        (b) => /export/i.test(b.textContent ?? ''),
      );
      expect(exportBtn).toBeInTheDocument();
    });
  });

  // ── Bulk actions are gated behind a confirmation modal ──────────────────────

  async function selectFirstPendingRow() {
    mockGetApprovals.mockResolvedValue({ success: true, data: MOCK_APPLICATIONS });
    render(<VolunteerApprovals />);
    await waitFor(() => {
      expect(screen.getByText(/Alice Volunteer/i)).toBeInTheDocument();
    });
    // Only pending rows render a selection checkbox (application id 1)
    const rowCheckbox = screen.getAllByRole('checkbox').find(
      (c) => c.getAttribute('aria-label')?.toLowerCase().includes('select application'),
    ) ?? screen.getAllByRole('checkbox')[0];
    expect(rowCheckbox).toBeDefined();
    await userEvent.click(rowCheckbox!);
  }

  it('bulk approve opens a confirmation modal and does NOT call the API until confirmed', async () => {
    await selectFirstPendingRow();

    const bulkApproveBtn = screen.getAllByRole('button').find(
      (b) => /approve \(\d+\)/i.test(b.textContent ?? ''),
    );
    expect(bulkApproveBtn).toBeDefined();
    await userEvent.click(bulkApproveBtn!);

    // Confirmation modal appears; the API has NOT fired yet
    await waitFor(() => {
      expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0);
    });
    expect(mockApproveApp).not.toHaveBeenCalled();

    // Confirm inside the dialog fires the bulk approve
    const dialog = screen.getAllByRole('dialog')[0]!;
    const confirmBtn = Array.from(dialog.querySelectorAll('button')).find(
      (b) => /approve/i.test(b.textContent ?? ''),
    );
    expect(confirmBtn).toBeDefined();
    await userEvent.click(confirmBtn!);

    await waitFor(() => {
      expect(mockApproveApp).toHaveBeenCalledWith(1);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('bulk decline opens a confirmation modal and does NOT call the API until confirmed', async () => {
    await selectFirstPendingRow();

    const bulkDeclineBtn = screen.getAllByRole('button').find(
      (b) => /decline \(\d+\)/i.test(b.textContent ?? ''),
    );
    expect(bulkDeclineBtn).toBeDefined();
    await userEvent.click(bulkDeclineBtn!);

    await waitFor(() => {
      expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0);
    });
    expect(mockDeclineApp).not.toHaveBeenCalled();

    const dialog = screen.getAllByRole('dialog')[0]!;
    const confirmBtn = Array.from(dialog.querySelectorAll('button')).find(
      (b) => /decline/i.test(b.textContent ?? ''),
    );
    expect(confirmBtn).toBeDefined();
    await userEvent.click(confirmBtn!);

    await waitFor(() => {
      expect(mockDeclineApp).toHaveBeenCalledWith(1);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('cancelling the bulk decline confirmation does not call the API', async () => {
    await selectFirstPendingRow();

    const bulkDeclineBtn = screen.getAllByRole('button').find(
      (b) => /decline \(\d+\)/i.test(b.textContent ?? ''),
    );
    await userEvent.click(bulkDeclineBtn!);

    await waitFor(() => {
      expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0);
    });

    const dialog = screen.getAllByRole('dialog')[0]!;
    const cancelBtn = Array.from(dialog.querySelectorAll('button')).find(
      (b) => /cancel/i.test(b.textContent ?? ''),
    );
    expect(cancelBtn).toBeDefined();
    await userEvent.click(cancelBtn!);

    await waitFor(() => {
      expect(screen.queryAllByRole('dialog').length).toBe(0);
    });
    expect(mockDeclineApp).not.toHaveBeenCalled();
    expect(mockApproveApp).not.toHaveBeenCalled();
  });
});
