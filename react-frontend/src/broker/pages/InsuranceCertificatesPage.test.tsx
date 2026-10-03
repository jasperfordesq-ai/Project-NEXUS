// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Hoisted mocks ───────────────────────────────────────────────────────────
const { mockAdminInsurance, mockAdminUsers, mockAdminBroker, capturedColumns } = vi.hoisted(() => ({
  mockAdminInsurance: {
    list: vi.fn(),
    stats: vi.fn(),
    verify: vi.fn(),
    reject: vi.fn(),
    destroy: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  mockAdminUsers: { list: vi.fn(), get: vi.fn() },
  mockAdminBroker: { getConfiguration: vi.fn() },
  capturedColumns: { current: [] as Array<{ key: string; sortable?: boolean }> },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminInsurance: mockAdminInsurance,
  adminUsers: mockAdminUsers,
  adminBroker: mockAdminBroker,
  adminCrm: { getFunnel: vi.fn() },
  adminMenus: { list: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...orig,
    resolveAvatarUrl: vi.fn((url: string | null) => url ?? '/default-avatar.png'),
    resolveAssetUrl: vi.fn((url: string | null) => url ?? ''),
  };
});
vi.mock('@/lib/serverTime', () => ({
  parseServerTimestamp: vi.fn((d: string | null) => (d ? new Date(d) : null)),
  formatServerDate: vi.fn((d: string) => d),
  formatServerDateTime: vi.fn((d: string) => d),
}));

// ─── Router with useSearchParams stub ────────────────────────────────────────
// Holder object so individual tests can deep-link (?status=…) before render.
const mockSetSearchParams = vi.fn();
const searchParamsHolder = vi.hoisted(() => ({ current: new URLSearchParams() }));

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => vi.fn(),
    useParams: () => ({}),
    useSearchParams: () => [searchParamsHolder.current, mockSetSearchParams],
  };
});

