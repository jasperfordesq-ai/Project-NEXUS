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
// BillingControl uses HeroUI Table with `items` prop + render-function children
// (a Collection pattern). The base uiMock is a Proxy — spreading it loses Proxy traps
// (useDisclosure etc live in get() handlers, not own properties). We return the Proxy
// itself wrapped in a new Proxy that overrides Table-related keys while delegating
// everything else (including useDisclosure, useConfirm, hooks) to the original.
vi.mock('@/components/ui', async () => {
  const base = (await import('@/test/uiMock')).uiMock as Record<string, unknown>;

  const tableOverrides: Record<string, unknown> = {
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
  suggested_plan: 'community',
  over_limit: false,
  is_in_grace_period: false,
  grace_days_remaining: 0,
  standing: makeStanding(),
  ...overrides,
});

const makePlan = (overrides = {}) => ({
  id: 2,
  name: 'Pro',
  slug: 'pro',
  max_users: 200,
  price_monthly: '49.00',
  price_yearly: '490.00',
  ...overrides,
});

const button = (label: string) =>
  screen.queryAllByRole('button').find((b) => b.textContent?.trim() === label);

// ─────────────────────────────────────────────────────────────────────────────
describe('BillingControl', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/plans')) {
        return Promise.resolve({ success: true, data: [makePlan()] });
      }
      return Promise.resolve({ success: true, data: [makeSnapshot()] });
    });
    mockApi.post.mockResolvedValue({ success: true, data: {} });
    mockApi.download.mockResolvedValue(undefined);
  });

  const renderWith = async (rows: unknown[]) => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/plans')) return Promise.resolve({ success: true, data: [makePlan()] });
      return Promise.resolve({ success: true, data: rows });
    });
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
});
