// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ─── UI mock ──────────────────────────────────────────────────────────────────
// The shared Proxy mock, with the Table collection pattern rendered as plain
// rows (as BranchPayments.test.tsx does), and Switch / Select as native
// controls so a disabled switch and a picked hub can be asserted.
vi.mock('@/components/ui', async () => {
  const base = (await import('@/test/uiMock')).uiMock as Record<string, unknown>;

  const overrides: Record<string, unknown> = {
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
    Switch: ({ isSelected, isDisabled, onValueChange, children, 'aria-label': ariaLabel }: {
      isSelected?: boolean; isDisabled?: boolean; onValueChange?: (v: boolean) => void;
      children?: React.ReactNode; 'aria-label'?: string;
    }) => (
      <label>
        <input
          type="checkbox"
          aria-label={ariaLabel}
          checked={!!isSelected}
          disabled={!!isDisabled}
          onChange={(e) => onValueChange?.(e.target.checked)}
        />
        {children}
      </label>
    ),
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
    SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
      <option value={id}>{children}</option>
    ),
  };

  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in overrides) return overrides[prop];
      return Reflect.get(target, prop);
    },
    has(target, prop) {
      if (typeof prop === 'string' && prop in overrides) return true;
      return prop in (target as Record<string, unknown>);
    },
  });
});

vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

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

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
// In the shape the SERVER sends (Task 2A, GET /v2/admin/super/branch-plans),
// pinned there by BranchPlansEndpointsTest.
const DEFAULT_TERMS = {
  name: 'Local',
  description: 'For a local timebank',
  max_users: 250,
  price_monthly: 149,
  price_yearly: 1490,
  setup_fee: 0,
  price_monthly_gbp: 129,
  price_yearly_gbp: 1290,
  setup_fee_gbp: 0,
};

const makePlan = (overrides: Record<string, unknown> = {}) => ({
  plan_id: 3,
  slug: 'local',
  ...DEFAULT_TERMS,
  is_offered: true,
  changed: false,
  changed_fields: [] as string[],
  default: { ...DEFAULT_TERMS },
  communities_on_plan: 0,
  ...overrides,
});

const HUB = { id: 5, name: 'Timebanking UK', depth: 1, children_paying: 4 };

const makeResponse = (overrides: Record<string, unknown> = {}) => ({
  hubs: [HUB],
  hub_id: 5,
  hub_currency: 'eur',
  plans: [makePlan()],
  ...overrides,
});

const columnHeaders = () => screen.getAllByRole('columnheader').map((th) => th.textContent?.trim());

const button = (label: string) =>
  screen.queryAllByRole('button').find((b) => b.textContent?.trim() === label);

