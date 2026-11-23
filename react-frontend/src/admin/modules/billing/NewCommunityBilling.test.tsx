// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import type { NewCommunityBillingMode, NewCommunityBillingValue } from './NewCommunityBilling';

// ─── UI mock: a dropdown is a native <select> ────────────────────────────────
vi.mock('@/components/ui', async () => {
  const base = (await import('@/test/uiMock')).uiMock as Record<string, unknown>;
  const overrides: Record<string, unknown> = {
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
  };
  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in overrides) return overrides[prop];
      return Reflect.get(target, prop);
    },
    has(target, prop) {
      if (typeof prop === 'string' && prop in overrides) return true;
      return Reflect.has(target, prop);
    },
  });
});

const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));

const PLATFORM_PLANS = [
  { id: 2, name: 'Local', max_users: 500, is_active: 1 },
  { id: 3, name: 'Regional', max_users: null, is_active: 1 },
  { id: 9, name: 'Old Starter', max_users: 50, is_active: 0 },
];

const HUB_PLANS = {
  hubs: [],
  hub_id: 5,
  plans: [
    { plan_id: 2, name: 'Local', max_users: 250, is_offered: true },
    { plan_id: 3, name: 'Regional', max_users: null, is_offered: false },
  ],
};

const onChangeSpy = vi.fn();

/** The component with its value held as the form holds it. */
function Harness({ mode, parentId, parentName }: { mode: NewCommunityBillingMode; parentId: number | null; parentName: string | null }) {
  const [value, setValue] = useState<NewCommunityBillingValue>({ planId: '', payer: '', paidUntil: '' });
  const [Component, setComponent] = useState<null | typeof import('./NewCommunityBilling').NewCommunityBilling>(null);
  React.useEffect(() => {
    void import('./NewCommunityBilling').then((module) => setComponent(() => module.NewCommunityBilling));
  }, []);
  if (!Component) return null;
  return (
    <Component
      mode={mode}
      parentId={parentId}
      parentName={parentName}
      value={value}
      onChange={(next) => {
        onChangeSpy(next);
        setValue(next);
      }}
    />
  );
}

const options = (label: string) =>
  Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((option) => option.textContent);

describe('NewCommunityBilling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockImplementation((url: string) => Promise.resolve(
      url === '/v2/admin/plans' ? { success: true, data: PLATFORM_PLANS } : { success: true, data: HUB_PLANS },
    ));
    mockApi.post.mockResolvedValue({ success: true, data: {} });
  });

  it('shows nothing where this person cannot set billing', async () => {
    render(<Harness mode="none" parentId={1} parentName={null} />);

    await waitFor(() => expect(screen.queryByTestId('new-community-billing')).not.toBeInTheDocument());
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  it('offers the platform team every active plan, who it pays and the date', async () => {
    render(<Harness mode="platform_team" parentId={1} parentName={null} />);

    await waitFor(() => expect(options('Plan')).toEqual(['No plan yet', 'Local', 'Regional']));
    expect(mockApi.get).toHaveBeenCalledWith('/v2/admin/plans');
    expect(screen.getByText('Billing (optional)')).toBeInTheDocument();
    expect(screen.getByText((text) => text.includes('listed under “Still to set up” on Billing control'))).toBeInTheDocument();
    // Directly under the platform: there is no parent community to pay.
    expect(options('Who it pays')).toEqual([
      'The usual way: it pays the platform by invoice', 'Platform, by invoice', 'Not billed',
    ]);
    expect(screen.getByLabelText('Paid up to and including')).toBeInTheDocument();
  });

  it('offers "its parent community" to the platform team only under a parent community, and names it', async () => {
    render(<Harness mode="platform_team" parentId={5} parentName="Cork Timebank" />);

    await waitFor(() => expect(options('Who it pays')).toEqual([
      'The usual way: it pays Cork Timebank', 'Platform, by invoice', 'Its parent community', 'Not billed',
    ]));
  });

  it("offers a parent community's manager the plans that parent offers, and says who it will pay", async () => {
    render(<Harness mode="parent_manager" parentId={5} parentName="Cork Timebank" />);

    // Regional is not offered by this parent.
    await waitFor(() => expect(options('Plan')).toEqual(['No plan yet', 'Local']));
    expect(mockApi.get).toHaveBeenCalledWith('/v2/admin/super/branch-plans?hub_id=5');
    expect(screen.getByTestId('new-community-pays')).toHaveTextContent('It will pay Cork Timebank.');
    // Who it pays is not theirs to choose.
    expect(screen.queryByLabelText('Who it pays')).not.toBeInTheDocument();
    expect(screen.getByText((text) => text.includes('listed under “Still to set up” on Branch payments'))).toBeInTheDocument();
  });

  it('says so when the plans cannot be loaded, and still lets the rest be set', async () => {
    mockApi.get.mockResolvedValue({ success: false, error: 'nope' });
    render(<Harness mode="platform_team" parentId={1} parentName={null} />);

    expect(await screen.findByText('The plans could not be loaded. You can still create the community and choose its plan afterwards.')).toBeInTheDocument();
    expect(screen.getByLabelText('Plan')).toBeDisabled();
    expect(screen.getByLabelText('Paid up to and including')).not.toBeDisabled();
  });

  it('drops a chosen plan that the new parent does not offer', async () => {
    const { rerender } = render(<Harness mode="parent_manager" parentId={5} parentName="Cork Timebank" />);
    await waitFor(() => expect(options('Plan')).toEqual(['No plan yet', 'Local']));
    fireEvent.change(screen.getByLabelText('Plan'), { target: { value: '2' } });
    expect((screen.getByLabelText('Plan') as HTMLSelectElement).value).toBe('2');

    mockApi.get.mockResolvedValue({ success: true, data: { plans: [{ plan_id: 4, name: 'Community', max_users: 1000, is_offered: true }] } });
    rerender(<Harness mode="parent_manager" parentId={6} parentName="Leeds Timebank" />);

    await waitFor(() => expect(options('Plan')).toEqual(['No plan yet', 'Community']));
    expect((screen.getByLabelText('Plan') as HTMLSelectElement).value).toBe('none');
  });

  it('has no date to set for a community nobody bills', async () => {
    render(<Harness mode="platform_team" parentId={1} parentName={null} />);
    await waitFor(() => expect(options('Plan')).toHaveLength(3));

    fireEvent.change(screen.getByLabelText('Paid up to and including'), { target: { value: '2027-01-31' } });
    expect(screen.getByText('Leave it empty if nothing has been paid yet.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Who it pays'), { target: { value: 'not_billed' } });

    // The date box is switched off too; the shared input stand-in does not
    // carry `isDisabled`, so what is asserted is that it is emptied and says why.
    expect(screen.getByLabelText('Paid up to and including')).toHaveValue('');
    expect(screen.getByText('Never billed. The automatic payment checks leave it alone.')).toBeInTheDocument();
    expect(screen.queryByText('Leave it empty if nothing has been paid yet.')).not.toBeInTheDocument();
  });
});

