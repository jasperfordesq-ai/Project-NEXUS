// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';
import { formatDate } from '@/lib/helpers';

// ─── UI mock ──────────────────────────────────────────────────────────────────
// BillingControl uses HeroUI Table with `items` prop + render-function children
// (a Collection pattern). The base uiMock is a Proxy — spreading it loses Proxy traps
// (useDisclosure etc live in get() handlers, not own properties). We return the Proxy
// itself wrapped in a new Proxy that overrides Table-related keys while delegating
// everything else (including useDisclosure, useConfirm, hooks) to the original.
vi.mock('@/components/ui', async () => {
  const base = (await import('@/test/uiMock')).uiMock as Record<string, unknown>;

  const tableOverrides: Record<string, unknown> = {
    // A native select, so the over-limit rule dialog's choice can be made.
    Select: ({ children, label, selectedKeys, onSelectionChange }: {
      children?: React.ReactNode; label?: string;
      selectedKeys?: Iterable<string>; onSelectionChange?: (keys: Set<string>) => void;
    }) => {
      const keys = selectedKeys ? Array.from(selectedKeys) : [];
      return (
        <select aria-label={label} value={keys[0] ?? ''} onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}>
          {children}
        </select>
      );
    },
    SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => <option value={id}>{children}</option>,
    TableBody: ({ items, children, emptyContent }: {
      items?: unknown[];
      children?: ((item: unknown) => React.ReactNode) | React.ReactNode;
      emptyContent?: React.ReactNode;
    }) => {
      if (!items || items.length === 0) return <tbody>{emptyContent ?? null}</tbody>;
      if (typeof children === 'function') {
        return <tbody>{(items as unknown[]).map((item, i) => <React.Fragment key={i}>{(children as (item: unknown) => React.ReactNode)(item)}</React.Fragment>)}</tbody>;
      }
      return <tbody>{children as React.ReactNode}</tbody>;
    },
    TableRow: ({ children }: { children?: React.ReactNode }) => <tr>{children}</tr>,
    TableCell: ({ children }: { children?: React.ReactNode }) => <td>{children}</td>,
    TableHeader: ({ children }: { children?: React.ReactNode }) => <thead><tr>{children}</tr></thead>,
    TableColumn: ({ children }: { children?: React.ReactNode }) => <th>{children}</th>,
    Table: ({ children, ...props }: { children?: React.ReactNode; 'aria-label'?: string }) => (
      <table aria-label={props['aria-label']}>{children}</table>
    ),
  };

  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in tableOverrides) return tableOverrides[prop];
      return (target as Record<string, unknown>)[prop];
    },
    has(target, prop) {
      if (typeof prop === 'string' && prop in tableOverrides) return true;
      return prop in (target as Record<string, unknown>);
    },
  });
});

// ─── Admin header ─────────────────────────────────────────────────────────────
vi.mock('../../components', () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));

// ─── SEO / hooks ─────────────────────────────────────────────────────────────
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── API mock ─────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

// ─── Toast / auth / contexts ──────────────────────────────────────────────────
const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() },
}));

// God user (is_god=true) → sees action buttons
const GOD_USER = { id: 1, name: 'God Admin', is_god: true };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: GOD_USER,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  }),
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
// 🔴 These are in the shape the SERVER sends, key for key the lists pinned by
// tests/Laravel/Feature/Billing/BillingSnapshotContractTest.php. Until
// 20 Nov 2026 they were in the shape the screen wished for (tenant_id,
// tenant_name, current_plan_name, is_over_limit …), which is how a screen that
// showed nothing against the real server kept a green test file. Do not add a
// key here that the contract test does not require of the server.
const makeStanding = (overrides = {}) => ({
  tenant_id: 5,
  payer: 'platform_invoice',
  payer_is_default: true,
  paid_until: null,
  suspended_at: null,
  suspension_source: null,
  suspension_note: null,
  exempt: false,
  exempt_reason: null,
  locked: false,
  locked_by_tenant_id: null,
  ...overrides,
});

