// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { createContext, useContext } from 'react';
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
  // Wires a Radio to its group, as in PayerDialog.test.tsx.
  const RadioContext = createContext<{ value: string; onValueChange: (v: string) => void }>({ value: '', onValueChange: () => {} });

  const tableOverrides: Record<string, unknown> = {
    RadioGroup: ({ value, onValueChange, children, label }: { value: string; onValueChange: (v: string) => void; children?: React.ReactNode; label?: React.ReactNode }) => (
      <fieldset>
        {label ? <legend>{label}</legend> : null}
        <RadioContext.Provider value={{ value, onValueChange }}>{children}</RadioContext.Provider>
      </fieldset>
    ),
    Radio: ({ value, children, description }: { value: string; children?: React.ReactNode; description?: React.ReactNode }) => {
      const group = useContext(RadioContext);
      return (
        <div>
          <label>
            <input type="radio" checked={group.value === value} onChange={() => group.onValueChange(value)} />
            {children}
          </label>
          {description ? <div>{description}</div> : null}
        </div>
      );
    },
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
      return Reflect.get(target, prop);
    },
    has(target, prop) {
      if (typeof prop === 'string' && prop in tableOverrides) return true;
      return prop in (target as Record<string, unknown>);
    },
  });
});

// ─── Admin header ─────────────────────────────────────────────────────────────
vi.mock('../../components/PageHeader', () => ({
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
// In the shape the SERVER sends: the keys BranchPaymentsEndpointsTest requires
// of GET /v2/admin/super/branch-payments, and BillingStandingService::get().
const makeStanding = (overrides = {}) => ({
  tenant_id: 7,
  payer: 'parent',
  payer_is_default: true,
  paid_until: null,
  suspended_at: null,
  suspension_source: null,
  exempt: false,
  locked: false,
  locked_by_tenant_id: null,
  ...overrides,
});

// OverLimitRule::for() plus what the community stores itself and its pause date.
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

const makeRow = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  name: 'Bandon Timebank',
  depth: 2,
  parent_id: 5,
  parent_name: 'Cork Timebank',
  standing: makeStanding(),
  days_late: null,
  can_act: true,
  cannot_act_reason: null,
  paused_from_above: false,
  plan: null,
  members: { active: 61, max: null, percent: null },
  plan_change_refusal: null,
  over_limit: makeOverLimit(),
  upgrade_allowed: true,
  ...overrides,
});

// The Terms shape PlanTerms::forCommunity() / availableTo() send.
const makePlan = (overrides: Record<string, unknown> = {}) => ({
  plan_id: 3,
  slug: 'local',
  name: 'Local',
  description: null,
  max_users: 250,
  currency: 'gbp',
  price_monthly: 120,
  price_yearly: 1200,
  setup_fee: 0,
  terms: 'default',
  hub_tenant_id: null,
  is_standard: true,
  ...overrides,
});

const button = (label: string) =>
  screen.queryAllByRole('button').find((b) => b.textContent?.trim() === label);

// ─────────────────────────────────────────────────────────────────────────────
describe('BranchPayments', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.post.mockResolvedValue({ success: true, data: {} });
  });

  const renderWith = async (rows: unknown[]) => {
    mockApi.get.mockResolvedValue({ success: true, data: rows });
    const { BranchPayments } = await import('./BranchPayments');
    render(<BranchPayments />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/v2/admin/super/branch-payments'));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  };

  it('shows each community, who it pays, the date it is paid up to and how late it is', async () => {
    await renderWith([
      makeRow({ standing: makeStanding({ paid_until: '2026-11-11' }), days_late: 9 }),
      makeRow({ id: 8, name: 'Kinsale Timebank', standing: makeStanding({ tenant_id: 8 }) }),
    ]);

    expect(screen.getByText('Bandon Timebank')).toBeInTheDocument();
    expect(screen.getAllByText('Cork Timebank')).toHaveLength(2);
    expect(screen.getByText((text) => text.includes('2026'))).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getAllByText('No date set')).toHaveLength(1);
    expect(screen.getAllByText('Open')).toHaveLength(2);
  });

  it('says so when there are no communities below', async () => {
    await renderWith([]);

    expect(screen.getByText('There are no communities below yours.')).toBeInTheDocument();
  });

  it('says so when the list cannot be loaded', async () => {
    mockApi.get.mockResolvedValue({ success: false, error: 'nope' });
    const { BranchPayments } = await import('./BranchPayments');
    render(<BranchPayments />);

    expect(await screen.findByText('The communities could not be loaded.')).toBeInTheDocument();
  });

  it('posts the community id and the date when recording payment', async () => {
    const user = userEvent.setup();
    await renderWith([makeRow()]);

    await user.click(button('Set paid-until date')!);
    fireEvent.change(screen.getByLabelText('Paid up to and including'), { target: { value: '2027-01-31' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/branch-payments/7/paid-until', { paid_until: '2027-01-31' });
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it('opens on the date already recorded and sends null when it is emptied', async () => {
    const user = userEvent.setup();
    await renderWith([makeRow({ standing: makeStanding({ paid_until: '2026-12-31' }) })]);

    await user.click(button('Set paid-until date')!);
    const field = screen.getByLabelText('Paid up to and including') as HTMLInputElement;
    expect(field.value).toBe('2026-12-31');

    fireEvent.change(field, { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/branch-payments/7/paid-until', { paid_until: null });
    });
  });

  it('posts the community id and the note when pausing', async () => {
    const user = userEvent.setup();
    await renderWith([makeRow()]);

    await user.click(button('Pause community')!);
    await user.type(screen.getByLabelText('Note (optional, kept in the record)'), 'Three months unpaid');
    await user.click(screen.getByRole('button', { name: 'Pause this community' }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/branch-payments/7/suspend', { note: 'Three months unpaid' });
    });
  });

  it('offers restore, not pause, on a paused community', async () => {
    const user = userEvent.setup();
    await renderWith([
      makeRow({ standing: makeStanding({ suspended_at: '2026-11-20 10:00:00', suspension_source: 'manual', locked: true, locked_by_tenant_id: 7 }) }),
    ]);

    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(button('Pause community')).toBeUndefined();

    await user.click(button('Restore community')!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/branch-payments/7/restore', {});
    });
  });

  it('explains a community paused from above and offers neither pause nor restore', async () => {
    await renderWith([
      makeRow({ paused_from_above: true, standing: makeStanding({ locked: true, locked_by_tenant_id: 5 }) }),
    ]);

    expect(screen.getByText('Paused (community above)')).toBeInTheDocument();
    expect(screen.getByText('Paused because a community above it is paused.')).toBeInTheDocument();
    expect(button('Pause community')).toBeUndefined();
    expect(button('Restore community')).toBeUndefined();
    // Recording that it has paid is still theirs to do.
    expect(button('Set paid-until date')).toBeDefined();
  });

  it('says why and offers nothing on a community that pays the platform', async () => {
    await renderWith([
      makeRow({ parent_id: 1, parent_name: 'Platform', can_act: false, cannot_act_reason: 'pays_platform', standing: makeStanding({ payer: 'platform_invoice' }) }),
    ]);

    expect(screen.getByText('Pays the platform. Only the platform team can change this.')).toBeInTheDocument();
    expect(screen.getByText('The platform')).toBeInTheDocument();
    expect(button('Set paid-until date')).toBeUndefined();
    expect(button('Pause community')).toBeUndefined();
  });

  it('says why and offers nothing on an exempt community', async () => {
    await renderWith([
      makeRow({ can_act: false, cannot_act_reason: 'exempt', standing: makeStanding({ exempt: true }) }),
    ]);

    expect(screen.getByText('Exempt. Only the platform team can change this.')).toBeInTheDocument();
    expect(button('Pause community')).toBeUndefined();
  });

  it('shows the server\'s own words when it refuses, and reports no success', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: false, error: 'This community is paused because a community above it is paused. It can only be restored there.', code: 'PAUSED_FROM_ABOVE' });
    await renderWith([
      makeRow({ standing: makeStanding({ suspended_at: '2026-11-20 10:00:00', suspension_source: 'manual', locked: true, locked_by_tenant_id: 7 }) }),
    ]);

    await user.click(button('Restore community')!);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('This community is paused because a community above it is paused. It can only be restored there.'));
    expect(mockToast.success).not.toHaveBeenCalled();
  });
  // ── Plans and member numbers (Stage 3) ─────────────────────────────────────

  const renderWithPlans = async (rows: unknown[], plans: unknown) => {
    mockApi.get.mockImplementation((url: string) => Promise.resolve(
      url === '/v2/admin/super/branch-payments'
        ? { success: true, data: rows }
        : plans,
    ));
    const { BranchPayments } = await import('./BranchPayments');
    render(<BranchPayments />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  };

  it('shows each community\'s plan, or that it has none, and marks a plan on its hub\'s terms', async () => {
    await renderWith([
      makeRow({ plan: makePlan({ terms: 'hub', hub_tenant_id: 5 }), members: { active: 212, max: 250, percent: 84 } }),
      makeRow({ id: 8, name: 'Kinsale Timebank', plan: null }),
    ]);

    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.getByText('On its hub\'s terms')).toBeInTheDocument();
    expect(screen.getByText('No plan')).toBeInTheDocument();
  });

  it('does not mark a plan on the default terms', async () => {
    await renderWith([makeRow({ plan: makePlan() })]);

    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.queryByText('On its hub\'s terms')).not.toBeInTheDocument();
  });

  it('shows the member number against the plan\'s limit, coloured as it fills', async () => {
    await renderWith([
      makeRow({ id: 7, members: { active: 120, max: 250, percent: 48 } }),
      makeRow({ id: 8, name: 'Kinsale Timebank', members: { active: 212, max: 250, percent: 84 } }),
      makeRow({ id: 9, name: 'Clonakilty Timebank', members: { active: 104, max: 100, percent: 104 } }),
      makeRow({ id: 10, name: 'Skibbereen Timebank', members: { active: 61, max: null, percent: null } }),
    ]);

    expect(screen.getByText('Members')).toBeInTheDocument();
    const calm = screen.getByText('120 / 250');
    expect(calm.className).not.toMatch(/text-(warning|danger)/);
    const near = screen.getByText('212 / 250');
    expect(near.className).toMatch(/text-warning/);
    expect(near.className).not.toMatch(/font-semibold/);
    const over = screen.getByText('104 / 100');
    expect(over.className).toMatch(/text-danger/);
    expect(over.className).toMatch(/font-semibold/);
    expect(screen.getByText('61')).toBeInTheDocument();
  });

  it('offers to change the plan only where the manager may act', async () => {
    await renderWith([
      makeRow(),
      makeRow({ id: 8, name: 'Kinsale Timebank', can_act: false, cannot_act_reason: 'pays_platform' }),
    ]);

    expect(screen.getAllByRole('button').filter((b) => b.textContent?.trim() === 'Change plan')).toHaveLength(1);
  });

  it('lists the plans the community can be put on, marks and preselects its current one, and saves the choice', async () => {
    const user = userEvent.setup();
    await renderWithPlans(
      [makeRow({ plan: makePlan(), members: { active: 212, max: 250, percent: 84 } })],
      { success: true, data: [
        makePlan({ plan_id: 2, slug: 'spark', name: 'Spark', max_users: 100, price_monthly: 150 }),
        makePlan(),
        makePlan({ plan_id: 4, slug: 'community', name: 'Community', max_users: 1000, price_monthly: 0 }),
      ] },
    );

    await user.click(button('Change plan')!);

    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/v2/admin/super/branch-payments/7/plans'));
    const spark = await screen.findByRole('radio', { name: /Spark/ });
    const local = screen.getByRole('radio', { name: /Local/ });
    expect(local).toBeChecked();
    expect(spark).not.toBeChecked();
    expect(screen.getByText('Current plan')).toBeInTheDocument();
    expect(screen.getByText('Up to 100 members')).toBeInTheDocument();
    expect(screen.getByText((text) => text.includes('£150'))).toBeInTheDocument();
    expect(screen.getByText('No price set')).toBeInTheDocument();
    // 212 active members do not fit Spark's 100.
    expect(screen.getByText('This community has 212 active members, more than this plan allows.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Community/ }));
    await user.click(screen.getByRole('button', { name: 'Save plan' }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/branch-payments/7/plan', { plan_id: 4 });
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Plan changed'));
    // Reloaded the list after the change.
    await waitFor(() => {
      expect(mockApi.get.mock.calls.filter(([url]) => url === '/v2/admin/super/branch-payments')).toHaveLength(2);
    });
  });

  it('says so when the hub offers no plans', async () => {
    const user = userEvent.setup();
    await renderWithPlans([makeRow()], { success: true, data: [] });

    await user.click(button('Change plan')!);

    expect(await screen.findByText('There are no plans this community can be put on.')).toBeInTheDocument();
  });

  it('says so when the plans cannot be loaded', async () => {
    const user = userEvent.setup();
    await renderWithPlans([makeRow()], { success: false, error: 'nope' });

    await user.click(button('Change plan')!);

    expect(await screen.findByText('The plans could not be loaded.')).toBeInTheDocument();
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('shows the server\'s own words when it refuses the plan', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: false, error: 'That plan is not offered to this community.', code: 'PLAN_NOT_OFFERED' });
    await renderWithPlans([makeRow()], { success: true, data: [makePlan()] });

    await user.click(button('Change plan')!);
    await user.click(await screen.findByRole('radio', { name: /Local/ }));
    await user.click(screen.getByRole('button', { name: 'Save plan' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('That plan is not offered to this community.'));
    expect(mockToast.success).not.toHaveBeenCalled();
  });
  it('does not offer to change the plan of a community that pays the platform by card, and says why', async () => {
    await renderWith([makeRow({ plan_change_refusal: 'card_subscription' })]);

    expect(button('Change plan')).toBeUndefined();
    expect(screen.getByText('Pays by card: the platform team changes its plan.')).toBeInTheDocument();
    // The other actions stay.
    expect(button('Set paid-until date')).toBeDefined();
    expect(button('Pause community')).toBeDefined();
  });

  it('ignores a late list of plans meant for a community whose dialog was closed', async () => {
    const user = userEvent.setup();
    let answerFirst: (value: unknown) => void = () => {};
    const rows = [makeRow(), makeRow({ id: 8, name: 'Kinsale Timebank' })];
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/v2/admin/super/branch-payments') return Promise.resolve({ success: true, data: rows });
      if (url === '/v2/admin/super/branch-payments/7/plans') return new Promise((resolve) => { answerFirst = resolve; });
      return Promise.resolve({ success: true, data: [makePlan({ plan_id: 4, slug: 'community', name: 'Community' })] });
    });
    const { BranchPayments } = await import('./BranchPayments');
    render(<BranchPayments />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    const changeButtons = () => screen.getAllByRole('button').filter((b) => b.textContent?.trim() === 'Change plan');
    await user.click(changeButtons()[0]!);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(changeButtons()[1]!);
    expect(await screen.findByRole('radio', { name: /Community/ })).toBeInTheDocument();

    answerFirst({ success: true, data: [makePlan({ plan_id: 2, slug: 'spark', name: 'Spark' })] });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByRole('radio', { name: /Spark/ })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Community/ })).toBeInTheDocument();
  });
  // ─── What happens when a community goes over its member number ──────────────
  const ruleSelect = () => screen.getByLabelText('What happens') as HTMLSelectElement;

  it('shows the rule that applies, its days and where it comes from', async () => {
    await renderWith([
      makeRow({ over_limit: makeOverLimit({ action_source: 'hub' }) }),
      makeRow({ id: 8, name: 'Kinsale Timebank', over_limit: makeOverLimit({ action: 'block_joining', effective_action: 'block_joining', action_source: 'community' }) }),
    ]);

    expect(screen.getByRole('columnheader', { name: 'If over' })).toBeInTheDocument();
    expect(screen.getByText('Pause after 30 days')).toBeInTheDocument();
    expect(screen.getByText('hub default')).toBeInTheDocument();
    expect(screen.getByText('Stop joining')).toBeInTheDocument();
  });

  it('names the day a community over its number will be paused', async () => {
    await renderWith([makeRow({ over_limit: makeOverLimit({ acts_on: '2026-12-21' }) })]);

    const line = screen.getByText((text) => text.startsWith('Pause on '));
    expect(line).toHaveTextContent(formatDate('2026-12-21'));
    expect(line.className).toContain('text-warning');
  });

  it('says the platform team moves a card payer up by hand', async () => {
    await renderWith([makeRow({ over_limit: makeOverLimit({ action: 'upgrade', effective_action: 'none' }) })]);

    expect(screen.getByText('Move up (platform team does this one by hand)')).toBeInTheDocument();
  });

  it('offers the over-limit rule only where the manager may act', async () => {
    await renderWith([
      makeRow(),
      makeRow({ id: 8, name: 'Kinsale Timebank', can_act: false, cannot_act_reason: 'pays_platform' }),
    ]);

    expect(screen.getAllByRole('button').filter((b) => b.textContent?.trim() === 'Over-limit rule')).toHaveLength(1);
  });

  it('opens on the community’s own rule and posts the choice', async () => {
    const user = userEvent.setup();
    await renderWith([makeRow({ over_limit: makeOverLimit({ own_action: 'pause', own_grace_days: 14, action_source: 'community', grace_days: 14, days_source: 'community' }) })]);

    await user.click(button('Over-limit rule')!);
    expect(ruleSelect().value).toBe('pause');
    expect((screen.getByLabelText('After how many days over') as HTMLInputElement).value).toBe('14');

    fireEvent.change(ruleSelect(), { target: { value: 'block_joining' } });
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/super/branch-payments/7/over-limit', { action: 'block_joining', grace_days: 14 }));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Over-limit rule saved'));
  });

  it('leaves out moving up when the server says it is not allowed', async () => {
    const user = userEvent.setup();
    await renderWith([makeRow({ upgrade_allowed: false })]);

    await user.click(button('Over-limit rule')!);

    expect(Array.from(ruleSelect().options).map((o) => o.textContent)).not.toContain('Move up to the next plan');
  });

  it('shows the server’s refusal of a rule as sent', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: false, error: 'This rule cannot be set here.', code: 'RULE_NOT_ALLOWED' });
    await renderWith([makeRow()]);

    await user.click(button('Over-limit rule')!);
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('This rule cannot be set here.'));
    expect(mockToast.success).not.toHaveBeenCalled();
  });
});
