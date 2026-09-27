// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

const { mockAdminTimebanking, mockToast } = vi.hoisted(() => ({
  mockAdminTimebanking: {
    getUserReport: vi.fn(),
    adjustBalance: vi.fn(),
    downloadStatementCsv: vi.fn(),
  },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/admin/api/adminApi', () => ({ adminTimebanking: mockAdminTimebanking }));

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);

vi.mock('@/admin/AdminMetaContext', () => ({ useAdminPageMeta: vi.fn() }));

vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return { ...actual, resolveAvatarUrl: (url: string | null) => url || null };
});

const USERS = [
  {
    id: 1,
    name: 'Alice Test',
    email: 'alice@test.com',
    avatar_url: null,
    balance: 10,
    total_earned: 20,
    total_spent: 10,
    transaction_count: 5,
  },
  {
    id: 2,
    name: 'Bob Test',
    email: 'bob@test.com',
    avatar_url: null,
    balance: 0,
    total_earned: 0,
    total_spent: 0,
    transaction_count: 0,
  },
];

import { UserReport } from './UserReport';

describe('UserReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mirrors what the shared api client (src/lib/api.ts) really resolves with for
    // paginated endpoints: `data` is the bare row array and pagination lives on the
    // sibling `meta`. Earlier fixtures nested `meta` inside `data`, a shape the
    // client never produces for these endpoints.
    mockAdminTimebanking.getUserReport.mockResolvedValue({
      success: true,
      data: USERS, meta: { current_page: 1, per_page: 20, total: 2, total_pages: 1, has_more: false },
    });
    mockAdminTimebanking.adjustBalance.mockResolvedValue({ success: true });
    mockAdminTimebanking.downloadStatementCsv.mockResolvedValue(undefined);
  });

  it('does not show user rows during initial loading', () => {
    mockAdminTimebanking.getUserReport.mockReturnValue(new Promise(() => {}));
    render(<UserReport />);
    expect(screen.queryByText('Alice Test')).toBeNull();
  });

  it('renders user rows after data loads', async () => {
    render(<UserReport />);
    await waitFor(() => {
      expect(screen.getByText('Alice Test')).toBeInTheDocument();
      expect(screen.getByText('Bob Test')).toBeInTheDocument();
    });
  });

  it('shows balance formatted with h suffix', async () => {
    render(<UserReport />);
    await waitFor(() => {
      expect(screen.getByText('10h')).toBeInTheDocument();
    });
  });

  it('shows empty state when no users returned', async () => {
    mockAdminTimebanking.getUserReport.mockResolvedValue({
      success: true,
      data: [], meta: { current_page: 1, per_page: 20, total: 0, total_pages: 0, has_more: false },
    });

    render(<UserReport />);

    await waitFor(() => {
      expect(screen.getByText(/no users found/i)).toBeInTheDocument();
    });
  });

  it('opens adjust balance modal when Adjust button is clicked', async () => {
    render(<UserReport />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /adjust/i }).length).toBeGreaterThan(0);
    });

    await userEvent.click(screen.getAllByRole('button', { name: /adjust/i })[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('shows toast error when adjust submitted with no amount', async () => {
    render(<UserReport />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /adjust/i }).length).toBeGreaterThan(0);
    });

    await userEvent.click(screen.getAllByRole('button', { name: /adjust/i })[0]);
    await waitFor(() => { expect(screen.getByRole('dialog')).toBeInTheDocument(); });

    await userEvent.click(screen.getByRole('button', { name: /adjust balance/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(mockAdminTimebanking.adjustBalance).not.toHaveBeenCalled();
  });

  it('shows toast error when reason is empty', async () => {
    render(<UserReport />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /adjust/i }).length).toBeGreaterThan(0);
    });

    await userEvent.click(screen.getAllByRole('button', { name: /adjust/i })[0]);
    await waitFor(() => { expect(screen.getByRole('dialog')).toBeInTheDocument(); });

    // Enter amount but no reason
    const amountInput = screen.getByRole('spinbutton');
    await userEvent.type(amountInput, '5');

    await userEvent.click(screen.getByRole('button', { name: /adjust balance/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('submits adjustBalance with correct params', async () => {
    render(<UserReport />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /adjust/i }).length).toBeGreaterThan(0);
    });

    await userEvent.click(screen.getAllByRole('button', { name: /adjust/i })[0]);
    await waitFor(() => { expect(screen.getByRole('dialog')).toBeInTheDocument(); });

    const amountInput = screen.getByRole('spinbutton');
    await userEvent.type(amountInput, '5');

    const allTextboxes = screen.getAllByRole('textbox');
    await userEvent.type(allTextboxes[allTextboxes.length - 1], 'Test adjustment');

    await userEvent.click(screen.getByRole('button', { name: /adjust balance/i }));

    await waitFor(() => {
      expect(mockAdminTimebanking.adjustBalance).toHaveBeenCalledWith(1, 5, 'Test adjustment');
    });
  });

  it('shows success toast after successful balance adjustment', async () => {
    render(<UserReport />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /adjust/i }).length).toBeGreaterThan(0);
    });

    await userEvent.click(screen.getAllByRole('button', { name: /adjust/i })[0]);
    await waitFor(() => { expect(screen.getByRole('dialog')).toBeInTheDocument(); });

    const amountInput = screen.getByRole('spinbutton');
    await userEvent.type(amountInput, '5');

    const allTextboxes = screen.getAllByRole('textbox');
    await userEvent.type(allTextboxes[allTextboxes.length - 1], 'Test');

    await userEvent.click(screen.getByRole('button', { name: /adjust balance/i }));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('closes modal on cancel', async () => {
    render(<UserReport />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /adjust/i }).length).toBeGreaterThan(0);
    });

    await userEvent.click(screen.getAllByRole('button', { name: /adjust/i })[0]);
    await waitFor(() => { expect(screen.getByRole('dialog')).toBeInTheDocument(); });

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
