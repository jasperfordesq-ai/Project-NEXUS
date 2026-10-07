// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ExpensesTab
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import { framerMotionMock } from '@/test/mocks';

vi.mock('@/lib/motion', () => framerMotionMock);

const translations: Record<string, string> = {
  'expenses.heading': 'My Expenses',
  'expenses.submit': 'Submit Expense',
  'expenses.stats.total_claimed': 'Total Claimed',
  'expenses.stats.approved': 'Approved',
  'expenses.stats.paid': 'Paid',
  'expenses.load_error': 'Unable to load expenses. Please try again.',
  'expenses.try_again': 'Try Again',
  'expenses.empty_title': 'No expenses yet',
};
const stableT = (key: string, fallback?: string | object) =>
  translations[key] ?? (typeof fallback === 'string' ? fallback : key);
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: stableT,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: { items: [], has_more: false } }),
    post: vi.fn().mockResolvedValue({ success: true }),
    upload: vi.fn().mockResolvedValue({ success: true }),
  },
}));

// Native stand-ins for the claim form's controls (HeroUI's Select does not run
// in jsdom). The component imports these from their subpaths.
vi.mock('@/components/ui/Select', () => ({
  Select: ({ label, children, onSelectionChange, selectedKeys }: {
    label?: string;
    children?: React.ReactNode;
    onSelectionChange?: (keys: Set<string>) => void;
    selectedKeys?: string[];
  }) => (
    <select
      aria-label={label}
      value={selectedKeys?.[0] ?? ''}
      onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
    <option value={id}>{children}</option>
  ),
}));
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen }: { children?: React.ReactNode; isOpen?: boolean }) => (isOpen ? <div role="dialog">{children}</div> : null),
  ModalContent: ({ children }: { children?: React.ReactNode | ((close: () => void) => React.ReactNode) }) =>
    <>{typeof children === 'function' ? children(() => {}) : children}</>,
  ModalHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ModalBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ModalFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/Input', () => ({
  Input: ({ label, value, onValueChange }: { label?: string; value?: string; onValueChange?: (v: string) => void }) => (
    <input aria-label={label} value={value ?? ''} onChange={(e) => onValueChange?.(e.target.value)} />
  ),
}));
vi.mock('@/components/ui/Textarea', () => ({
  Textarea: ({ label, value, onValueChange }: { label?: string; value?: string; onValueChange?: (v: string) => void }) => (
    <textarea aria-label={label} value={value ?? ''} onChange={(e) => onValueChange?.(e.target.value)} />
  ),
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenantPath: (path: string) => `/test${path}`,
    hasFeature: () => true,
    hasModule: () => true,
  }),
  TenantProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
      {action}
    </div>
  ),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { ExpensesTab } from './ExpensesTab';
import { api } from '@/lib/api';

const mockExpense = {
  id: 1,
  expense_type: 'travel' as const,
  amount: '45.50',
  currency: 'EUR',
  description: 'Bus fare to volunteer site',
  status: 'approved' as const,
  submitted_at: '2026-03-10T10:00:00Z',
  reviewed_at: '2026-03-12T10:00:00Z',
  review_notes: null,
  paid_at: null,
  payment_reference: null,
};

const mockPaidExpense = {
  id: 2,
  expense_type: 'meals' as const,
  amount: '12.00',
  currency: 'EUR',
  description: 'Lunch during event',
  status: 'paid' as const,
  submitted_at: '2026-03-08T10:00:00Z',
  reviewed_at: '2026-03-09T10:00:00Z',
  review_notes: 'Approved for reimbursement',
  paid_at: '2026-03-15T10:00:00Z',
  payment_reference: 'PAY-123',
};

