// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { createContext, useContext, useRef, useState } from 'react';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
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
  // A row's "More" menu. Closed until its trigger is pressed, as the real one
  // is: an item that is not on screen cannot be found or clicked by a test.
  const MenuContext = createContext<{ open: boolean; toggle: () => void; act: (key: string) => void; setAct: (fn: (key: string) => void) => void }>({
    open: false, toggle: () => {}, act: () => {}, setAct: () => {},
  });

  const tableOverrides: Record<string, unknown> = {
    Dropdown: ({ children }: { children?: React.ReactNode }) => {
      const [open, setOpen] = useState(false);
      const action = useRef<(key: string) => void>(() => {});
      return (
        <MenuContext.Provider value={{
          open,
          toggle: () => setOpen((was) => !was),
          act: (key) => { setOpen(false); action.current(key); },
          setAct: (fn) => { action.current = fn; },
        }}>
          <div data-row-menu="">{children}</div>
        </MenuContext.Provider>
      );
    },
    DropdownTrigger: ({ children }: { children?: React.ReactNode }) => {
      const menu = useContext(MenuContext);
      return <span onClick={menu.toggle}>{children}</span>;
    },
    DropdownMenu: ({ children, onAction }: { children?: React.ReactNode; onAction?: (key: string) => void }) => {
      const menu = useContext(MenuContext);
      menu.setAct((key) => onAction?.(key));
      return menu.open ? <div role="menu">{children}</div> : null;
    },
    DropdownItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => {
      const menu = useContext(MenuContext);
      return <button type="button" role="menuitem" onClick={() => menu.act(String(id))}>{children}</button>;
    },
    // A native select, so the over-limit rule dialog's choice can be made.
    Select: ({ children, label, selectedKeys, onSelectionChange, isDisabled }: {
      children?: React.ReactNode; label?: string; isDisabled?: boolean;
      selectedKeys?: Iterable<string>; onSelectionChange?: (keys: Set<string>) => void;
    }) => {
      const keys = selectedKeys ? Array.from(selectedKeys) : [];
      return (
        <select aria-label={label} disabled={isDisabled} value={keys[0] ?? ''} onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}>
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
  currency: 'eur',
  price_monthly: 49,
  price_yearly: 490,
  billing_interval: null,
  notes: null,
  is_active: true,
  custom_price_monthly: null,
  custom_price_yearly: null,
  discount_percentage: 0,
  discount_reason: null,
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
  billing_currency: 'eur',
  suggested_plan: 'pro',
  over_limit: false,
  over_limit_rule: makeOverLimit(),
  upgrade_allowed: true,
  standing: makeStanding(),
  pause_on: null,
  last_payment: null,
  payment_alerts: { refunded: false, disputed: false },
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

/**
 * The list of communities itself. A community that is not set up yet is also
 * named in "Still to set up" above it, so a name alone is found twice.
 */
const inList = () => {
  const row = screen.getAllByRole('row')[0]!;
  return within((row.closest('table,[role="grid"],[role="table"]') ?? row.parentElement) as HTMLElement);
};

const button = (label: string) =>
  screen.queryAllByRole('button').find((b) => b.textContent?.trim() === label);

/**
 * An item of a row's "More" menu, opening that menu first if it is closed.
 * The first row's menu unless a community is named. Undefined when the menu
 * has no such item.
 */
const more = (label: string, community?: string) => {
  const trigger = screen.queryAllByRole('button').find((b) => {
    const name = b.getAttribute('aria-label') ?? '';
    return community ? name === `More actions for ${community}` : name.startsWith('More actions for');
  });
  const box = trigger?.closest('[data-row-menu]');
  if (!trigger || !(box instanceof HTMLElement)) return undefined;
  if (!within(box).queryByRole('menu')) fireEvent.click(trigger);
  return within(box).queryAllByRole('menuitem').find((b) => b.textContent?.trim() === label);
};

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
    if (url === '/v2/admin/super/billing/how-to-pay') {
      return Promise.resolve({ success: true, data: { how_to_pay: 'Pay by bank transfer.', how_to_pay_max: 600 } });
    }
    if (url === '/v2/admin/super/billing/standing/last-run') {
      return Promise.resolve({ success: true, data: { at: null, result: null, actions: 0 } });
    }
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

  it('carries no "under development" warning: the owner had it removed on 23 Nov 2026', async () => {
    await renderWith([makeSnapshot()]);

    expect(screen.queryByText((text) => text.toLowerCase().includes('under development'))).not.toBeInTheDocument();
    expect(screen.queryByTitle((title) => title.toLowerCase().includes('under development'))).not.toBeInTheDocument();
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

    expect(inList().getByText('Cork Timebank')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    // 490 a year, however the locale writes the currency.
    expect(screen.getByText((text) => text.includes('490'))).toBeInTheDocument();
  });

  it('marks a plan shown on its hub’s terms', async () => {
    await renderWith([
      makeSnapshot({ current_plan: makePlanOnRow({ terms: 'hub' }) }),
      makeSnapshot({ id: 6, name: 'Galway Timebank', current_plan: makePlanOnRow({ terms: 'default' }), standing: makeStanding({ tenant_id: 6 }) }),
    ]);

    expect(screen.getAllByText("On its parent community's terms")).toHaveLength(1);
  });

  it('writes the account counts in the reader’s number format', async () => {
    await renderWith([makeSnapshot({ own_user_count: 1043, subtree_user_count: 1243 })]);

    // Everyone in its branch, then how many of those are its own.
    expect(screen.getByTestId('billing-members-all')).toHaveTextContent('1,243');
    expect(screen.getByTestId('billing-members-own')).toHaveTextContent('1,043');
    expect(screen.getByText('This community alone')).toBeInTheDocument();
  });

  it('says nothing of "this community alone" for a community with none below it', async () => {
    await renderWith([makeSnapshot({ own_user_count: 80, subtree_user_count: 80 })]);

    expect(screen.getByTestId('billing-members-all')).toHaveTextContent('80');
    expect(screen.queryByTestId('billing-members-own')).not.toBeInTheDocument();
  });

  it('has five columns, and none of the ten it had when it scrolled sideways', async () => {
    await renderWith([makeSnapshot()]);

    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Community', 'Plan and members', 'If over', 'Payment', 'Actions',
    ]);
    expect(screen.queryByText((text) => text.includes('scroll sideways'))).not.toBeInTheDocument();
  });

  it('says once what an active member is, with the number of days the server sends', async () => {
    await renderWith([makeSnapshot({ active_window_days: 45 })]);

    expect(screen.getByText(
      'Active members are those who signed in during the last 45 days. Each number includes the communities below. A plan\'s limit counts active members, not everyone with an account.',
    )).toBeInTheDocument();
  });

  it('labels the two member numbers: the active one the limit counts, and everyone', async () => {
    // Owner, 23 Nov 2026: "Users 274" and "Members 35 / 50" side by side read as a fault.
    await renderWith([makeSnapshot({ own_user_count: 274, subtree_user_count: 274, active_member_count: 35, usage_percent: 17 })]);

    expect(screen.getByText('Active members')).toBeInTheDocument();
    expect(screen.getByText('All members')).toBeInTheDocument();
    expect(membersCell(0)).toHaveTextContent('35 of 200 (17%)');
    expect(screen.getByTestId('billing-members-all')).toHaveTextContent('274');
    // The total is information: never coloured, whatever the active number is.
    expect(screen.getByTestId('billing-members-all').className).not.toMatch(/text-(warning|danger)/);
  });

  it('is titled Billing control and calls the first column Community', async () => {
    await renderWith([makeSnapshot()]);

    expect(screen.getAllByText('Billing control').length).toBeGreaterThan(0);
    expect(screen.getByText('Community')).toBeInTheDocument();
    expect(screen.queryByText('Tenant')).not.toBeInTheDocument();
  });

  it('shows "No plan" only when current_plan is null', async () => {
    await renderWith([
      makeSnapshot(),
      makeSnapshot({ id: 6, name: 'Galway Timebank', current_plan: null, standing: makeStanding({ tenant_id: 6 }) }),
    ]);

    expect(screen.getAllByText('No plan')).toHaveLength(1);
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });

  // Stage 5: a failed card payment leaves the plan `expired`. Until then the
  // snapshot read only active plans, so such a community showed "No plan".
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
    expect(screen.queryByText('No plan')).not.toBeInTheDocument();
  });

  it('adds no status chip beside an active plan', async () => {
    await renderWith([makeSnapshot()]);

    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
    expect(screen.queryByText('Trial')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancelled')).not.toBeInTheDocument();
  });

  it('marks a community over its member limit, and still says which plan it is on', async () => {
    await renderWith([makeSnapshot({ over_limit: true })]);

    expect(screen.getByText('Over its member limit')).toBeInTheDocument();
    // "Over its member limit" used to REPLACE the plan's name on the one row that
    // needed a decision about its plan.
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });

  it('shows the price in the currency the community is charged in, for the period it pays by', async () => {
    await renderWith([
      // Paid by hand: both figures, in euro.
      makeSnapshot(),
      // A pound community paying yearly by card: the yearly pound price only.
      makeSnapshot({
        id: 6,
        name: 'Leeds Timebank',
        billing_currency: 'gbp',
        current_plan: makePlanOnRow({
          currency: 'gbp', price_monthly: 42, price_yearly: 420, billing_interval: 'yearly',
          effective_price: { monthly: 42, yearly: 420, has_custom: false, discount_pct: 0, nonprofit: false },
        }),
        standing: makeStanding({ tenant_id: 6, payer: 'platform_card' }),
      }),
    ]);

    const prices = screen.getAllByTestId('billing-price');
    expect(prices[0]).toHaveTextContent(/€\s?49 per month/);
    expect(prices[0]).toHaveTextContent(/€\s?490 per year/);
    expect(prices[1]).toHaveTextContent(/£\s?420 per year/);
    expect(prices[1]).not.toHaveTextContent('per month');
    expect(prices[1]).not.toHaveTextContent('€');
  });

  it('filters to the communities with no plan, or with no paid-until date', async () => {
    await renderWith([
      makeSnapshot({ standing: makeStanding({ paid_until: '2027-01-01' }) }),
      makeSnapshot({ id: 6, name: 'Galway Timebank', current_plan: null, standing: makeStanding({ tenant_id: 6 }) }),
      makeSnapshot({ id: 7, name: 'Exempt Timebank', standing: makeStanding({ tenant_id: 7, exempt: true }) }),
    ]);

    const filter = screen.getByLabelText('Show') as HTMLSelectElement;
    expect(screen.getByTestId('billing-filter-count')).toHaveTextContent('Showing 3 of 3 communities');
    // Each choice says how many it would show.
    expect(Array.from(filter.options).map((option) => option.textContent)).toEqual([
      'All communities (3)', 'No plan (1)', 'No paid-until date (1)', 'Paused (0)', 'Over their member limit (0)',
    ]);

    fireEvent.change(filter, { target: { value: 'no_plan' } });
    expect(inList().getByText('Galway Timebank')).toBeInTheDocument();
    expect(inList().queryByText('Cork Timebank')).not.toBeInTheDocument();
    expect(screen.getByTestId('billing-filter-count')).toHaveTextContent('Showing 1 of 3 communities');

    // No date to chase for a community nobody bills.
    fireEvent.change(filter, { target: { value: 'no_paid_until' } });
    expect(inList().getByText('Galway Timebank')).toBeInTheDocument();
    expect(inList().queryByText('Exempt Timebank')).not.toBeInTheDocument();

    fireEvent.change(filter, { target: { value: 'paused' } });
    expect(screen.getByText('No community matches this filter.')).toBeInTheDocument();
  });

  it('opens already filtered when the address asks for it, as the Revenue page\'s links do', async () => {
    window.history.pushState({}, '', '/?show=no_plan');
    try {
      await renderWith([
        makeSnapshot(),
        makeSnapshot({ id: 6, name: 'Galway Timebank', current_plan: null, standing: makeStanding({ tenant_id: 6 }) }),
      ]);

      expect((screen.getByLabelText('Show') as HTMLSelectElement).value).toBe('no_plan');
      expect(inList().getByText('Galway Timebank')).toBeInTheDocument();
      expect(inList().queryByText('Cork Timebank')).not.toBeInTheDocument();
      expect(screen.getByTestId('billing-filter-count')).toHaveTextContent('Showing 1 of 2 communities');
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('shows every community when the address asks for a filter it does not know', async () => {
    window.history.pushState({}, '', '/?show=everything-please');
    try {
      await renderWith([makeSnapshot()]);

      expect((screen.getByLabelText('Show') as HTMLSelectElement).value).toBe('all');
      expect(inList().getByText('Cork Timebank')).toBeInTheDocument();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('keeps the page on screen while it reloads after an action', async () => {
    await renderWith([makeSnapshot()]);
    // The reload after an action never resolves here: the table must stay.
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/v2/admin/super/billing/snapshot') return new Promise(() => {});
      return Promise.resolve({ success: true, data: [] });
    });

    fireEvent.click(more('Exempt')!);
    await userEvent.type(await screen.findByLabelText(/reason/i), 'Founding member');
    fireEvent.click(screen.getAllByRole('button').filter((b) => b.textContent?.trim() === 'Exempt this community').pop()!);

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled());
    // It used to be replaced by a spinner on every action, which threw away
    // whatever was being typed on the page.
    expect(inList().getByText('Cork Timebank')).toBeInTheDocument();
  });

  it('says the list could not be loaded, and offers to try again, instead of an empty table', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/v2/admin/super/billing/snapshot') return Promise.resolve({ success: false, data: null });
      return Promise.resolve({ success: true, data: [] });
    });
    const { BillingControl } = await import('./BillingControl');
    render(<BillingControl />);

    expect(await screen.findByText('The list could not be loaded.')).toBeInTheDocument();
    expect(button('Try again')).toBeDefined();
    expect(screen.queryByText('Failed to load')).not.toBeInTheDocument();
    // A failed load is not an empty platform.
    expect(screen.queryByText('There are no communities yet.')).not.toBeInTheDocument();
  });

  // ── Assign plan: the dialog ───────────────────────────────────────────────

  it('opens Assign plan on what is stored, so saving a new price does not wipe the notes or the date', async () => {
    await renderWith([
      makeSnapshot({ current_plan: makePlanOnRow({ notes: 'Agreed in March.', expires_at: '2027-03-01 00:00:00' }) }),
    ]);

    fireEvent.click(more('Change plan or price')!);

    expect(await screen.findByLabelText('Review date')).toHaveValue('2027-03-01');
    expect(screen.getByLabelText('Notes')).toHaveValue('Agreed in March.');
    expect(screen.getByText('A reminder for the platform team. Nothing happens automatically on this date.')).toBeInTheDocument();

    fireEvent.click(button('Agreed price (optional)')!);
    await userEvent.type(screen.getByLabelText('Special price per month (EUR)'), '30');
    fireEvent.click(screen.getAllByRole('button').filter((b) => b.textContent?.trim() === 'Save').pop()!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/billing/assign-plan', expect.objectContaining({
        tenant_id: 5,
        pay_plan_id: 2,
        expires_at: '2027-03-01',
        notes: 'Agreed in March.',
        custom_price_monthly: 30,
      }));
    });
  });

  it('names the pound for a pound community on a plan with a pound price', async () => {
    serveGets([]);
    const pounds = [
      makePlan({ price_monthly_gbp: '42.00', price_yearly_gbp: '420.00' }),
    ];
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/plans')) return Promise.resolve({ success: true, data: pounds });
      if (url === '/v2/admin/super/billing/snapshot') {
        return Promise.resolve({ success: true, data: [makeSnapshot({ billing_currency: 'gbp', current_plan: makePlanOnRow({ currency: 'gbp' }) })] });
      }
      return Promise.resolve({ success: true, data: [] });
    });
    const { BillingControl } = await import('./BillingControl');
    render(<BillingControl />);
    await waitFor(() => expect(screen.queryAllByRole('row').length).toBeGreaterThan(1));

    fireEvent.click(more('Change plan or price')!);

    await screen.findByLabelText('Review date');
    fireEvent.click(button('Agreed price (optional)')!);
    const monthly = await screen.findByLabelText('Special price per month (GBP)');
    expect(monthly).toHaveAttribute('placeholder', '42.00');
    expect(screen.getByLabelText('Special price per year (GBP)')).toBeInTheDocument();
  });

  it('offers the retired plan a community is already on, marked as retired, and no other retired plan', async () => {
    await renderWith([
      makeSnapshot({ current_plan: makePlanOnRow({ id: 12, name: 'Old Starter', slug: 'legacy-starter-3', is_active: false }) }),
    ]);

    fireEvent.click(more('Change plan or price')!);

    const select = await screen.findByLabelText('Select plan') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(['Pro', 'Growth', 'Old Starter (retired)']);
    expect(select.value).toBe('12');
  });

  it('tells the platform team a card payer changes plan on its own Billing page, and locks the plan and price', async () => {
    await renderWith([makeSnapshot({ standing: makeStanding({ payer: 'platform_card' }) })]);

    fireEvent.click(more('Change plan or price')!);

    expect(await screen.findByText(/pays by card\. Its plan and price are changed from its own Billing page/)).toBeInTheDocument();
    expect(screen.getByLabelText('Select plan')).toBeDisabled();
    // The price fields are disabled too; the shared input stand-in does not
    // carry `isDisabled`, so that is not asserted here. The server refuses
    // either change for a card payer (BillingControlEditingTest).
    expect(screen.getByLabelText('Notes')).not.toBeDisabled();
  });

  it('shows the server’s reason when a plan cannot be assigned', async () => {
    await renderWith([makeSnapshot()]);
    mockApi.post.mockResolvedValue({ success: false, error: 'This community pays by card, and its card is charged for the plan on its card payment.' });

    fireEvent.click(more('Change plan or price')!);
    await screen.findByLabelText('Review date');
    fireEvent.click(screen.getAllByRole('button').filter((b) => b.textContent?.trim() === 'Save').pop()!);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('This community pays by card, and its card is charged for the plan on its card payment.');
    });
  });

  // ── Assign plan: plain about the price (23 Nov 2026) ─────────────────────

  it('says what the community will pay, and keeps the price adjustments folded away', async () => {
    await renderWith([makeSnapshot()]);

    fireEvent.click(more('Change plan or price')!);

    const willPay = await screen.findByTestId('assign-will-pay');
    expect(willPay).toHaveTextContent('It will pay');
    expect(willPay).toHaveTextContent(/€\s?49 per month/);
    expect(willPay).toHaveTextContent(/€\s?490 per year/);

    // Closed: this community has no agreed price.
    expect(button('Agreed price (optional)')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Special price per month (EUR)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Discount (%)')).not.toBeInTheDocument();

    fireEvent.click(button('Agreed price (optional)')!);
    expect(screen.getByText(/A special price replaces the plan's price\./)).toBeInTheDocument();
    // No "0" sitting in the discount as if somebody had typed it.
    expect(screen.getByLabelText('Discount (%)')).toHaveValue(null);

    // The figure follows what is typed, before anything is saved.
    await userEvent.type(screen.getByLabelText('Special price per month (EUR)'), '30');
    expect(willPay).toHaveTextContent(/€\s?30 per month/);
    expect(willPay).toHaveTextContent(/€\s?490 per year/);
  });

  it('opens the agreed price for a community that has one, and works the figure out as the server does', async () => {
    await renderWith([
      makeSnapshot({
        current_plan: makePlanOnRow({ custom_price_monthly: 30, discount_percentage: 50, nonprofit_verified: true }),
      }),
    ]);

    fireEvent.click(more('Change plan or price')!);

    // 30 a month: 20% off for a non-profit is 24, then half off is 12.
    // 490 a year: 392, then 196.
    const willPay = await screen.findByTestId('assign-will-pay');
    expect(willPay).toHaveTextContent(/€\s?12 per month/);
    expect(willPay).toHaveTextContent(/€\s?196 per year/);

    expect(button('Agreed price (optional)')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Special price per month (EUR)')).toHaveValue(30);
    expect(screen.getByLabelText('Discount (%)')).toHaveValue(50);
  });

  it('names the dialog and its button for what is being done', async () => {
    await renderWith([makeSnapshot({ current_plan: null, usage_percent: null })]);

    fireEvent.click(button('Assign plan')!);
    await screen.findByLabelText('Review date');

    // No plan yet: it is being assigned.
    expect(screen.getAllByText('Assign plan').length).toBeGreaterThan(1);
    expect(button('Save')).toBeUndefined();
    expect(screen.queryByText('Plan and price')).not.toBeInTheDocument();
  });

  it('asks for the paid-until date straight after a plan is saved for a community that has none', async () => {
    await renderWith([makeSnapshot()]);
    mockApi.post.mockResolvedValue({ success: true, data: {} });

    fireEvent.click(more('Change plan or price')!);
    await screen.findByLabelText('Review date');
    fireEvent.click(screen.getAllByRole('button').filter((b) => b.textContent?.trim() === 'Save').pop()!);

    expect(await screen.findByText(
      'The plan is saved. Now set the date this community is paid up to, so that reminders and checks can start.',
    )).toBeInTheDocument();
    expect(screen.getByLabelText('Paid up to and including')).toBeInTheDocument();
  });

  it('does not ask for a date the community already has, or one nobody bills it for', async () => {
    await renderWith([
      makeSnapshot({ standing: makeStanding({ paid_until: '2027-01-31' }) }),
      makeSnapshot({ id: 7, name: 'Bandon Timebank', standing: makeStanding({ tenant_id: 7, exempt: true }) }),
    ]);
    mockApi.post.mockResolvedValue({ success: true, data: {} });

    for (const community of ['Cork Timebank', 'Bandon Timebank']) {
      fireEvent.click(more('Change plan or price', community)!);
      await screen.findByLabelText('Review date');
      fireEvent.click(screen.getAllByRole('button').filter((b) => b.textContent?.trim() === 'Save').pop()!);
      await waitFor(() => expect(screen.queryByLabelText('Review date')).not.toBeInTheDocument());
      expect(screen.queryByLabelText('Paid up to and including')).not.toBeInTheDocument();
    }
    expect(mockApi.post).toHaveBeenCalledTimes(2);
  });

  it('says so when the plans could not be loaded, and does not show an empty list as if there were none', async () => {
    serveGets([makeSnapshot()]);
    const served = mockApi.get.getMockImplementation()!;
    mockApi.get.mockImplementation((url: string) => (
      url.includes('/plans') ? Promise.resolve({ success: false, data: null }) : served(url)
    ));
    const { BillingControl } = await import('./BillingControl');
    render(<BillingControl />);
    await waitFor(() => expect(screen.queryAllByRole('row').length).toBeGreaterThan(1));

    fireEvent.click(more('Change plan or price')!);

    expect(await screen.findByText('The plans could not be loaded. Close this box and try again.')).toBeInTheDocument();
  });

  // ── Still to set up (23 Nov 2026) ────────────────────────────────────────

  it('lists the billed communities with no plan or no paid-until date, each with one button', async () => {
    await renderWith([
      makeSnapshot({ standing: makeStanding({ paid_until: '2027-01-31' }) }),
      makeSnapshot({ id: 6, name: 'Galway Timebank', current_plan: null, usage_percent: null, standing: makeStanding({ tenant_id: 6 }) }),
      makeSnapshot({ id: 7, name: 'Leeds Timebank', standing: makeStanding({ tenant_id: 7 }) }),
      makeSnapshot({ id: 8, name: 'Sligo Timebank', current_plan: null, usage_percent: null, standing: makeStanding({ tenant_id: 8, paid_until: '2027-01-31' }) }),
      // Nobody bills these two: nothing is missing.
      makeSnapshot({ id: 9, name: 'Derry Timebank', current_plan: null, usage_percent: null, standing: makeStanding({ tenant_id: 9, payer: 'not_billed' }) }),
      makeSnapshot({ id: 10, name: 'Ennis Timebank', standing: makeStanding({ tenant_id: 10, exempt: true }) }),
    ]);

    const box = within(screen.getByTestId('still-to-set-up'));
    expect(box.getByText('Still to set up (3)')).toBeInTheDocument();
    expect(box.queryByText('Cork Timebank')).not.toBeInTheDocument();
    expect(box.queryByText('Derry Timebank')).not.toBeInTheDocument();
    expect(box.queryByText('Ennis Timebank')).not.toBeInTheDocument();

    expect(within(screen.getByTestId('setup-item-6')).getByText('No plan and no paid-until date')).toBeInTheDocument();
    expect(within(screen.getByTestId('setup-item-7')).getByText('No paid-until date')).toBeInTheDocument();
    expect(within(screen.getByTestId('setup-item-8')).getByText('No plan')).toBeInTheDocument();

    // One button each, named for the community it acts on.
    expect(box.getByRole('button', { name: 'Assign plan: Galway Timebank' })).toBeInTheDocument();
    expect(box.getByRole('button', { name: 'Set paid-until date: Leeds Timebank' })).toBeInTheDocument();
    expect(box.getByRole('button', { name: 'Assign plan: Sligo Timebank' })).toBeInTheDocument();
    expect(box.getAllByRole('button')).toHaveLength(3);
  });

  it('opens the right box from "Still to set up"', async () => {
    await renderWith([
      makeSnapshot({ id: 6, name: 'Galway Timebank', current_plan: null, usage_percent: null, standing: makeStanding({ tenant_id: 6 }) }),
      makeSnapshot({ id: 7, name: 'Leeds Timebank', standing: makeStanding({ tenant_id: 7 }) }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Set paid-until date: Leeds Timebank' }));
    expect(await screen.findByLabelText('Paid up to and including')).toBeInTheDocument();
    fireEvent.click(button('Cancel')!);
    await waitFor(() => expect(screen.queryByLabelText('Paid up to and including')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Assign plan: Galway Timebank' }));
    expect(await screen.findByLabelText('Select plan')).toBeInTheDocument();
  });

  it('shows nothing to set up when every billed community has a plan and a date', async () => {
    await renderWith([makeSnapshot({ standing: makeStanding({ paid_until: '2027-01-31' }) })]);

    expect(screen.queryByTestId('still-to-set-up')).not.toBeInTheDocument();
  });

  it('shows who each community pays', async () => {
    await renderWith([
      makeSnapshot(),
      makeSnapshot({ id: 7, name: 'Bandon Timebank', depth: 2, parent_id: 5, standing: makeStanding({ tenant_id: 7, payer: 'parent' }) }),
    ]);

    expect(screen.getByText('Platform, by invoice')).toBeInTheDocument();
    expect(screen.getByText('Its parent community')).toBeInTheDocument();
  });


  // ── Pausing, restoring, exempting ─────────────────────────────────────────

  it('keeps one action in view and gathers the rest in the More menu', async () => {
    // Fully set up, so "Still to set up" is not on the page with its own button.
    await renderWith([makeSnapshot({ standing: makeStanding({ paid_until: '2027-01-31' }) })]);

    // A community with a plan: the next thing it needs is a payment.
    expect(button('Record a payment')).toBeDefined();
    // Not on screen until the menu is opened.
    for (const label of ['Change plan or price', 'Set paid-until date', 'Payment history', 'Change how it pays', 'Over-limit rule', 'Pause community', 'Exempt']) {
      expect(button(label)).toBeUndefined();
      expect(screen.queryAllByRole('menuitem').filter((b) => b.textContent?.trim() === label)).toHaveLength(0);
    }

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Cork Timebank' }));

    expect(screen.getAllByRole('menuitem').map((b) => b.textContent?.trim())).toEqual([
      'Change plan or price', 'Set paid-until date', 'Payment history', 'Change how it pays', 'Over-limit rule', 'Pause community', 'Exempt',
    ]);
  });

  it('puts Assign plan in view for a community with no plan, and the payment in the menu', async () => {
    await renderWith([makeSnapshot({ current_plan: null, usage_percent: null })]);

    expect(button('Assign plan')).toBeDefined();
    expect(button('Record a payment')).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Cork Timebank' }));

    expect(screen.getAllByRole('menuitem').map((b) => b.textContent?.trim()).slice(0, 2)).toEqual([
      'Record a payment', 'Set paid-until date',
    ]);
  });

  it('shows an open community as open and offers to pause or exempt it', async () => {
    await renderWith([makeSnapshot()]);

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(more('Pause community')).toBeDefined();
    expect(more('Exempt')).toBeDefined();
    expect(more('Restore community')).toBeUndefined();
    expect(more('Remove exemption')).toBeUndefined();
  });

  it('posts the community id and the note when pausing', async () => {
    const user = userEvent.setup();
    await renderWith([makeSnapshot()]);

    await user.click(more('Pause community')!);
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
    expect(more('Pause community')).toBeUndefined();

    await user.click(more('Restore community')!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/billing/standing/restore', { tenant_id: 5 });
    });
  });

  it('offers no restore on a row paused from above', async () => {
    await renderWith([
      makeSnapshot({ id: 7, name: 'Bandon Timebank', depth: 2, parent_id: 5, standing: makeStanding({ tenant_id: 7, payer: 'parent', locked: true, locked_by_tenant_id: 5 }) }),
    ]);

    expect(screen.getByText('Paused (community above)')).toBeInTheDocument();
    expect(more('Restore community')).toBeUndefined();
    // Exempting it is how the platform team opens it while the parent stays paused.
    expect(more('Exempt')).toBeDefined();
  });

  it('requires a reason before exempting', async () => {
    const user = userEvent.setup();
    await renderWith([makeSnapshot()]);

    await user.click(more('Exempt')!);
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
    expect(more('Pause community')).toBeUndefined();

    await user.click(more('Remove exemption')!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/billing/standing/exempt', { tenant_id: 5, exempt: false });
    });
  });

  it('says so and changes nothing on screen when the server refuses', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: false, error: 'This community is exempt. Remove the exemption first.', code: 'COMMUNITY_IS_EXEMPT' });
    await renderWith([makeSnapshot()]);

    await user.click(more('Pause community')!);
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

    expect(membersCell(0)).toHaveTextContent('60 of 200 (30%)');
    expect(membersCell(0).className).not.toMatch(/text-(warning|danger)/);
    // Everyone with an account is shown beside it, on its own line.
    expect(screen.getByTestId('billing-members-all')).toHaveTextContent('80');
  });

  it('colours the members by the level the server sends: warning when near, danger when over', async () => {
    await renderWith([
      makeSnapshot({ active_member_count: 170, usage_percent: 85, members_level: 'near' }),
      makeSnapshot({ id: 6, name: 'Galway Timebank', active_member_count: 210, usage_percent: 105, members_level: 'over', over_limit: true, standing: makeStanding({ tenant_id: 6 }) }),
    ]);

    expect(membersCell(0)).toHaveTextContent('170 of 200 (85%)');
    expect(membersCell(0).className).toMatch(/text-warning/);
    expect(membersCell(1)).toHaveTextContent('210 of 200 (105%)');
    expect(membersCell(1).className).toMatch(/text-danger/);
  });

  it('does not work the level out itself: the server knows the warning percent, the page does not', async () => {
    // 85% is not "near" on a platform that warns from 90%. The page used to
    // hold its own copy of the percent (80 until told otherwise).
    await renderWith([makeSnapshot({ active_member_count: 170, usage_percent: 85, members_level: 'ok' })]);

    expect(membersCell(0)).toHaveTextContent('170 of 200 (85%)');
    expect(membersCell(0).className).not.toMatch(/text-(warning|danger)/);
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

    await user.click(more('Set paid-until date')!);
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

    await user.click(more('Set paid-until date')!);
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

    await user.click(more('Set paid-until date')!);
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

  it('flags a community whose card payment was refunded or is disputed, and no other', async () => {
    await renderWith([
      makeSnapshot({ payment_alerts: { refunded: true, disputed: true } }),
      makeSnapshot({ id: 6, name: 'Galway Timebank', standing: makeStanding({ tenant_id: 6 }) }),
    ]);

    expect(screen.getAllByText('Card payment refunded')).toHaveLength(1);
    expect(screen.getAllByText('Card payment disputed')).toHaveLength(1);
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

    await user.click(more('Change how it pays')!);
    await user.click(button('Save')!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/billing/standing/payer', { tenant_id: 5, payer: null });
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Saved how this community pays'));
  });

  it('keeps setting the paid-until date, in the menu beside the other actions', async () => {
    await renderWith([makeSnapshot()]);

    expect(button('Record a payment')).toBeDefined();
    expect(more('Set paid-until date')).toBeDefined();
    expect(more('Change how it pays')).toBeDefined();
  });

  it('lets the platform team write the platform\'s how-to-pay note, and asks for it only when opened', async () => {
    await renderWith([makeSnapshot()]);

    expect(mockApi.get).not.toHaveBeenCalledWith('/v2/admin/super/billing/how-to-pay');

    fireEvent.click(button('How to pay note')!);

    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/v2/admin/super/billing/how-to-pay'));
    expect(await screen.findByTestId('how-to-pay-editor')).toHaveTextContent('Shown to every community that pays the platform by invoice:');
  });

  it('keeps one line about the automatic checks, and a link to their own page', async () => {
    await renderWith([makeSnapshot()]);

    const line = within(screen.getByTestId('automation-summary'));
    expect(await line.findByText('Automatic checks are off. Nothing is sent and no community is paused.')).toBeInTheDocument();
    expect(await line.findByText('The morning check has not run yet.')).toBeInTheDocument();
    // Where it goes is pinned in BillingAutomationSummary.test.tsx, which
    // draws the real button; the stand-in here does not make a link of it.
    expect(line.getByText('Open automatic checks')).toBeInTheDocument();
  });

  it('no longer carries the settings or the list of what would happen today', async () => {
    await renderWith([makeSnapshot()]);
    await screen.findByText('The morning check has not run yet.');

    expect(screen.queryByLabelText('Run the automatic checks every morning')).not.toBeInTheDocument();
    expect(screen.queryByText('What would happen today')).not.toBeInTheDocument();
    expect(mockApi.get).not.toHaveBeenCalledWith('/v2/admin/super/billing/standing/preview');
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

  it('shows no "grace period" marker: that switch was retired and never did anything', async () => {
    await renderWith([makeSnapshot()]);

    expect(screen.queryByText('In Grace Period')).not.toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });

  it('colours exactly at the limit as danger, as Branch payments does', async () => {
    await renderWith([
      makeSnapshot({ active_member_count: 200, usage_percent: 100, members_level: 'full' }),
      // 201 of 200 is rounded down to "100%" and is over.
      makeSnapshot({ id: 6, name: 'Galway Timebank', active_member_count: 201, usage_percent: 100, members_level: 'over', over_limit: true, standing: makeStanding({ tenant_id: 6 }) }),
    ]);

    expect(membersCell(0).className).toMatch(/text-danger/);
    expect(membersCell(1).className).toMatch(/text-danger/);
  });

  it('renders multiple tenants in the table', async () => {
    await renderWith([
      makeSnapshot(),
      makeSnapshot({ id: 6, name: 'Dublin Timebank', standing: makeStanding({ tenant_id: 6 }) }),
    ]);

    expect(inList().getByText('Cork Timebank')).toBeInTheDocument();
    expect(inList().getByText('Dublin Timebank')).toBeInTheDocument();
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
    expect(screen.getByText("parent community's default")).toBeInTheDocument();
    expect(screen.getByText(`Pause on ${formatDate('2026-12-21')}`)).toBeInTheDocument();
    expect(screen.getByText('Move up (platform team does this one by hand)')).toBeInTheDocument();
  });

  it('sets one community’s own rule through the platform endpoint', async () => {
    const user = userEvent.setup();
    await renderWith([makeSnapshot()]);

    await user.click(more('Over-limit rule')!);
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
    expect(more('Over-limit rule')).toBeUndefined();
  });

  it('draws the rule and its action for a community that has one', async () => {
    await renderWith([makeSnapshot()]);

    expect(screen.getByTestId('over-limit-summary')).toBeInTheDocument();
    expect(more('Over-limit rule')).toBeDefined();
  });

  it('leaves out moving up for a community that pays by card', async () => {
    const user = userEvent.setup();
    await renderWith([makeSnapshot({ upgrade_allowed: false })]);

    await user.click(more('Over-limit rule')!);

    expect(Array.from(ruleSelect().options).map((o) => o.textContent)).not.toContain('Move up to the next plan');
  });

  it('shows the server’s refusal of a rule as sent', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: false, error: 'Move up cannot be chosen for a card payer.', code: 'RULE_NOT_ALLOWED' });
    await renderWith([makeSnapshot()]);

    await user.click(more('Over-limit rule')!);
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Move up cannot be chosen for a card payer.'));
  });
});