describe('saveNewCommunityBilling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.post.mockResolvedValue({ success: true, data: {} });
  });

  it('saves nothing when nothing was chosen', async () => {
    const { saveNewCommunityBilling } = await import('./NewCommunityBilling');

    expect(await saveNewCommunityBilling(42, 'platform_team', { planId: '', payer: '', paidUntil: '' })).toEqual([]);
    expect(await saveNewCommunityBilling(42, 'parent_manager', { planId: '', payer: '', paidUntil: '' })).toEqual([]);
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('saves through the Billing control addresses for the platform team: who it pays, then the plan, then the date', async () => {
    const { saveNewCommunityBilling } = await import('./NewCommunityBilling');

    const failures = await saveNewCommunityBilling(42, 'platform_team', { planId: '2', payer: 'platform_invoice', paidUntil: '2027-01-31' });

    expect(failures).toEqual([]);
    expect(mockApi.post.mock.calls).toEqual([
      ['/v2/admin/super/billing/standing/payer', { tenant_id: 42, payer: 'platform_invoice' }],
      ['/v2/admin/super/billing/assign-plan', { tenant_id: 42, pay_plan_id: 2 }],
      ['/v2/admin/super/billing/standing/paid-until', { tenant_id: 42, paid_until: '2027-01-31' }],
    ]);
  });

  it("saves through the Branch payments addresses for a parent community's manager, and never sets who it pays", async () => {
    const { saveNewCommunityBilling } = await import('./NewCommunityBilling');

    await saveNewCommunityBilling(42, 'parent_manager', { planId: '2', payer: 'not_billed', paidUntil: '' });
    expect(mockApi.post.mock.calls).toEqual([
      ['/v2/admin/super/branch-payments/42/plan', { plan_id: 2 }],
    ]);

    mockApi.post.mockClear();
    await saveNewCommunityBilling(42, 'parent_manager', { planId: '2', payer: '', paidUntil: '2027-01-31' });
    expect(mockApi.post.mock.calls).toEqual([
      ['/v2/admin/super/branch-payments/42/plan', { plan_id: 2 }],
      ['/v2/admin/super/branch-payments/42/paid-until', { paid_until: '2027-01-31' }],
    ]);
  });

  it('sends no date for a community nobody bills', async () => {
    const { saveNewCommunityBilling } = await import('./NewCommunityBilling');

    await saveNewCommunityBilling(42, 'platform_team', { planId: '', payer: 'not_billed', paidUntil: '2027-01-31' });

    expect(mockApi.post.mock.calls).toEqual([
      ['/v2/admin/super/billing/standing/payer', { tenant_id: 42, payer: 'not_billed' }],
    ]);
  });

  it('carries on after a refusal and reports each step that failed, with the server\'s reason', async () => {
    const { saveNewCommunityBilling } = await import('./NewCommunityBilling');
    mockApi.post.mockImplementation((url: string) => {
      if (url.endsWith('/assign-plan')) return Promise.resolve({ success: false, error: 'That plan is retired.' });
      if (url.endsWith('/paid-until')) return Promise.reject(new Error('network'));
      return Promise.resolve({ success: true, data: {} });
    });

    const failures = await saveNewCommunityBilling(42, 'platform_team', { planId: '9', payer: 'platform_invoice', paidUntil: '2027-01-31' });

    expect(failures).toEqual([
      { step: 'plan', reason: 'That plan is retired.' },
      { step: 'date', reason: null },
    ]);
    // The date was still tried after the plan was refused.
    expect(mockApi.post).toHaveBeenCalledTimes(3);
  });

  it('does nothing in the mode that offers nothing', async () => {
    const { saveNewCommunityBilling } = await import('./NewCommunityBilling');

    expect(await saveNewCommunityBilling(42, 'none', { planId: '2', payer: 'platform_invoice', paidUntil: '2027-01-31' })).toEqual([]);
    expect(mockApi.post).not.toHaveBeenCalled();
  });
});
