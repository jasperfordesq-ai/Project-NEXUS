// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Hoisted mocks ───────────────────────────────────────────────────────────
const { mockAdminVolunteering } = vi.hoisted(() => ({
  mockAdminVolunteering: {
    getExpenses: vi.fn(),
    reviewExpense: vi.fn(),
    exportExpenses: vi.fn(),
    getExpensePolicies: vi.fn(),
    updateExpensePolicies: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminVolunteering: mockAdminVolunteering,
}));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  default: { get: vi.fn(), post: vi.fn() },
  API_BASE: 'http://localhost:8090/api',
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Toast ────────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// Stub DataTable, EmptyState, StatCard, PageHeader from admin components.
// The component imports these from their '../../components/<Name>' subpaths, so
// each subpath module must be mocked individually — mocking the '../../components'
// index barrel does NOT intercept subpath imports.
vi.mock('../../components/DataTable', () => ({
  DataTable: ({ data, columns, isLoading }: {
    data: unknown[];
    columns: Array<{ key: string; label: string; render?: (item: unknown) => React.ReactNode }>;
    isLoading?: boolean;
  }) => {
    if (isLoading) return <div role="status" aria-busy="true" aria-label="loading" />;
    if (!data || data.length === 0) return <div data-testid="data-table-empty">No data</div>;
    return (
      <div data-testid="data-table">
        {(data as Array<Record<string, unknown>>).map((row) => (
          <div key={String(row.id)} data-testid={`row-${String(row.id)}`}>
            {columns.map((col) => (
              <div key={col.key}>
                {col.render
                  ? col.render(row)
                  : String(row[col.key] ?? '')}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  },
}));

vi.mock('../../components/EmptyState', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <p>{title}</p>
      {description && <p>{description}</p>}
    </div>
  ),
}));

vi.mock('../../components/StatCard', () => ({
  StatCard: ({ label, value }: { label: string; value: number | string }) => (
    <div data-testid="stat-card">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
}));

vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title, actions }: { title?: React.ReactNode; actions?: React.ReactNode }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));

// Stub Select to avoid HeroUI infinite-loop
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    Select: ({ label, children, onSelectionChange }: {
      label?: string;
      children?: React.ReactNode;
      onSelectionChange?: (keys: Set<string>) => void;
    }) => (
      <select
        aria-label={label}
        onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}
      >
        {children}
      </select>
    ),
    SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
      <option value={id}>{children}</option>
    ),
    Accordion: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="accordion">{children}</div>
    ),
    AccordionItem: ({ children, title }: { children?: React.ReactNode; title?: React.ReactNode }) => (
      <div data-testid="accordion-item">
        <div>{title}</div>
        <div>{children}</div>
      </div>
    ),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeExpense = (overrides = {}): Record<string, unknown> => ({
  id: 1,
  volunteer_name: 'Alice Volunteer',
  organization_name: 'Green Community',
  amount: 25.5,
  // 🔴 An ISO 4217 code, not a symbol. VolunteerExpenseService always writes
  // strtoupper(TenantContext::getCurrency()), and getCurrency() is guarded to
  // exactly three letters (defaulting to 'eur'), so the API never sends '€'.
  // The page calls formatCurrency(amount, currency.toUpperCase()) — Intl throws
  // on a symbol, dropping it into the "<amount> <CODE>" fallback, so the symbol
  // these fixtures invented could not produce the output they asserted.
  currency: 'EUR',
  type: 'travel',
  status: 'pending',
  submitted_at: '2026-06-01T10:00:00Z',
  has_receipt: false,
  description: 'Bus fare to volunteering location',
  ...overrides,
});

const makeStats = (overrides = {}) => ({
  total_submitted: 10,
  pending_review: 4,
  approved_total: 5,
  paid_total: 1,
  ...overrides,
});