describe('ExpensesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the heading and Submit Expense button', () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { items: [], has_more: false } });
    render(<ExpensesTab />);
    expect(screen.getByText('My Expenses')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit Expense/i })).toBeInTheDocument();
  });

  it('shows empty state when no expenses exist', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { items: [], has_more: false } });
    render(<ExpensesTab />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByText('No expenses yet')).toBeInTheDocument();
    });
  });

  // Gap C6: "Click Submit Expense to get started" — the button is now in the empty state.
  it('opens the claim form from the empty state', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { items: [], has_more: false } });
    render(<ExpensesTab />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    const inEmptyState = screen.getByTestId('empty-state').querySelector('button');
    expect(inEmptyState).toHaveTextContent('Submit Expense');
    fireEvent.click(inEmptyState!);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows loading skeleton while data is being fetched', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<ExpensesTab />);
    // The loading skeleton renders inside a role="status" container.
    const loadingContainers = screen.getAllByRole('status');
    expect(loadingContainers.length).toBeGreaterThan(0);
  });

  it('displays expense items when data is loaded', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { items: [mockExpense, mockPaidExpense], has_more: false },
    });
    render(<ExpensesTab />);
    await waitFor(() => {
      expect(screen.getByText('Bus fare to volunteer site')).toBeInTheDocument();
    });
    expect(screen.getByText('Lunch during event')).toBeInTheDocument();
  });

  it('displays stats cards when expenses exist', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { items: [mockExpense, mockPaidExpense], has_more: false },
    });
    render(<ExpensesTab />);
    await waitFor(() => {
      expect(screen.getByText('Total Claimed')).toBeInTheDocument();
      expect(screen.getByText('Approved')).toBeInTheDocument();
      expect(screen.getByText('Paid')).toBeInTheDocument();
    });
  });

  it('shows review notes when present', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { items: [mockPaidExpense], has_more: false },
    });
    render(<ExpensesTab />);
    await waitFor(() => {
      expect(document.body.textContent).toContain('Approved for reimbursement');
    });
  });

  it('shows error state and Try Again button when API fails', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, data: null });
    render(<ExpensesTab />);
    await waitFor(() => {
      expect(screen.getByText('Unable to load expenses. Please try again.')).toBeInTheDocument();
    });
    const buttons = screen.getAllByRole('button');
    const tryAgainBtn = buttons.find((btn) => btn.textContent?.includes('Try Again'));
    expect(tryAgainBtn).toBeTruthy();
  });

  // ── The claim form ──────────────────────────────────────────────────
  // A volunteer may claim from an organisation they belong to OR one that
  // accepted them onto an opportunity (VolunteerExpenseService::
  // userCanClaimAgainstOrganization). Being accepted does not make someone a
  // member, so listing only "my organisations" hid the organisation most
  // volunteers claim from.

  const approvedApplications = [
    { id: 11, status: 'approved', opportunity: { id: 501, title: 'Garden clean-up' }, organization: { id: 7, name: 'Riverside Garden' } },
    { id: 12, status: 'approved', opportunity: { id: 502, title: 'Seed swap stall' }, organization: { id: 7, name: 'Riverside Garden' } },
    { id: 13, status: 'approved', opportunity: { id: 601, title: 'Food bank shift' }, organization: { id: 8, name: 'Food Bank' } },
    { id: 14, status: 'pending', opportunity: { id: 701, title: 'Pending thing' }, organization: { id: 9, name: 'Not yet' } },
  ];

  function mockFormData(myOrgs: unknown[] = []) {
    vi.mocked(api.get).mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/v2/volunteering/applications')) {
        return Promise.resolve({ success: true, data: approvedApplications });
      }
      if (endpoint.startsWith('/v2/volunteering/my-organisations')) {
        return Promise.resolve({ success: true, data: myOrgs });
      }
      return Promise.resolve({ success: true, data: { items: [], has_more: false } });
    });
  }

  async function openForm() {
    render(<ExpensesTab />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/v2/volunteering/applications')));
    fireEvent.click(screen.getAllByRole('button', { name: /Submit Expense/i })[0]!);
    return screen.findByRole('dialog');
  }

  function fillRequired(dialog: HTMLElement) {
    fireEvent.change(dialog.querySelector('input[aria-label="expenses.form.amount"]')!, { target: { value: '8.50' } });
    fireEvent.change(dialog.querySelector('textarea')!, { target: { value: 'Bus fare' } });
  }

  // Gap C8: with nowhere to claim from, the form showed a notice and a disabled button.
  it('shows where a claim becomes possible when there is no organisation to claim from', async () => {
    vi.mocked(api.get).mockImplementation((endpoint: string) => (
      Promise.resolve({ success: true, data: endpoint.includes('/expenses') ? { items: [], has_more: false } : [] })
    ));
    const dialog = await openForm();
    const links = within(dialog).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/test/volunteering',
      '/test/volunteering?tab=applications',
    ]);
  });

  it('offers organisations the volunteer was accepted by, not only ones they belong to', async () => {
    mockFormData([{ id: 3, name: 'My Own Club', status: 'active', member_role: 'owner' }]);
    const dialog = await openForm();
    const orgSelect = dialog.querySelector('select[aria-label="expenses.form.organisation"]') as HTMLSelectElement;
    await waitFor(() => {
      const names = Array.from(orgSelect.options).map((o) => o.textContent);
      expect(names).toEqual(expect.arrayContaining(['Riverside Garden', 'Food Bank', 'My Own Club']));
      expect(names).not.toContain('Not yet');
    });
  });

  it('offers only the chosen organisation\'s accepted opportunities and sends the one picked', async () => {
    mockFormData();
    const dialog = await openForm();
    const orgSelect = dialog.querySelector('select[aria-label="expenses.form.organisation"]') as HTMLSelectElement;
    await waitFor(() => expect(orgSelect.options.length).toBeGreaterThan(2));
    fireEvent.change(orgSelect, { target: { value: '7' } });

    const oppSelect = await waitFor(() => {
      const el = dialog.querySelector('select[aria-label="expenses.form.opportunity"]') as HTMLSelectElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    const titles = Array.from(oppSelect.options).map((o) => o.textContent).filter(Boolean);
    expect(titles).toEqual(['expenses.form.opportunity_none', 'Garden clean-up', 'Seed swap stall']);

    fireEvent.change(oppSelect, { target: { value: '502' } });
    fillRequired(dialog);
    fireEvent.click(screen.getByRole('button', { name: 'expenses.submit_button' }));

    await waitFor(() => expect(api.upload).toHaveBeenCalled());
    const payload = vi.mocked(api.upload).mock.calls[0]![1] as FormData;
    expect(payload.get('organization_id')).toBe('7');
    expect(payload.get('opportunity_id')).toBe('502');
  });

  it('sends no opportunity when none is chosen, and has no currency box', async () => {
    mockFormData();
    const dialog = await openForm();
    const orgSelect = dialog.querySelector('select[aria-label="expenses.form.organisation"]') as HTMLSelectElement;
    await waitFor(() => expect(orgSelect.options.length).toBeGreaterThan(2));
    fireEvent.change(orgSelect, { target: { value: '8' } });

    expect(dialog.querySelector('input[aria-label="expenses.form.currency"]')).toBeNull();

    fillRequired(dialog);
    fireEvent.click(screen.getByRole('button', { name: 'expenses.submit_button' }));

    await waitFor(() => expect(api.upload).toHaveBeenCalled());
    const payload = vi.mocked(api.upload).mock.calls[0]![1] as FormData;
    expect(payload.get('organization_id')).toBe('8');
    expect(payload.has('opportunity_id')).toBe(false);
    expect(payload.has('currency')).toBe(false);
  });

  it('retries loading when Try Again is clicked', async () => {
    let expenseCallCount = 0;
    vi.mocked(api.get).mockImplementation((endpoint: string) => {
      if (endpoint.includes('/v2/volunteering/expenses')) {
        expenseCallCount++;
        if (expenseCallCount === 1) return Promise.resolve({ success: false, data: null });
        return Promise.resolve({ success: true, data: { items: [], has_more: false } });
      }

      return Promise.resolve({ success: true, data: { items: [], has_more: false } });
    });
    render(<ExpensesTab />);
    await waitFor(() => {
      expect(screen.getByText('Unable to load expenses. Please try again.')).toBeInTheDocument();
    });
    const buttons = screen.getAllByRole('button');
    const tryAgainBtn = buttons.find((btn) => btn.textContent?.includes('Try Again'));
    fireEvent.click(tryAgainBtn!);
    await waitFor(() => {
      expect(expenseCallCount).toBe(2);
    });
  });
});
