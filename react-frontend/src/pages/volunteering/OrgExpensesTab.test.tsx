// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for OrgExpensesTab — the organisation's own expense-claim review queue.
 *
 * Focus: only the next steps the server accepts are offered (pending →
 * approve/reject, approved → mark as paid, rejected/paid → nothing), a reviewer
 * never sees actions on their own claim, and a claim someone else already
 * handled (409 INVALID_STATE) is explained and the list reloaded.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

const { toastMock, authState } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  authState: { user: { id: 99, name: 'Org Admin' } as { id: number; name: string } | null },
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    download: vi.fn(),
  },
}));

vi.mock('@/contexts', () => ({
  useToast: () => toastMock,
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useAuth: () => ({ user: authState.user, isAuthenticated: true, login: vi.fn(), logout: vi.fn() }),
  useTenant: () => ({ tenant: { id: 2 }, tenantSlug: 'test', tenantPath: (p: string) => '/test' + p, hasFeature: () => true, hasModule: () => true }),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/helpers')>()),
  resolveAvatarUrl: (u: string | null | undefined) => u ?? '',
}));

import OrgExpensesTab from './OrgExpensesTab';
import { api } from '@/lib/api';

type Status = 'pending' | 'approved' | 'rejected' | 'paid';

const makeExpense = (id: number, status: Status = 'pending', overrides: Record<string, unknown> = {}) => ({
  id,
  user_id: 10,
  volunteer_name: 'Jane Doe',
  avatar_url: null,
  organization_id: 5,
  opportunity_id: null,
  expense_type: 'travel',
  amount: 25.5,
  currency: 'EUR',
  description: 'Bus fare to the food bank.',
  status,
  has_receipt: false,
  submitted_at: '2026-09-20T10:00:00Z',
  reviewed_by: null,
  reviewed_at: null,
  review_notes: null,
  paid_at: null,
  payment_reference: null,
  ...overrides,
});

const listResponse = (items: unknown[]) => ({
  success: true,
  data: {
    items,
    stats: { total_submitted: 100, pending_review: 25.5, approved_total: 50, paid_total: 20 },
    cursor: null,
    has_more: false,
  },
});

const renderTab = () => render(<OrgExpensesTab orgId={5} />);

describe('OrgExpensesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: 99, name: 'Org Admin' };
    vi.mocked(api.put).mockResolvedValue({ success: true, data: { success: true } });
  });

  it('loads pending claims by default and renders them', async () => {
    vi.mocked(api.get).mockResolvedValue(listResponse([makeExpense(1)]));
    renderTab();

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    expect(screen.getByText('Bus fare to the food bank.')).toBeInTheDocument();
    expect(screen.getByText('Travel')).toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls[0]?.[0]).toMatch(
      /^\/v2\/volunteering\/organisations\/5\/expenses\?.*status=pending/,
    );
  });

  it('offers Approve and Reject (and not Mark as paid) on a pending claim', async () => {
    vi.mocked(api.get).mockResolvedValue(listResponse([makeExpense(1, 'pending')]));
    renderTab();

    await waitFor(() => screen.getByRole('button', { name: /Approve the expense claim from Jane Doe/i }));
    expect(screen.getByRole('button', { name: /Reject the expense claim from Jane Doe/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /as paid/i })).not.toBeInTheDocument();
  });

  it('offers only Mark as paid on an approved claim', async () => {
    vi.mocked(api.get).mockResolvedValue(listResponse([makeExpense(2, 'approved')]));
    renderTab();

    await waitFor(() => screen.getByRole('button', { name: /Mark the expense claim from Jane Doe as paid/i }));
    expect(screen.queryByRole('button', { name: /Approve the expense claim/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject the expense claim/i })).not.toBeInTheDocument();
  });

  it.each<Status>(['rejected', 'paid'])('offers no actions on a %s claim', async (status) => {
    vi.mocked(api.get).mockResolvedValue(listResponse([makeExpense(3, status)]));
    renderTab();

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Approve the expense claim/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject the expense claim/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /as paid/i })).not.toBeInTheDocument();
  });

  it('shows no actions on the reviewer’s own claim, only a note', async () => {
    authState.user = { id: 10, name: 'Jane Doe' };
    vi.mocked(api.get).mockResolvedValue(listResponse([makeExpense(4, 'pending', { user_id: 10 })]));
    renderTab();

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Approve the expense claim/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject the expense claim/i })).not.toBeInTheDocument();
    expect(
      screen.getByText('This is your own claim. Another organisation admin must review it.'),
    ).toBeInTheDocument();
  });

  it('calls PUT with status approved when Approve is pressed, then reloads', async () => {
    vi.mocked(api.get).mockResolvedValue(listResponse([makeExpense(1, 'pending')]));
    renderTab();

    const approve = await screen.findByRole('button', { name: /Approve the expense claim from Jane Doe/i });
    const loadsBefore = vi.mocked(api.get).mock.calls.length;
    fireEvent.click(approve);

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/v2/volunteering/organisations/5/expenses/1', { status: 'approved' });
    });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Expense claim approved.'));
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(loadsBefore));
  });

  it('explains and reloads when the claim was already handled (409 INVALID_STATE)', async () => {
    vi.mocked(api.get).mockResolvedValue(listResponse([makeExpense(1, 'pending')]));
    vi.mocked(api.put).mockResolvedValue({
      success: false,
      code: 'INVALID_STATE',
      error: 'This expense has already been reviewed.',
    });
    renderTab();

    const approve = await screen.findByRole('button', { name: /Approve the expense claim from Jane Doe/i });
    const loadsBefore = vi.mocked(api.get).mock.calls.length;
    fireEvent.click(approve);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        'This claim has already been dealt with by someone else. The list has been refreshed.',
      );
    });
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(loadsBefore));
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('shows the server message when the review is refused with 403', async () => {
    vi.mocked(api.get).mockResolvedValue(listResponse([makeExpense(1, 'pending')]));
    vi.mocked(api.put).mockResolvedValue({
      success: false,
      code: 'FORBIDDEN',
      error: 'You cannot review your own expense claim.',
    });
    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: /Approve the expense claim from Jane Doe/i }));
    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith('You cannot review your own expense claim.');
    });
  });

  it('shows the empty state when there are no pending claims', async () => {
    vi.mocked(api.get).mockResolvedValue(listResponse([]));
    renderTab();

    await waitFor(() => expect(screen.getByText('No expense claims here')).toBeInTheDocument());
    expect(screen.getByText('There are no claims waiting for review.')).toBeInTheDocument();
  });
});