const makePolicy = (overrides = {}) => ({
  id: 1,
  type: 'travel',
  expense_type: 'travel',
  max_amount: 100,
  max_monthly: 200,
  requires_receipt_above: 25,
  requires_approval: true,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('VolunteerExpenses', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminVolunteering.getExpenses.mockResolvedValue({
      success: true,
      data: { items: [], stats: makeStats() },
    });
    mockAdminVolunteering.getExpensePolicies.mockResolvedValue({
      success: true,
      data: [],
    });
    mockAdminVolunteering.reviewExpense.mockResolvedValue({ success: true });
    mockAdminVolunteering.updateExpensePolicies.mockResolvedValue({ success: true });
    mockAdminVolunteering.exportExpenses.mockResolvedValue(new Blob(['csv'], { type: 'text/csv' }));
  });

  // Gap D6: with no policies there was nothing to press; the API now creates one by type.
  it('adds an expense policy for a type that has none, with blank limits sent as no limit', async () => {
    mockAdminVolunteering.getExpensePolicies.mockResolvedValue({
      success: true,
      data: [{ id: 1, type: 'travel', expense_type: 'travel', max_amount: 50, max_monthly: 200, requires_receipt_above: 0, requires_approval: true }],
    });
    const { VolunteerExpenses } = await import('./VolunteerExpenses');
    render(<VolunteerExpenses />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add expense policy' }));
    const typeSelect = await screen.findByRole('combobox', { name: 'Expense type' });
    // Travel already has a policy, so it is not offered.
    expect(Array.from((typeSelect as HTMLSelectElement).options).map((o) => o.value)).toEqual(['meals', 'supplies', 'equipment', 'parking', 'other']);
    fireEvent.change(typeSelect, { target: { value: 'parking' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => expect(mockAdminVolunteering.updateExpensePolicies).toHaveBeenCalledWith({
      expense_type: 'parking',
      max_amount: null,
      max_monthly: null,
      requires_receipt_above: 0,
      requires_approval: true,
    }));
  });

  it('shows loading state on initial mount', async () => {
    mockAdminVolunteering.getExpenses.mockImplementationOnce(() => new Promise(() => {}));
    const { VolunteerExpenses } = await import('./VolunteerExpenses');
    render(<VolunteerExpenses />);

    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders stat cards once data is loaded', async () => {
    const { VolunteerExpenses } = await import('./VolunteerExpenses');
    render(<VolunteerExpenses />);

    await waitFor(() => {
      const statCards = screen.getAllByTestId('stat-card');
      expect(statCards.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('shows empty state when no expenses returned', async () => {
    const { VolunteerExpenses } = await import('./VolunteerExpenses');
    render(<VolunteerExpenses />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders expense rows in DataTable when expenses are present', async () => {
    mockAdminVolunteering.getExpenses.mockResolvedValue({
      success: true,
      data: {
        items: [makeExpense()],
        stats: makeStats(),
      },
    });
    const { VolunteerExpenses } = await import('./VolunteerExpenses');
    render(<VolunteerExpenses />);

    await waitFor(() => {
      expect(screen.getByTestId('data-table')).toBeInTheDocument();
      expect(screen.getByText('Alice Volunteer')).toBeInTheDocument();
    });
  });

  it('renders the bare amount without assuming EUR when currency is absent', async () => {
    mockAdminVolunteering.getExpenses.mockResolvedValue({
      success: true,
      data: {
        items: [makeExpense({ currency: undefined, amount: 25.5 })],
        stats: makeStats(),
      },
    });
    const { VolunteerExpenses } = await import('./VolunteerExpenses');
    render(<VolunteerExpenses />);

    await waitFor(() => {
      expect(screen.getByText('Alice Volunteer')).toBeInTheDocument();
    });

    // No hardcoded '€' fallback — the amount renders bare
    // (25.50 can also appear in the org-breakdown totals, so use getAllByText)
    expect(screen.getAllByText('25.50').length).toBeGreaterThan(0);
    expect(screen.queryByText(/€|EUR/)).not.toBeInTheDocument();
  });

  it('renders the provided currency prefix when currency is present', async () => {
    mockAdminVolunteering.getExpenses.mockResolvedValue({
      success: true,
      data: {
        items: [makeExpense({ currency: 'GBP', amount: 12 })],
        stats: makeStats(),
      },
    });
    const { VolunteerExpenses } = await import('./VolunteerExpenses');
    render(<VolunteerExpenses />);

    await waitFor(() => {
      expect(screen.getByText('Alice Volunteer')).toBeInTheDocument();
    });

    // Locale-aware currency formatting: the symbol's position and spacing are
    // the locale's business, so assert both parts rather than one fixed layout.
    // (12.00 also appears in the org-breakdown totals, so match all of them.)
    const amountEls = screen.getAllByText(/12\.00/);
    expect(amountEls.length).toBeGreaterThan(0);
    expect(amountEls.some((el) => /£|GBP/.test(el.textContent ?? ''))).toBe(true);
  });

  it('renders Export CSV and Refresh buttons', async () => {
    const { VolunteerExpenses } = await import('./VolunteerExpenses');
    render(<VolunteerExpenses />);

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const exportBtn = buttons.find((b) =>
        b.textContent?.toLowerCase().includes('export') ||
        b.textContent?.toLowerCase().includes('csv'),
      );
      const refreshBtn = buttons.find((b) =>
        b.textContent?.toLowerCase().includes('refresh'),
      );
      expect(exportBtn).toBeDefined();
      expect(refreshBtn).toBeDefined();
    });
  });

  it('shows error toast when expense load fails', async () => {
    mockAdminVolunteering.getExpenses.mockRejectedValueOnce(new Error('Network error'));
    const { VolunteerExpenses } = await import('./VolunteerExpenses');
    render(<VolunteerExpenses />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows date range filter inputs', async () => {
    const { VolunteerExpenses } = await import('./VolunteerExpenses');
    render(<VolunteerExpenses />);

    await waitFor(() => {
      const dateInputs = document.querySelectorAll('input[type="date"]');
      expect(dateInputs.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('opens review modal when Review button is clicked', async () => {
    mockAdminVolunteering.getExpenses.mockResolvedValue({
      success: true,
      data: { items: [makeExpense({ id: 5 })], stats: makeStats() },
    });
    const { VolunteerExpenses } = await import('./VolunteerExpenses');
    render(<VolunteerExpenses />);

    await waitFor(() => screen.getByTestId('data-table'));

    const reviewBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('review'),
    );
    if (reviewBtn) {
      fireEvent.click(reviewBtn);
      await waitFor(() => {
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog).toBeTruthy();
      });
    }
  });

  it('calls reviewExpense API on modal confirmation', async () => {
    mockAdminVolunteering.getExpenses.mockResolvedValue({
      success: true,
      data: { items: [makeExpense({ id: 5 })], stats: makeStats() },
    });
    const { VolunteerExpenses } = await import('./VolunteerExpenses');
    render(<VolunteerExpenses />);

    await waitFor(() => screen.getByTestId('data-table'));

    // Click Review button
    const reviewBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('review'),
    );
    if (reviewBtn) {
      fireEvent.click(reviewBtn);

      await waitFor(() => document.querySelector('[role="dialog"]'));

      // Click the primary action button (approve/reject/paid)
      const dialogBtns = document.querySelector('[role="dialog"]')?.querySelectorAll('button');
      const confirmBtn = Array.from(dialogBtns ?? []).find((b) =>
        b.textContent?.toLowerCase().includes('approve') ||
        b.textContent?.toLowerCase().includes('confirm') ||
        b.textContent?.toLowerCase().includes('save'),
      );
      if (confirmBtn) {
        fireEvent.click(confirmBtn);
        await waitFor(() => {
          expect(mockAdminVolunteering.reviewExpense).toHaveBeenCalledWith(
            5,
            expect.objectContaining({ status: expect.any(String) }),
          );
        });
      }
    }
  });

  // The server only approves/rejects a PENDING expense and only pays an
  // APPROVED one (VolunteerExpenseService::reviewExpense / markPaid). The modal
  // used to open on "Approve" for every row, so reviewing an already-approved
  // expense sent status=approved, which the server refused — the admin saw
  // only "Failed to update expense".
  const openReviewFor = async (expense: Record<string, unknown>) => {
    mockAdminVolunteering.getExpenses.mockResolvedValue({
      success: true,
      data: { items: [expense], stats: makeStats() },
    });
    const { VolunteerExpenses } = await import('./VolunteerExpenses');
    render(<VolunteerExpenses />);
    await waitFor(() => screen.getByTestId('data-table'));
    const reviewBtn = screen.getByRole('button', { name: /review/i });
    fireEvent.click(reviewBtn);
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    return document.querySelector('[role="dialog"]') as HTMLElement;
  };

  // Owner decision (2026-10-02): community admins no longer mark claims paid —
  // the organisation records payment from its own dashboard, and the admin
  // endpoint answers 403 for status 'paid'. An approved claim therefore has no
  // admin action, only a hint saying where payment is recorded.
  it('offers no action on an approved expense and explains the organisation records payment', async () => {
    mockAdminVolunteering.getExpenses.mockResolvedValue({
      success: true,
      data: { items: [makeExpense({ id: 2, status: 'approved' })], stats: makeStats() },
    });
    const { VolunteerExpenses } = await import('./VolunteerExpenses');
    render(<VolunteerExpenses />);
    await waitFor(() => screen.getByTestId('data-table'));

    expect(screen.queryByRole('button', { name: /review/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark as paid/i })).not.toBeInTheDocument();
    expect(
      screen.getByText('The organisation records payment from its own dashboard.'),
    ).toBeInTheDocument();
  });

  it('offers only approve and reject for a pending expense', async () => {
    const dialog = await openReviewFor(makeExpense({ id: 3, status: 'pending' }));
    const options = Array.from(dialog.querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['approved', 'rejected']);
  });

  it.each(['paid', 'rejected'])('shows no Review button for a %s expense', async (status) => {
    mockAdminVolunteering.getExpenses.mockResolvedValue({
      success: true,
      data: { items: [makeExpense({ id: 4, status })], stats: makeStats() },
    });
    const { VolunteerExpenses } = await import('./VolunteerExpenses');
    render(<VolunteerExpenses />);
    await waitFor(() => screen.getByTestId('data-table'));
    expect(screen.queryByRole('button', { name: /review/i })).not.toBeInTheDocument();
  });

  it('shows its own translated message, never the raw server text, when a review is refused', async () => {
    mockAdminVolunteering.reviewExpense.mockResolvedValue({
      success: false,
      error: 'RAW SERVER TEXT MUST NOT RENDER',
    });
    const dialog = await openReviewFor(makeExpense({ id: 6, status: 'pending' }));
    const confirmBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
      /^\s*approve\s*$/i.test(b.textContent ?? ''),
    );
    fireEvent.click(confirmBtn!);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Failed to update expense');
    });
    expect(mockToast.error).not.toHaveBeenCalledWith('RAW SERVER TEXT MUST NOT RENDER');
  });

  it('explains that an admin cannot review their own claim', async () => {
    mockAdminVolunteering.reviewExpense.mockResolvedValue({
      success: false,
      code: 'SELF_REVIEW_FORBIDDEN',
      error: 'RAW SERVER TEXT MUST NOT RENDER',
    });
    const dialog = await openReviewFor(makeExpense({ id: 8, status: 'pending' }));
    const confirmBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
      /^\s*approve\s*$/i.test(b.textContent ?? ''),
    );
    fireEvent.click(confirmBtn!);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'You cannot approve or reject your own expense claim. Ask another administrator to review it.',
      );
    });
  });

  it('refreshes the list when the claim was already handled by someone else', async () => {
    mockAdminVolunteering.reviewExpense.mockResolvedValue({
      success: false,
      code: 'INVALID_STATE',
      error: 'This expense has already been reviewed, so it cannot be approved or rejected again.',
    });
    const dialog = await openReviewFor(makeExpense({ id: 7, status: 'pending' }));
    const loadsBefore = mockAdminVolunteering.getExpenses.mock.calls.length;
    const confirmBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
      /^\s*approve\s*$/i.test(b.textContent ?? ''),
    );
    fireEvent.click(confirmBtn!);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'This expense has already been reviewed, so it cannot be approved or rejected again.',
      );
      expect(mockAdminVolunteering.getExpenses.mock.calls.length).toBeGreaterThan(loadsBefore);
    });
  });

  it('renders policies section heading', async () => {
    mockAdminVolunteering.getExpensePolicies.mockResolvedValue({
      success: true,
      data: [makePolicy()],
    });
    const { VolunteerExpenses } = await import('./VolunteerExpenses');
    render(<VolunteerExpenses />);

    await waitFor(() => {
      // Policy section card should render
      expect(screen.getByTestId('accordion')).toBeInTheDocument();
    });
  });

  it('shows org breakdown table when expenses with org data are loaded', async () => {
    mockAdminVolunteering.getExpenses.mockResolvedValue({
      success: true,
      data: {
        items: [
          makeExpense({ id: 1, organization_name: 'Green Org', amount: 50, status: 'approved' }),
          makeExpense({ id: 2, organization_name: 'Blue Org', amount: 30, status: 'pending' }),
        ],
        stats: makeStats(),
      },
    });
    const { VolunteerExpenses } = await import('./VolunteerExpenses');
    render(<VolunteerExpenses />);

    await waitFor(() => {
      // Org names appear both in the mocked DataTable rows and the org-breakdown
      // table, so assert presence rather than uniqueness.
      expect(screen.getAllByText('Green Org').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Blue Org').length).toBeGreaterThan(0);
    });
  });
});
