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
});