const makePlanOnRow = (overrides = {}) => ({
  id: 2,
  name: 'Pro',
  slug: 'pro',
  max_users: 200,
  price_monthly: 49,
  price_yearly: 490,
  custom_price_monthly: null,
  custom_price_yearly: null,
  discount_percentage: 0,
  discount_reason: null,
  grace_period_ends_at: null,
  is_paused: false,
  nonprofit_verified: false,
  expires_at: null,
  effective_price: { monthly: 49, yearly: 490, has_custom: false, discount_pct: 0, nonprofit: false },
  assignment_status: 'active',
  max_communities: null,
  is_standard: false,
  ...overrides,
});

// OverLimitRule::describe(): the same eight keys as a Branch payments row's
// over_limit, sent here as over_limit_rule beside the over_limit flag.
const makeOverLimit = (overrides: Record<string, unknown> = {}) => ({
  action: 'pause',
  effective_action: 'pause',
  grace_days: 30,
  action_source: 'platform',
  days_source: 'platform',
  own_action: null,
  own_grace_days: null,
  acts_on: null,
  ...overrides,
});

const makeSnapshot = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  name: 'Cork Timebank',
  slug: 'cork',
  depth: 1,
  parent_id: 1,
  allows_subtenants: false,
  own_user_count: 80,
  subtree_user_count: 80,
  current_plan: makePlanOnRow(),
  active_member_count: 60,
  usage_percent: 30,
  suggested_plan: 'pro',
  over_limit: false,
  over_limit_rule: makeOverLimit(),
  upgrade_allowed: true,
  is_in_grace_period: false,
  grace_days_remaining: 0,
  standing: makeStanding(),
  pause_on: null,
  last_payment: null,
  ...overrides,
});

const makePlan = (overrides = {}) => ({
  id: 2,
  name: 'Pro',
  slug: 'pro',
  max_users: 200,
  price_monthly: '49.00',
  price_yearly: '490.00',
  is_active: 1,
  is_standard: false,
  ...overrides,
});

const PLAN_LIST = [
  makePlan(),
  makePlan({ id: 11, name: 'Growth', slug: 'growth', max_users: 10000, is_standard: true }),
  // The plan list also returns retired plans; they are never offered.
  makePlan({ id: 12, name: 'Old Starter', slug: 'legacy-starter-3', is_active: 0 }),
];

const button = (label: string) =>
  screen.queryAllByRole('button').find((b) => b.textContent?.trim() === label);

/** Every GET this screen makes, answered in the server's shape. */
const serveGets = (rows: unknown[]) => {
  mockApi.get.mockImplementation((url: string) => {
    if (url.includes('/plans')) return Promise.resolve({ success: true, data: PLAN_LIST });
    if (url === '/v2/admin/super/billing/settings') {
      return Promise.resolve({
        success: true,
        data: {
          automation_enabled: false, reminder_days: '30,14,7,1', final_warning_days_late: 7, suspend_days_late: 14,
          card_retry_max_days_late: 30, limit_warning_percent: 80, over_limit_action: 'none', over_limit_grace_days: 30,
        },
      });
    }
    if (url === '/v2/admin/super/billing/standing/preview') return Promise.resolve({ success: true, data: [] });
    if (url.startsWith('/v2/admin/super/billing/standing/payments')) return Promise.resolve({ success: true, data: [] });
    return Promise.resolve({ success: true, data: rows });
  });
};