describe('BranchPlans', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.put.mockResolvedValue({ success: true, data: {} });
    mockApi.delete.mockResolvedValue({ success: true, data: {} });
  });

  const renderWith = async (data: unknown) => {
    mockApi.get.mockResolvedValue({ success: true, data });
    const { BranchPlans } = await import('./BranchPlans');
    render(<BranchPlans />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/v2/admin/super/branch-plans'));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  };

  it('lists each plan with its member number, both monthly prices and whether it is standard', async () => {
    await renderWith(makeResponse({
      plans: [
        makePlan({ plan_id: 1, slug: 'spark', name: 'Spark', max_users: 100, price_monthly: 59, price_monthly_gbp: 49, default: { ...DEFAULT_TERMS, name: 'Spark', max_users: 100 } }),
        makePlan({ max_users: 300, price_monthly_gbp: '120.50', changed: true, changed_fields: ['max_users', 'price_monthly_gbp'] }),
      ],
    }));

    expect(screen.getByText('Spark')).toBeInTheDocument();
    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('£49')).toBeInTheDocument();
    expect(screen.getByText('€59')).toBeInTheDocument();
    // A numeric string from the server is still shown as money.
    expect(screen.getByText('£120.50')).toBeInTheDocument();
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByText('Changed')).toBeInTheDocument();
    // Back to standard only where something was changed.
    expect(screen.getAllByRole('button').filter((b) => b.textContent?.trim() === 'Back to standard')).toHaveLength(1);
    expect(screen.getAllByRole('button').filter((b) => b.textContent?.trim() === 'Change')).toHaveLength(2);
  });

  it('offers no hub picker with a single hub', async () => {
    await renderWith(makeResponse());

    expect(screen.queryByLabelText('Plans for communities that pay')).not.toBeInTheDocument();
  });

  it('offers a hub picker with several hubs, and loads the hub picked', async () => {
    await renderWith(makeResponse({
      hubs: [HUB, { id: 9, name: 'Coventry Timebank', depth: 2, children_paying: 1 }],
    }));

    const picker = screen.getByLabelText('Plans for communities that pay');
    expect(picker).toBeInTheDocument();

    fireEvent.change(picker, { target: { value: '9' } });

    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/v2/admin/super/branch-plans?hub_id=9'));
  });

  it('says so when there is no community whose plans the caller can change', async () => {
    await renderWith(makeResponse({ hubs: [], hub_id: null, plans: [] }));

    expect(screen.getByText('There is no community whose plans you can change.')).toBeInTheDocument();
  });

  it('says so when the plans cannot be loaded', async () => {
    mockApi.get.mockResolvedValue({ success: false, error: 'nope' });
    const { BranchPlans } = await import('./BranchPlans');
    render(<BranchPlans />);

    expect(await screen.findByText('The plans could not be loaded.')).toBeInTheDocument();
  });

  it('shows the standard value under each field and sends null for a field that is emptied', async () => {
    const user = userEvent.setup();
    await renderWith(makeResponse({
      plans: [makePlan({ max_users: 300, price_monthly_gbp: 120.5, changed: true, changed_fields: ['max_users', 'price_monthly_gbp'] })],
    }));

    await user.click(button('Change')!);

    const members = screen.getByLabelText('Members up to') as HTMLInputElement;
    expect(members.value).toBe('300');
    expect(members.placeholder).toBe('250');
    expect(screen.getByText('Standard: £129')).toBeInTheDocument();
    expect(screen.getByText('Standard: 250')).toBeInTheDocument();

    fireEvent.change(members, { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Monthly (£)'), { target: { value: '110' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockApi.put).toHaveBeenCalledWith('/v2/admin/super/branch-plans/5/plans/3', {
        name: null,
        description: null,
        max_users: null,
        price_monthly: null,
        price_yearly: null,
        setup_fee: null,
        price_monthly_gbp: 110,
        price_yearly_gbp: null,
        setup_fee_gbp: null,
      });
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it('refuses a member number below one and a price with more than two decimals, naming the field, and sends nothing', async () => {
    const user = userEvent.setup();
    await renderWith(makeResponse());

    await user.click(button('Change')!);
    fireEvent.change(screen.getByLabelText('Members up to'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Monthly (€)'), { target: { value: '10.555' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Members up to must be a whole number from 1 to 10,000,000, or left empty.')).toBeInTheDocument();
    expect(screen.getByText('Monthly (€) must be an amount from 0 to 99,999,999.99 with at most two decimals, or left empty.')).toBeInTheDocument();
    expect(mockApi.put).not.toHaveBeenCalled();
  });

  it('refuses values above the server\'s limits before sending', async () => {
    const user = userEvent.setup();
    await renderWith(makeResponse());

    await user.click(button('Change')!);
    fireEvent.change(screen.getByLabelText('Members up to'), { target: { value: '10000001' } });
    fireEvent.change(screen.getByLabelText('Setup (£)'), { target: { value: '100000000' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x'.repeat(101) } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Members up to must be a whole number from 1 to 10,000,000, or left empty.')).toBeInTheDocument();
    expect(screen.getByText('Setup (£) must be an amount from 0 to 99,999,999.99 with at most two decimals, or left empty.')).toBeInTheDocument();
    expect(screen.getByText('Name can be at most 100 characters.')).toBeInTheDocument();
    expect(mockApi.put).not.toHaveBeenCalled();
  });

  it('refuses a description longer than 5,000 characters, and accepts one of exactly 5,000', async () => {
    const user = userEvent.setup();
    await renderWith(makeResponse());

    await user.click(button('Change')!);
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'x'.repeat(5001) } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Description can be at most 5,000 characters.')).toBeInTheDocument();
    expect(mockApi.put).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'x'.repeat(5000) } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockApi.put).toHaveBeenCalledWith('/v2/admin/super/branch-plans/5/plans/3', expect.objectContaining({ description: 'x'.repeat(5000) })));
  });

  it('warns, in the dialog, that lowering the member number of a plan in use affects the communities on it', async () => {
    const user = userEvent.setup();
    await renderWith(makeResponse({ plans: [makePlan({ communities_on_plan: 3 })] }));

    await user.click(button('Change')!);

    expect(screen.getByText((text) => text.startsWith('3 communities are on this plan.'))).toBeInTheDocument();
    expect(screen.getByText((text) => text.includes('warned by email first') && text.includes('starts again from today'))).toBeInTheDocument();
  });

  it('uses the singular when one community is on the plan', async () => {
    const user = userEvent.setup();
    await renderWith(makeResponse({ plans: [makePlan({ communities_on_plan: 1 })] }));

    await user.click(button('Change')!);

    expect(screen.getByText((text) => text.startsWith('1 community is on this plan.'))).toBeInTheDocument();
  });

  it('gives no such warning for a plan no community is on', async () => {
    const user = userEvent.setup();
    await renderWith(makeResponse());

    await user.click(button('Change')!);

    expect(screen.queryByText((text) => text.includes('on this plan.'))).not.toBeInTheDocument();
  });

  it('leads with the euro price for a hub that bills in euro', async () => {
    await renderWith(makeResponse({ hub_currency: 'eur' }));

    const headers = columnHeaders();
    expect(headers.indexOf('Monthly (€)')).toBeLessThan(headers.indexOf('Monthly (£)'));
    const cells = screen.getAllByRole('row')[1]!.querySelectorAll('td');
    expect(cells[2]!.textContent).toBe('€149');
    expect(cells[3]!.textContent).toBe('£129');
  });

  it('leads with the pound price for a hub that bills in pounds, and still shows both', async () => {
    await renderWith(makeResponse({ hub_currency: 'gbp' }));

    const headers = columnHeaders();
    expect(headers.indexOf('Monthly (£)')).toBeLessThan(headers.indexOf('Monthly (€)'));
    const cells = screen.getAllByRole('row')[1]!.querySelectorAll('td');
    expect(cells[2]!.textContent).toBe('£129');
    expect(cells[3]!.textContent).toBe('€149');
  });

  it('keeps the picker and the last good table when a reload fails, and says so', async () => {
    await renderWith(makeResponse({
      hubs: [HUB, { id: 9, name: 'Coventry Timebank', depth: 2, children_paying: 1 }],
    }));

    mockApi.get.mockResolvedValue({ success: false, error: 'Not in reach', code: 'NOT_IN_REACH' });
    fireEvent.change(screen.getByLabelText('Plans for communities that pay'), { target: { value: '9' } });

    expect(await screen.findByText('The plans could not be refreshed. Try again, or pick another community.')).toBeInTheDocument();
    expect(screen.getByLabelText('Plans for communities that pay')).toBeInTheDocument();
    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.queryByText('The plans could not be loaded.')).not.toBeInTheDocument();

    // Trying again reloads the hub on screen and clears the message once it works.
    mockApi.get.mockResolvedValue({ success: true, data: makeResponse() });
    fireEvent.click(button('Try again')!);
    await waitFor(() => expect(screen.queryByText('The plans could not be refreshed. Try again, or pick another community.')).not.toBeInTheDocument());
  });

  it('keeps the table when the reload after a change fails', async () => {
    const user = userEvent.setup();
    await renderWith(makeResponse({ plans: [makePlan({ changed: true, changed_fields: ['max_users'], max_users: 300 })] }));

    mockApi.get.mockResolvedValue({ success: false, error: 'boom' });
    await user.click(button('Back to standard')!);

    expect(await screen.findByText('The plans could not be refreshed. Try again, or pick another community.')).toBeInTheDocument();
    expect(screen.getByText('Local')).toBeInTheDocument();
  });

  it('puts a plan back to standard with DELETE', async () => {
    const user = userEvent.setup();
    await renderWith(makeResponse({
      plans: [makePlan({ max_users: 300, changed: true, changed_fields: ['max_users'] })],
    }));

    await user.click(button('Back to standard')!);

    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/v2/admin/super/branch-plans/5/plans/3'));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it('stops offering a plan with is_offered false', async () => {
    const user = userEvent.setup();
    await renderWith(makeResponse());

    await user.click(screen.getByLabelText('Offered: Local'));

    await waitFor(() => expect(mockApi.put).toHaveBeenCalledWith('/v2/admin/super/branch-plans/5/plans/3', { is_offered: false }));
  });

  it('will not stop offering a plan a community is on, and says why', async () => {
    await renderWith(makeResponse({ plans: [makePlan({ communities_on_plan: 2 })] }));

    expect(screen.getByLabelText('Offered: Local')).toBeDisabled();
    expect(screen.getByText('In use by a community. It cannot be hidden.')).toBeInTheDocument();
  });

  it('shows the server\'s own words when it refuses, and reports no success', async () => {
    const user = userEvent.setup();
    mockApi.put.mockResolvedValue({ success: false, error: 'A community that pays you is on this plan.', code: 'PLAN_IN_USE' });
    await renderWith(makeResponse());

    await user.click(screen.getByLabelText('Offered: Local'));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('A community that pays you is on this plan.'));
    expect(mockToast.success).not.toHaveBeenCalled();
  });
});
