// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockAdminVolunteering } = vi.hoisted(() => ({
  mockAdminVolunteering: {
    getOrganizations: vi.fn(),
    adjustOrgWallet: vi.fn(),
    getOrgTransactions: vi.fn(),
    getOrgMembers: vi.fn(),
    updateOrganization: vi.fn(),
    createOrganization: vi.fn(),
    // Source calls updateOrgStatus (not toggleOrgStatus)
    updateOrgStatus: vi.fn(),
    // Keep alias so tests that reference toggleOrgStatus still resolve
    toggleOrgStatus: vi.fn(),
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminVolunteering: mockAdminVolunteering,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Contexts / hooks ─────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

// Default user: super admin who can manage org wallets
const mockUser = {
  id: 1,
  name: 'Admin',
  is_super_admin: true,
  is_god: false,
  is_tenant_super_admin: false,
  role: 'super_admin',
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({ user: mockUser, isAuthenticated: true }),
    useToast: () => mockToast,
    useTenant: () => ({
      hasModule: vi.fn((_key: string) => true),
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub DataTable & admin components ───────────────────────────────────────
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/DataTable' (and friends) directly, and vitest keys
// mocks per resolved module, so a barrel-only mock never installs for those
// imports — the real components rendered and the stub testids were never in the
// DOM. A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run.
async function adminComponentsMock(importOriginal: <T>() => Promise<T>) {
  const actual = await importOriginal<typeof import('../../components')>();
  return {
    ...actual,
    PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
    EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
    // DataTable: source passes `data` (not `items`) — mirror the real prop name
    DataTable: ({ data, columns, topContent }: {
      data: Array<{ id: number; org_name: string; status: string; balance: number; [key: string]: unknown }>;
      columns: Array<{ key: string; label: string; render?: (item: unknown) => React.ReactNode }>;
      topContent?: React.ReactNode;
      isLoading?: boolean;
    }) => (
      <div>
        {topContent}
        <table>
          <thead>
            <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {(data ?? []).map((item) => (
              <tr key={item.id} data-testid="org-row">
                {columns.map((c) => (
                  <td key={c.key}>
                    {c.render ? c.render(item) : String(item[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/DataTable', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/EmptyState', adminComponentsMock);
vi.mock('../../components/ConfirmModal', adminComponentsMock);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeOrg = (overrides = {}) => ({
  id: 1,
  org_id: 10,
  org_name: 'Green Volunteers',
  description: 'A test org',
  contact_email: 'org@example.com',
  website: null,
  org_type: 'organisation' as const,
  meeting_schedule: null,
  status: 'active',
  balance: 50,
  total_in: 100,
  total_out: 50,
  member_count: 5,
  opportunity_count: 3,
  total_hours: 120,
  created_at: '2025-01-01T00:00:00Z',
  ...overrides,
});

const makeOk = (data: unknown, meta = {}) => ({ success: true, data, meta });

// ─────────────────────────────────────────────────────────────────────────────
describe('VolunteerOrganizations', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminVolunteering.getOrganizations.mockResolvedValue(makeOk([makeOrg()]));
    mockAdminVolunteering.getOrgTransactions.mockResolvedValue(makeOk([], { has_more: false }));
    mockAdminVolunteering.getOrgMembers.mockResolvedValue(makeOk([]));
    mockAdminVolunteering.adjustOrgWallet.mockResolvedValue({ success: true });
    mockAdminVolunteering.updateOrganization.mockResolvedValue({ success: true });
    mockAdminVolunteering.createOrganization.mockResolvedValue({ success: true, data: makeOrg() });
    mockAdminVolunteering.updateOrgStatus.mockResolvedValue({ success: true });
    mockAdminVolunteering.toggleOrgStatus.mockResolvedValue({ success: true });
  });

  it('shows empty state when no organizations exist', async () => {
    mockAdminVolunteering.getOrganizations.mockResolvedValue(makeOk([]));
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders organization row with name', async () => {
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);

    await waitFor(() => {
      expect(screen.getByText('Green Volunteers')).toBeInTheDocument();
    });
  });

  // Edit, Members, wallet and status actions live in each row's Manage menu.
  async function chooseFromManageMenu(orgName: string, item: RegExp) {
    await userEvent.click(screen.getByRole('button', { name: `Manage ${orgName}` }));
    const menuItem = (await screen.findAllByRole('menuitem')).find((m) => item.test(m.textContent ?? ''));
    expect(menuItem).toBeDefined();
    await userEvent.click(menuItem!);
  }

  it('opens the edit dialog from the Manage menu', async () => {
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);
    await screen.findByText('Green Volunteers');

    await chooseFromManageMenu('Green Volunteers', /edit/i);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('Green Volunteers')).toBeInTheDocument();
  });

  it('opens the adjust balance dialog from the Manage menu', async () => {
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);
    await screen.findByText('Green Volunteers');

    await chooseFromManageMenu('Green Volunteers', /adjust/i);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('input[type="number"]')).toBeTruthy();
    expect(dialog.querySelector('textarea')).toBeTruthy();
  });

  it('opens the transaction history from the Manage menu', async () => {
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);
    await screen.findByText('Green Volunteers');

    await chooseFromManageMenu('Green Volunteers', /transactions/i);
    await screen.findByRole('dialog');
    await waitFor(() => {
      expect(mockAdminVolunteering.getOrgTransactions).toHaveBeenCalledWith(1);
    });
  });

  it('opens the members list from the Manage menu', async () => {
    mockAdminVolunteering.getOrgMembers.mockResolvedValue(makeOk([
      { id: 1, user_id: 10, first_name: 'Jane', last_name: 'Doe', role: 'volunteer', total_hours: 20 },
    ]));
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);
    await screen.findByText('Green Volunteers');

    await chooseFromManageMenu('Green Volunteers', /members/i);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Jane Doe')).toBeInTheDocument();
    expect(mockAdminVolunteering.getOrgMembers).toHaveBeenCalledWith(10);
  });

  it('suspends an active organisation only after the confirmation is accepted', async () => {
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);
    await screen.findByText('Green Volunteers');

    await chooseFromManageMenu('Green Volunteers', /suspend/i);
    const dialog = await screen.findByRole('dialog');
    expect(mockAdminVolunteering.updateOrgStatus).not.toHaveBeenCalled();

    const confirm = Array.from(dialog.querySelectorAll('button')).find((b) => /suspend/i.test(b.textContent ?? ''));
    expect(confirm).toBeDefined();
    fireEvent.click(confirm!);
    await waitFor(() => {
      expect(mockAdminVolunteering.updateOrgStatus).toHaveBeenCalledWith(1, 'suspended');
    });
  });

  it('cancelling the suspend confirmation does not change the status', async () => {
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);
    await screen.findByText('Green Volunteers');

    await chooseFromManageMenu('Green Volunteers', /suspend/i);
    const dialog = await screen.findByRole('dialog');
    const cancel = Array.from(dialog.querySelectorAll('button')).find((b) => /cancel/i.test(b.textContent ?? ''));
    expect(cancel).toBeDefined();
    fireEvent.click(cancel!);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(mockAdminVolunteering.updateOrgStatus).not.toHaveBeenCalled();
  });

  it('reactivates a suspended organisation directly, without a confirmation', async () => {
    mockAdminVolunteering.getOrganizations.mockResolvedValue(makeOk([makeOrg({ status: 'suspended' })]));
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);
    await screen.findByText('Green Volunteers');

    await chooseFromManageMenu('Green Volunteers', /^activate/i);
    await waitFor(() => {
      expect(mockAdminVolunteering.updateOrgStatus).toHaveBeenCalledWith(1, 'active');
    });
  });

  it('filters organizations by search query', async () => {
    mockAdminVolunteering.getOrganizations.mockResolvedValue(makeOk([
      makeOrg({ id: 1, org_name: 'Green Volunteers' }),
      makeOrg({ id: 2, org_name: 'Red Cross' }),
    ]));

    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);

    await waitFor(() => {
      expect(screen.getByText('Green Volunteers')).toBeInTheDocument();
      expect(screen.getByText('Red Cross')).toBeInTheDocument();
    });

    // Type into the search field
    const searchInput = document.querySelector('input[type="search"], input[placeholder*="search" i], input[placeholder*="Search" i]');
    if (searchInput) {
      fireEvent.change(searchInput, { target: { value: 'Green' } });
      await waitFor(() => {
        expect(screen.getByText('Green Volunteers')).toBeInTheDocument();
        // Red Cross should now be filtered out
        expect(screen.queryByText('Red Cross')).not.toBeInTheDocument();
      });
    }
  });

  it('shows error toast when getOrganizations fails', async () => {
    mockAdminVolunteering.getOrganizations.mockRejectedValue(new Error('network'));
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows balance value in org row', async () => {
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);

    await waitFor(() => {
      // Balance = 50 — should be rendered somewhere in the table
      expect(screen.getByText('Green Volunteers')).toBeInTheDocument();
      // Verify 50 is rendered (balance column)
      expect(document.body.textContent).toMatch(/50/);
    });
  });

  // ─── Waiting-for-approval panel ────────────────────────────────────────────
  // Regression (owner report, 2026-10-02): Approve and Decline sat in the last
  // column of an eight-column table, off-screen to the right behind a
  // horizontal scrollbar many people never noticed. A pending organisation is
  // somebody waiting on an admin, so the decision must be visible on arrival.
  const PENDING = makeOrg({ id: 7, org_id: 70, org_name: 'Developer test organisation', status: 'pending' });

  it('puts pending organisations in a panel above the table with clearly labelled Approve and Decline buttons', async () => {
    mockAdminVolunteering.getOrganizations.mockResolvedValue(makeOk([makeOrg(), PENDING]));
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);

    const panel = await screen.findByRole('region', { name: 'Waiting for your approval' });
    expect(within(panel).getByText('Developer test organisation')).toBeInTheDocument();
    // Only the pending organisation is in the panel.
    expect(within(panel).queryByText('Green Volunteers')).not.toBeInTheDocument();

    const approve = within(panel).getByRole('button', { name: 'Approve Developer test organisation' });
    const decline = within(panel).getByRole('button', { name: 'Decline Developer test organisation' });
    expect(approve).toBeVisible();
    expect(decline).toBeVisible();

    // The panel comes before the table in reading order.
    const table = screen.getByRole('table');
    expect(panel.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('approves straight from the panel', async () => {
    mockAdminVolunteering.getOrganizations.mockResolvedValue(makeOk([PENDING]));
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);

    const panel = await screen.findByRole('region', { name: 'Waiting for your approval' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Approve Developer test organisation' }));

    await waitFor(() => {
      expect(mockAdminVolunteering.updateOrgStatus).toHaveBeenCalledWith(7, 'active');
    });
  });

  it('declines from the panel only after the reason dialog is confirmed', async () => {
    mockAdminVolunteering.getOrganizations.mockResolvedValue(makeOk([PENDING]));
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);

    const panel = await screen.findByRole('region', { name: 'Waiting for your approval' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Decline Developer test organisation' }));

    const dialog = await screen.findByRole('dialog');
    expect(mockAdminVolunteering.updateOrgStatus).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'Not a local group');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));

    await waitFor(() => {
      expect(mockAdminVolunteering.updateOrgStatus).toHaveBeenCalledWith(7, 'declined', 'Not a local group');
    });
  });

  it('keeps pending rows in the table narrow: decisions are in the panel and the Manage menu', async () => {
    mockAdminVolunteering.getOrganizations.mockResolvedValue(makeOk([PENDING]));
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);

    await screen.findByRole('region', { name: 'Waiting for your approval' });
    // One Approve button on the page — the panel's — not a second in the row.
    expect(screen.getAllByRole('button', { name: 'Approve Developer test organisation' })).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Manage Developer test organisation' }));
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent ?? '');
    expect(items.some((i) => i.includes('Approve'))).toBe(true);
    // "Activate" would be a second, unlabelled way of approving.
    expect(items.some((i) => /^activate/i.test(i.trim()))).toBe(false);

    const decline = (await screen.findAllByRole('menuitem')).find((i) => i.textContent?.includes('Decline'));
    await userEvent.click(decline!);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(mockAdminVolunteering.updateOrgStatus).not.toHaveBeenCalled();
  });

  it('shows no approval panel when nothing is waiting', async () => {
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);

    await screen.findByText('Green Volunteers');
    expect(screen.queryByRole('region', { name: 'Waiting for your approval' })).not.toBeInTheDocument();
  });

  // ─── A lighter table ───────────────────────────────────────────────────────
  it('shows five columns instead of eight', async () => {
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);

    await screen.findByText('Green Volunteers');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Organization', 'Status', 'Activity', 'Wallet balance', 'Actions']);
    // Opportunities, volunteers and hours are combined into the Activity cell.
    expect(screen.getByText('Volunteers: 5')).toBeInTheDocument();
    expect(screen.getByText('Opportunities: 3')).toBeInTheDocument();
    expect(screen.getByText('Hours logged: 120')).toBeInTheDocument();
  });

  it('filters with status tabs that show how many are in each', async () => {
    mockAdminVolunteering.getOrganizations.mockResolvedValue(makeOk([
      makeOrg({ id: 1, org_name: 'Green Volunteers', status: 'active' }),
      // 'approved' is the server's synonym for active.
      makeOrg({ id: 2, org_name: 'Blue Club', status: 'approved' }),
      makeOrg({ id: 3, org_name: 'Red Cross', status: 'suspended' }),
      makeOrg({ id: 4, org_name: 'New Group', status: 'pending' }),
    ]));
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);

    const tabs = await screen.findByRole('tablist', { name: 'Filter organisations by status' });
    expect(within(tabs).getByRole('tab', { name: 'All (4)' })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: 'Waiting for approval (1)' })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: 'Active (2)' })).toBeInTheDocument();

    await userEvent.click(within(tabs).getByRole('tab', { name: 'Suspended (1)' }));
    await waitFor(() => {
      const rows = screen.getAllByTestId('org-row');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveTextContent('Red Cross');
    });
  });

  it('keeps the rarer actions in a Manage menu for each organisation', async () => {
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);

    await screen.findByText('Green Volunteers');
    // No row of red Suspend buttons down the page.
    expect(screen.queryByRole('button', { name: /suspend/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Manage Green Volunteers' }));
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent);
    expect(items).toEqual(expect.arrayContaining([
      expect.stringContaining('Edit'),
      expect.stringContaining('Members'),
      expect.stringContaining('Adjust'),
      expect.stringContaining('Transactions'),
      expect.stringContaining('Suspend'),
    ]));
  });

  it('hides wallet actions from an admin who cannot manage organisation wallets', async () => {
    const saved = { ...mockUser };
    Object.assign(mockUser, { is_super_admin: false, role: 'admin' });
    try {
      const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
      render(<VolunteerOrganizations />);

      await screen.findByText('Green Volunteers');
      await userEvent.click(screen.getByRole('button', { name: 'Manage Green Volunteers' }));
      const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent ?? '');
      expect(items.some((i) => i.includes('Edit'))).toBe(true);
      expect(items.some((i) => i.includes('Adjust') || i.includes('Transactions'))).toBe(false);
    } finally {
      Object.assign(mockUser, saved);
    }
  });

  it('calls getOrganizations on mount', async () => {
    const { VolunteerOrganizations } = await import('./VolunteerOrganizations');
    render(<VolunteerOrganizations />);

    await waitFor(() => {
      expect(mockAdminVolunteering.getOrganizations).toHaveBeenCalledTimes(1);
    });
  });
});