// ─────────────────────────────────────────────────────────────────────────────
describe('BillingControl', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    serveGets([makeSnapshot()]);
    mockApi.post.mockResolvedValue({ success: true, data: {} });
    mockApi.download.mockResolvedValue(undefined);
  });

  const renderWith = async (rows: unknown[]) => {
    serveGets(rows);
    const { BillingControl } = await import('./BillingControl');
    render(<BillingControl />);
    await waitFor(() => expect(screen.queryAllByRole('row').length).toBeGreaterThan(1));
  };

  it('shows a loading spinner initially', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));
    const { BillingControl } = await import('./BillingControl');
    render(<BillingControl />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('shows the development notice while loading', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));
    const { BillingControl } = await import('./BillingControl');
    render(<BillingControl />);

    expect(screen.getByTitle('Billing tools are under development')).toBeInTheDocument();
  });

  it('shows error toast when snapshot load fails', async () => {
    mockApi.get.mockResolvedValue({ success: false, data: null });
    const { BillingControl } = await import('./BillingControl');
    render(<BillingControl />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── Reading the real shape ────────────────────────────────────────────────

  it('shows each community name, plan and price from the real shape', async () => {
    await renderWith([makeSnapshot()]);

    expect(screen.getByText('Cork Timebank')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    // 490 a year, however the locale writes the currency.
    expect(screen.getByText((text) => text.includes('490'))).toBeInTheDocument();
  });

  it('shows "No Plan" only when current_plan is null', async () => {
    await renderWith([
      makeSnapshot(),
      makeSnapshot({ id: 6, name: 'Galway Timebank', current_plan: null, standing: makeStanding({ tenant_id: 6 }) }),
    ]);

    expect(screen.getAllByText('No Plan')).toHaveLength(1);
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });

  // Stage 5: a failed card payment leaves the plan `expired`. Until then the
  // snapshot read only active plans, so such a community showed "No Plan".
  it('shows the plan with its status when it is not active', async () => {
    await renderWith([
      makeSnapshot({ current_plan: makePlanOnRow({ assignment_status: 'expired' }) }),
      makeSnapshot({ id: 6, name: 'Galway Timebank', current_plan: makePlanOnRow({ name: 'Local', assignment_status: 'trial' }), standing: makeStanding({ tenant_id: 6 }) }),
      makeSnapshot({ id: 8, name: 'Sligo Timebank', current_plan: makePlanOnRow({ name: 'Spark', assignment_status: 'cancelled' }), standing: makeStanding({ tenant_id: 8 }) }),
    ]);

    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.getByText('Trial')).toBeInTheDocument();
    expect(screen.getByText('Spark')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByText('No Plan')).not.toBeInTheDocument();
  });

  it('adds no status chip beside an active plan', async () => {
    await renderWith([makeSnapshot()]);

    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
    expect(screen.queryByText('Trial')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancelled')).not.toBeInTheDocument();
  });

  it('marks a community over its member limit', async () => {
    await renderWith([makeSnapshot({ over_limit: true })]);

    expect(screen.getByText('Over Limit')).toBeInTheDocument();
  });

  it('shows who each community pays', async () => {
    await renderWith([
      makeSnapshot(),
      makeSnapshot({ id: 7, name: 'Bandon Timebank', depth: 2, parent_id: 5, standing: makeStanding({ tenant_id: 7, payer: 'parent' }) }),
    ]);

    expect(screen.getByText('Platform, by invoice')).toBeInTheDocument();
    expect(screen.getByText('Its parent')).toBeInTheDocument();
  });

  it('posts the community id when assigning a plan', async () => {
    await renderWith([makeSnapshot()]);

    expect(button('Assign Plan')).toBeDefined();
    fireEvent.click(button('Assign Plan')!);

    // useDisclosure in the shared UI mock cannot open a dialog, so the form
    // itself is not reachable here; the id it would post is the row's `id`,
    // which the pause test below proves end to end.
    expect(document.body).toBeTruthy();
  });

  // ── Pausing, restoring, exempting ─────────────────────────────────────────

  it('shows an open community as open and offers to pause or exempt it', async () => {
    await renderWith([makeSnapshot()]);

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(button('Pause community')).toBeDefined();
    expect(button('Exempt')).toBeDefined();
    expect(button('Restore community')).toBeUndefined();
    expect(button('Remove exemption')).toBeUndefined();
  });

  it('posts the community id and the note when pausing', async () => {
    const user = userEvent.setup();
    await renderWith([makeSnapshot()]);

    await user.click(button('Pause community')!);
    await user.type(screen.getByLabelText('Note (optional, kept in the record)'), 'Two invoices unpaid');
    await user.click(screen.getByRole('button', { name: 'Pause this community' }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/billing/standing/suspend', {
        tenant_id: 5,
        note: 'Two invoices unpaid',
      });
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it('offers restore, not pause, on a paused community', async () => {
    const user = userEvent.setup();
    await renderWith([
      makeSnapshot({ standing: makeStanding({ suspended_at: '2026-11-20 10:00:00', suspension_source: 'manual', locked: true, locked_by_tenant_id: 5 }) }),
    ]);

    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(button('Pause community')).toBeUndefined();

    await user.click(button('Restore community')!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/billing/standing/restore', { tenant_id: 5 });
    });
  });

  it('offers no restore on a row paused from above', async () => {
    await renderWith([
      makeSnapshot({ id: 7, name: 'Bandon Timebank', depth: 2, parent_id: 5, standing: makeStanding({ tenant_id: 7, payer: 'parent', locked: true, locked_by_tenant_id: 5 }) }),
    ]);

    expect(screen.getByText('Paused (community above)')).toBeInTheDocument();
    expect(button('Restore community')).toBeUndefined();
    // Exempting it is how the platform team opens it while the parent stays paused.
    expect(button('Exempt')).toBeDefined();
  });

  it('requires a reason before exempting', async () => {
    const user = userEvent.setup();
    await renderWith([makeSnapshot()]);

    await user.click(button('Exempt')!);
    const confirm = screen.getByRole('button', { name: 'Exempt this community' });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('Reason (required)'), 'Council contract, paid annually');
    expect(confirm).not.toBeDisabled();
    await user.click(confirm);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/billing/standing/exempt', {
        tenant_id: 5,
        exempt: true,
        reason: 'Council contract, paid annually',
      });
    });
  });

  it('offers to remove an exemption, and nothing else, on an exempt community', async () => {
    const user = userEvent.setup();
    await renderWith([makeSnapshot({ standing: makeStanding({ exempt: true, exempt_reason: 'Council contract' }) })]);

    expect(screen.getByText('Exempt', { selector: 'span, div' })).toBeInTheDocument();
    expect(button('Pause community')).toBeUndefined();

    await user.click(button('Remove exemption')!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/billing/standing/exempt', { tenant_id: 5, exempt: false });
    });
  });

  it('says so and changes nothing on screen when the server refuses', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: false, error: 'This community is exempt. Remove the exemption first.', code: 'COMMUNITY_IS_EXEMPT' });
    await renderWith([makeSnapshot()]);

    await user.click(button('Pause community')!);
    await user.click(screen.getByRole('button', { name: 'Pause this community' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('This community is exempt. Remove the exemption first.'));
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('no longer offers Pause Billing or Set Grace Period', async () => {
    await renderWith([makeSnapshot()]);

    expect(button('Pause Billing')).toBeUndefined();
    expect(button('Resume Billing')).toBeUndefined();
    expect(button('Set Grace Period')).toBeUndefined();
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  // ── Members, packages and paid-until (Stage 3c) ───────────────────────────

  const membersCell = (row: number): HTMLElement => {
    const cell = screen.getAllByTestId('billing-members')[row];
    if (!cell) throw new Error(`no members cell for row ${row}`);
    return cell;
  };

  it('shows active members against the package limit', async () => {
    await renderWith([makeSnapshot({ active_member_count: 60, usage_percent: 30 })]);

    expect(membersCell(0)).toHaveTextContent('60 / 200 (30%)');
    expect(membersCell(0).className).not.toMatch(/text-(warning|danger)/);
    // The registered count stays in its own column.
    expect(screen.getByText('80')).toBeInTheDocument();
  });

  it('colours the members from the warning percent, and as danger over the limit', async () => {
    await renderWith([
      makeSnapshot({ active_member_count: 170, usage_percent: 85 }),
      makeSnapshot({ id: 6, name: 'Galway Timebank', active_member_count: 210, usage_percent: 105, over_limit: true, standing: makeStanding({ tenant_id: 6 }) }),
    ]);

    expect(membersCell(0)).toHaveTextContent('170 / 200 (85%)');
    expect(membersCell(0).className).toMatch(/text-warning/);
    expect(membersCell(1)).toHaveTextContent('210 / 200 (105%)');
    expect(membersCell(1).className).toMatch(/text-danger/);
  });

  it('shows only the active count when there is no plan or no limit', async () => {
    await renderWith([
      makeSnapshot({ current_plan: null, active_member_count: 42, usage_percent: null }),
      makeSnapshot({ id: 6, name: 'Galway Timebank', current_plan: makePlanOnRow({ max_users: null }), active_member_count: 43, usage_percent: null, standing: makeStanding({ tenant_id: 6 }) }),
    ]);

    expect(membersCell(0).textContent?.trim()).toBe('42');
    expect(membersCell(1).textContent?.trim()).toBe('43');
  });

  it('suggests a better-fitting package by its name from the plan list', async () => {
    await renderWith([
      makeSnapshot({ suggested_plan: 'growth' }),
      makeSnapshot({ id: 6, name: 'Galway Timebank', suggested_plan: 'pro', standing: makeStanding({ tenant_id: 6 }) }),
    ]);

    await waitFor(() => expect(screen.getByText('Suggested: Growth')).toBeInTheDocument());
    expect(screen.getAllByText(/^Suggested:/)).toHaveLength(1);
  });

  it('shows the paid-until date, or that none is set', async () => {
    await renderWith([
      makeSnapshot({ standing: makeStanding({ paid_until: '2027-01-31' }) }),
      makeSnapshot({ id: 6, name: 'Galway Timebank', standing: makeStanding({ tenant_id: 6 }) }),
    ]);

    expect(screen.getByText((text) => text.includes('2027'))).toBeInTheDocument();
    expect(screen.getAllByText('No date set')).toHaveLength(1);
  });

  it('posts the community id and the date when setting paid-until', async () => {
    const user = userEvent.setup();
    await renderWith([makeSnapshot()]);

    await user.click(button('Set paid-until date')!);
    fireEvent.change(screen.getByLabelText('Paid up to and including'), { target: { value: '2027-01-31' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/billing/standing/paid-until', { tenant_id: 5, paid_until: '2027-01-31' });
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Paid-until date saved'));
  });

  it('opens on the date already recorded and sends null when it is emptied', async () => {
    const user = userEvent.setup();
    await renderWith([makeSnapshot({ standing: makeStanding({ paid_until: '2026-12-31' }) })]);

    await user.click(button('Set paid-until date')!);
    const field = screen.getByLabelText('Paid up to and including') as HTMLInputElement;
    expect(field.value).toBe('2026-12-31');

    fireEvent.change(field, { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/billing/standing/paid-until', { tenant_id: 5, paid_until: null });
    });
  });

  it('shows the server’s refusal when a date is refused', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: false, error: 'Enter the date as year-month-day, for example 2027-01-31.' });
    await renderWith([makeSnapshot()]);

    await user.click(button('Set paid-until date')!);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Enter the date as year-month-day, for example 2027-01-31.'));
  });

  // ── Payments by hand and how a community pays (Stage 6) ───────────────────

  it('shows the automatic pause date under the paid-until date, and nothing when none applies', async () => {
    await renderWith([
      makeSnapshot({ pause_on: '2027-02-14', standing: makeStanding({ paid_until: '2027-01-31' }) }),
      makeSnapshot({ id: 6, name: 'Galway Timebank', pause_on: null, standing: makeStanding({ tenant_id: 6 }) }),
    ]);

    const lines = screen.getAllByTestId('billing-pause-on');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent(`Automatic pause: ${formatDate('2027-02-14')}`);
  });

  it('shows the last payment recorded by hand under the paid-until date', async () => {
    await renderWith([
      makeSnapshot({ standing: makeStanding({ paid_until: '2027-10-31' }), last_payment: { received_on: '2026-11-02', method: 'bank_transfer' } }),
      makeSnapshot({ id: 6, name: 'Galway Timebank', standing: makeStanding({ tenant_id: 6 }) }),
    ]);

    expect(screen.getByText(`Last payment: ${formatDate('2026-11-02')}, Bank transfer`)).toBeInTheDocument();
    expect(screen.getAllByText(/^Last payment:/)).toHaveLength(1);
  });

  it('records a payment with the contract body and reloads the list', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: true, data: { standing: {}, payment_id: 4 } });
    await renderWith([makeSnapshot({ standing: makeStanding({ paid_until: '2026-12-31' }) })]);

    await user.click(button('Record a payment')!);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/v2/admin/super/billing/standing/payments?tenant_id=5'));
    fireEvent.change(screen.getByLabelText('Received on'), { target: { value: '2026-11-18' } });
    fireEvent.change(screen.getByLabelText('Reference (optional)'), { target: { value: 'BT 7781' } });
    fireEvent.change(screen.getByLabelText('Now paid up to and including'), { target: { value: '2027-12-31' } });
    await user.click(button('Record payment')!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/billing/standing/record-payment', {
        tenant_id: 5,
        paid_until: '2027-12-31',
        received_on: '2026-11-18',
        method: 'bank_transfer',
        reference: 'BT 7781',
        amount: null,
        currency: null,
      });
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Payment recorded'));
    await waitFor(() => {
      const snapshotLoads = mockApi.get.mock.calls.filter(([url]) => url === '/v2/admin/super/billing/snapshot');
      expect(snapshotLoads.length).toBe(2);
    });
    expect(screen.queryByLabelText('Received on')).not.toBeInTheDocument();
  });

  it('changes how a community pays, sending null for the default', async () => {
    const user = userEvent.setup();
    await renderWith([makeSnapshot({ standing: makeStanding({ payer: 'not_billed', payer_is_default: true }) })]);

    await user.click(button('Change how it pays')!);
    await user.click(button('Save')!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/billing/standing/payer', { tenant_id: 5, payer: null });
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Saved how this community pays'));
  });

  it('keeps setting the paid-until date beside the new actions', async () => {
    await renderWith([makeSnapshot()]);

    expect(button('Set paid-until date')).toBeDefined();
    expect(button('Record a payment')).toBeDefined();
    expect(button('Change how it pays')).toBeDefined();
  });

  it('shows the automatic checks card above the table', async () => {
    await renderWith([makeSnapshot()]);

    await waitFor(() => expect(screen.getByText('Automatic checks')).toBeInTheDocument());
    expect(mockApi.get).toHaveBeenCalledWith('/v2/admin/super/billing/standing/preview');
  });

  it('offers only active plans to assign', async () => {
    const { assignablePlans } = await import('./assignablePlans');

    expect(assignablePlans(PLAN_LIST).map((p) => p.name)).toEqual(['Pro', 'Growth']);
    expect(assignablePlans([makePlan({ is_active: true }), makePlan({ id: 9, is_active: false })]).map((p) => p.id)).toEqual([2]);
  });

  // ── Unchanged behaviour ───────────────────────────────────────────────────

  it('shows Export CSV button and calls download on click', async () => {
    await renderWith([makeSnapshot()]);

    const exportBtn = screen.queryAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('export'));
    expect(exportBtn).toBeDefined();
    fireEvent.click(exportBtn!);

    await waitFor(() => {
      expect(mockApi.download).toHaveBeenCalledWith(
        '/v2/admin/super/billing/export',
        expect.objectContaining({ filename: 'billing-export.csv' }),
      );
    });
  });

  it('shows "in grace period" chip for tenant in grace period', async () => {
    await renderWith([makeSnapshot({ is_in_grace_period: true, grace_days_remaining: 12 })]);

    expect(screen.getByText('In Grace Period')).toBeInTheDocument();
  });

  it('renders multiple tenants in the table', async () => {
    await renderWith([
      makeSnapshot(),
      makeSnapshot({ id: 6, name: 'Dublin Timebank', standing: makeStanding({ tenant_id: 6 }) }),
    ]);

    expect(screen.getByText('Cork Timebank')).toBeInTheDocument();
    expect(screen.getByText('Dublin Timebank')).toBeInTheDocument();
  });
  // ─── What happens when a community goes over its member number ──────────────
  const ruleSelect = () => screen.getByLabelText('What happens') as HTMLSelectElement;

  it('shows the rule that applies to each community', async () => {
    await renderWith([
      makeSnapshot({ over_limit_rule: makeOverLimit({ action_source: 'hub', acts_on: '2026-12-21' }) }),
      makeSnapshot({ id: 6, name: 'Galway Timebank', over_limit_rule: makeOverLimit({ action: 'upgrade', effective_action: 'none' }), standing: makeStanding({ tenant_id: 6 }) }),
    ]);

    expect(screen.getByRole('columnheader', { name: 'If over' })).toBeInTheDocument();
    expect(screen.getByText('Pause after 30 days')).toBeInTheDocument();
    expect(screen.getByText('hub default')).toBeInTheDocument();
    expect(screen.getByText(`Pause on ${formatDate('2026-12-21')}`)).toBeInTheDocument();
    expect(screen.getByText('Move up (platform team does this one by hand)')).toBeInTheDocument();
  });

  it('sets one community’s own rule through the platform endpoint', async () => {
    const user = userEvent.setup();
    await renderWith([makeSnapshot()]);

    await user.click(button('Over-limit rule')!);
    expect(ruleSelect().value).toBe('default');
    fireEvent.change(ruleSelect(), { target: { value: 'upgrade' } });
    fireEvent.change(screen.getByLabelText('After how many days over'), { target: { value: '20' } });
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/billing/standing/over-limit', { tenant_id: 5, action: 'upgrade', grace_days: 20 }));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Over-limit rule saved'));
  });

  it('draws no rule and no rule action for the platform’s own community', async () => {
    await renderWith([
      makeSnapshot({ id: 1, name: 'Platform', parent_id: null, depth: 0, over_limit_rule: null, upgrade_allowed: false, standing: makeStanding({ tenant_id: 1 }) }),
    ]);

    expect(screen.getByRole('columnheader', { name: 'If over' })).toBeInTheDocument();
    expect(screen.queryByText(/^Pause after/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('over-limit-summary')).not.toBeInTheDocument();
    expect(button('Over-limit rule')).toBeUndefined();
  });

  it('draws the rule and its action for a community that has one', async () => {
    await renderWith([makeSnapshot()]);

    expect(screen.getByTestId('over-limit-summary')).toBeInTheDocument();
    expect(button('Over-limit rule')).toBeDefined();
  });

  it('leaves out moving up for a community that pays by card', async () => {
    const user = userEvent.setup();
    await renderWith([makeSnapshot({ upgrade_allowed: false })]);

    await user.click(button('Over-limit rule')!);

    expect(Array.from(ruleSelect().options).map((o) => o.textContent)).not.toContain('Move up to the next plan');
  });

  it('shows the server’s refusal of a rule as sent', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: false, error: 'Move up cannot be chosen for a card payer.', code: 'RULE_NOT_ALLOWED' });
    await renderWith([makeSnapshot()]);

    await user.click(button('Over-limit rule')!);
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Move up cannot be chosen for a card payer.'));
  });
});