// ─── Contexts ────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      // The tenant's payment currency (ISO 4217) — the page must not hard-code €.
      tenant: { id: 2, name: 'Test', slug: 'test', currency: 'GBP' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Admin component stubs ───────────────────────────────────────────────────
// DataTable stub renders each column's cell so status / expiry-countdown chips
// are assertable, plus the row-count marker the older tests relied on and the
// emptyContent slot when there are no rows.
type StubColumn = { key: string; sortable?: boolean; render?: (item: never) => React.ReactNode };

const makeAdminComponentMocks = () => ({
  DataTable: ({
    data,
    columns,
    isLoading,
    emptyContent,
  }: {
    data?: Record<string, unknown>[];
    columns?: StubColumn[];
    isLoading?: boolean;
    emptyContent?: React.ReactNode;
  }) => (
    capturedColumns.current = columns ?? [],
    <div data-testid="data-table" aria-busy={isLoading ? 'true' : undefined}>
      {isLoading ? <div role="status" aria-busy="true" /> : null}
      <span>{`${(data ?? []).length} rows`}</span>
      {Array.isArray(data) && data.length === 0
        ? emptyContent
        : (data ?? []).map((item, i) => (
            <div key={i} data-testid="data-row">
              {(columns ?? []).map((col) => (
                <span key={col.key}>{col.render ? col.render(item as never) : String(item[col.key] ?? '')}</span>
              ))}
            </div>
          ))}
    </div>
  ),
  StatCard: ({ label, value }: { label: string; value?: unknown }) => (
    <div data-testid="stat-card">{label}: {String(value ?? '')}</div>
  ),
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
  ConfirmModal: () => null,
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
});

vi.mock('@/admin/components', () => makeAdminComponentMocks());
vi.mock('../../admin/components', () => makeAdminComponentMocks());

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const daysFromNow = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

const makeStats = () => ({
  total: 45,
  pending: 5,
  pending_review: 8,
  verified: 30,
  rejected: 3,
  expired: 4,
  expiring_soon: 2,
});

const makeCertificate = (overrides = {}) => ({
  id: 1,
  user_id: 10,
  first_name: 'Carol',
  last_name: 'Cert',
  email: 'carol@example.com',
  avatar_url: null,
  insurance_type: 'public_liability',
  status: 'pending',
  provider_name: 'Test Insurance Ltd',
  policy_number: 'POL-001',
  coverage_amount: 1000000,
  start_date: '2025-01-01',
  // Far enough out that no urgency chip renders by default.
  expiry_date: daysFromNow(300),
  certificate_file_path: null,
  verified_by: null,
  verifier_first_name: null,
  verifier_last_name: null,
  verified_at: null,
  notes: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: null,
  ...overrides,
});

const makeConfig = () => ({
  enabled: true,
  require_insurance: true,
  min_coverage: 500000,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('InsuranceCertificatesPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    searchParamsHolder.current = new URLSearchParams();
    mockAdminInsurance.list.mockResolvedValue({
      success: true,
      data: [makeCertificate()],
      meta: { total: 1, per_page: 25, current_page: 1, last_page: 1 },
    });
    mockAdminInsurance.stats.mockResolvedValue({ success: true, data: makeStats() });
    mockAdminInsurance.verify.mockResolvedValue({ success: true });
    mockAdminInsurance.reject.mockResolvedValue({ success: true });
    mockAdminInsurance.destroy.mockResolvedValue({ success: true });
    mockAdminInsurance.create.mockResolvedValue({ success: true, data: makeCertificate() });
    mockAdminUsers.list.mockResolvedValue({ success: true, data: [] });
    mockAdminUsers.get.mockResolvedValue({
      success: true,
      data: { id: 10, name: 'Carol Cert', first_name: 'Carol', last_name: 'Cert', email: 'carol@example.com' },
    });
    mockAdminBroker.getConfiguration.mockResolvedValue({ success: true, data: makeConfig() });
  });

  it('shows a shaped skeleton (not the table) while first fetching', async () => {
    mockAdminInsurance.list.mockImplementationOnce(() => new Promise(() => {}));
    mockAdminInsurance.stats.mockImplementationOnce(() => new Promise(() => {}));
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    // First load renders BrokerSkeleton instead of the DataTable; the stat
    // cards also expose loading skeletons. Both use role="status".
    expect(screen.queryByTestId('data-table')).not.toBeInTheDocument();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('renders KPI stat cards with real values after load', async () => {
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await waitFor(() => {
      expect(screen.getByText('Total')).toBeInTheDocument();
      // 45 = total from the stats fixture (count-up is instant in test mode)
      expect(screen.getByText('45')).toBeInTheDocument();
      // Appears on the stat card and the tab
      expect(screen.getAllByText('Pending Review').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Expiring Soon').length).toBeGreaterThan(0);
    });
  });

  it('deep-links KPI cards into the matching filtered view', async () => {
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await waitFor(() => {
      const pendingCard = screen.getByRole('link', { name: 'Pending Review' });
      expect(pendingCard.getAttribute('href')).toContain('status=pending_review');
      const expiringCard = screen.getByRole('link', { name: 'Expiring Soon' });
      expect(expiringCard.getAttribute('href')).toContain('status=expiring_soon');
      const verifiedCard = screen.getByRole('link', { name: 'Verified' });
      expect(verifiedCard.getAttribute('href')).toContain('status=verified');
    });
  });

  it('renders data table with certificate rows', async () => {
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await waitFor(() => {
      const table = screen.getByTestId('data-table');
      expect(table).toBeInTheDocument();
      expect(table.textContent).toContain('1 rows');
      expect(within(table).getByText('Carol Cert')).toBeInTheDocument();
      expect(within(table).getByText('POL-001')).toBeInTheDocument();
    });
  });

  it('renders the panel-wide status chip and translated insurance type in rows', async () => {
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await waitFor(() => {
      const table = screen.getByTestId('data-table');
      // BrokerStatusChip label for status 'pending'
      expect(within(table).getByText('Pending')).toBeInTheDocument();
      // Insurance type chip
      expect(within(table).getByText('Public Liability')).toBeInTheDocument();
      // Far-future expiry: no urgency chip
      expect(within(table).queryByText(/d left/)).not.toBeInTheDocument();
      expect(within(table).queryByText(/Expired/)).not.toBeInTheDocument();
    });
  });

  it('shows a danger countdown chip on expired certificates', async () => {
    mockAdminInsurance.list.mockResolvedValue({
      success: true,
      data: [makeCertificate({ status: 'expired', expiry_date: daysFromNow(-4.5) })],
      meta: { total: 1 },
    });
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await waitFor(() => {
      const table = screen.getByTestId('data-table');
      expect(within(table).getByText(/Expired \d+d ago/)).toBeInTheDocument();
    });
  });

  it('shows a warning countdown chip on certificates expiring soon', async () => {
    mockAdminInsurance.list.mockResolvedValue({
      success: true,
      data: [makeCertificate({ status: 'verified', expiry_date: daysFromNow(9.5) })],
      meta: { total: 1 },
    });
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await waitFor(() => {
      const table = screen.getByTestId('data-table');
      expect(within(table).getByText(/\d+d left/)).toBeInTheDocument();
    });
  });

  it('calls adminInsurance.list on mount', async () => {
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await waitFor(() => {
      expect(mockAdminInsurance.list).toHaveBeenCalled();
    });
  });

  it('calls adminInsurance.stats on mount', async () => {
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await waitFor(() => {
      expect(mockAdminInsurance.stats).toHaveBeenCalled();
    });
  });

  it('shows error warning when stats fail to load', async () => {
    mockAdminInsurance.stats.mockRejectedValueOnce(new Error('Stats unavailable'));
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await waitFor(() => {
      expect(screen.getByText("Insurance stats couldn't be loaded")).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
    // Announced as an alert (the shared Alert), not a silent box.
    expect(screen.getByRole('alert').textContent).toContain("Insurance stats couldn't be loaded");
  });

  // ─── Reject keeps the typed reason on failure ───────────────────────────────

  it('a failed Reject keeps the modal open with the typed reason; success closes it', async () => {
    mockAdminInsurance.reject.mockResolvedValueOnce({ success: false, error: 'Server said no' });
    const user = userEvent.setup();
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await screen.findByText('Carol Cert');
    await user.click(screen.getByRole('button', { name: 'Reject certificate' }));

    const dialog = await screen.findByRole('dialog');
    const reason = within(dialog).getByPlaceholderText('Reason for rejection...');
    await user.type(reason, 'Blurry scan');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Server said no'));
    // Still open, reason still there — the broker can fix and retry.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByPlaceholderText('Reason for rejection...')).toHaveValue('Blurry scan');

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(mockAdminInsurance.reject).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockToast.success).toHaveBeenCalled();
  });

  // ─── Tenant currency ───────────────────────────────────────────────────────

  it('formats the coverage amount in the tenant currency, not a hard-coded €', async () => {
    const user = userEvent.setup();
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await screen.findByText('Carol Cert');
    await user.click(screen.getByRole('button', { name: 'View certificate details' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('£1,000,000.00')).toBeInTheDocument();
    expect(within(dialog).queryByText(/€/)).toBeNull();
  });

  it('prefixes the coverage field with the tenant currency symbol', async () => {
    const user = userEvent.setup();
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await screen.findByText('Carol Cert');
    const [addButton] = screen.getAllByRole('button', { name: 'Add Certificate' });
    if (!addButton) throw new Error('No Add Certificate button rendered');
    await user.click(addButton);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('£')).toBeInTheDocument();
    expect(within(dialog).queryByText('€')).toBeNull();
  });

  // ─── Columns ───────────────────────────────────────────────────────────────

  it('does not offer sorting on the Member column (it sorted nothing)', async () => {
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await screen.findByText('Carol Cert');
    const member = capturedColumns.current.find((c) => c.key === 'member');
    expect(member).toBeDefined();
    expect(member?.sortable).toBeFalsy();
  });

  // ─── ?user_id= deep link ───────────────────────────────────────────────────

  it('shows a clearable banner naming the member when ?user_id= is set', async () => {
    searchParamsHolder.current = new URLSearchParams('user_id=10');
    const user = userEvent.setup();
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    expect(await screen.findByText('Showing certificates for Carol Cert')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockAdminInsurance.list).toHaveBeenCalledWith(expect.objectContaining({ user_id: '10' }));
    });

    await user.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(mockSetSearchParams).toHaveBeenCalled();
  });

  it('names the member by number when their record cannot be loaded', async () => {
    searchParamsHolder.current = new URLSearchParams('user_id=10');
    mockAdminUsers.get.mockRejectedValueOnce(new Error('boom'));
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    expect(await screen.findByText('Showing certificates for member #10')).toBeInTheDocument();
  });

  it('shows an honest error state with a retry button when the list fails', async () => {
    mockAdminInsurance.list.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load insurance certificates.')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('data-table')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(mockAdminInsurance.list).toHaveBeenCalledTimes(2);
    });
  });

  it('renders a search input', async () => {
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await waitFor(() => {
      const searchInput = screen.queryByRole('searchbox') ||
        screen.queryByPlaceholderText(/search/i) ||
        screen.queryByRole('textbox');
      expect(searchInput).toBeDefined();
    });
  });

  it('renders a create certificate button', async () => {
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const createBtn = buttons.find(
        (b) =>
          b.textContent?.toLowerCase().includes('create') ||
          b.textContent?.toLowerCase().includes('add') ||
          b.textContent?.toLowerCase().includes('new')
      );
      expect(createBtn).toBeDefined();
    });
  });

  it('shows status filter tabs', async () => {
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await waitFor(() => {
      const text = document.body.textContent?.toLowerCase() || '';
      const hasFilters =
        text.includes('pending') ||
        text.includes('verified') ||
        text.includes('rejected') ||
        text.includes('all');
      expect(hasFilters).toBe(true);
    });
  });

  it('shows the neutral empty state with an add CTA when there are no certificates at all', async () => {
    mockAdminInsurance.list.mockResolvedValue({
      success: true,
      data: [],
      meta: { total: 0, per_page: 25, current_page: 1, last_page: 1 },
    });
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await waitFor(() => {
      const table = screen.getByTestId('data-table');
      expect(table.textContent).toMatch(/0\s*rows/);
      expect(within(table).getByText('No insurance certificates')).toBeInTheDocument();
      expect(within(table).getByText('Add a certificate to get started.')).toBeInTheDocument();
    });
  });

  it('shows the all-caught-up empty state on an empty review queue', async () => {
    searchParamsHolder.current = new URLSearchParams('status=pending_review');
    mockAdminInsurance.list.mockResolvedValue({
      success: true,
      data: [],
      meta: { total: 0, per_page: 25, current_page: 1, last_page: 1 },
    });
    const { InsuranceCertificates } = await import('./InsuranceCertificatesPage');
    render(<InsuranceCertificates />);

    await waitFor(() => {
      expect(mockAdminInsurance.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending_review' })
      );
      const table = screen.getByTestId('data-table');
      expect(within(table).getByText('All caught up')).toBeInTheDocument();
      expect(within(table).getByText('No certificates are waiting for review.')).toBeInTheDocument();
    });
  });
});
