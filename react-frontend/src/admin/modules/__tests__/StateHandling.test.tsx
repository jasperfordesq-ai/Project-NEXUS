// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/test-utils';

const apiMocks = vi.hoisted(() => ({
  getPermissions: vi.fn(),
  getSubscriptions: vi.fn(),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('../../api/adminApi', () => ({
  adminEnterprise: { getPermissions: apiMocks.getPermissions },
  adminPlans: { getSubscriptions: apiMocks.getSubscriptions },
}));

vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
      {actions}
    </header>
  ),
}));

vi.mock('../../components/EmptyState', () => ({
  EmptyState: ({
    title,
    description,
    actionLabel,
    onAction,
  }: {
    title: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
  }) => (
    <section>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {actionLabel && onAction && <button type="button" onClick={onAction}>{actionLabel}</button>}
    </section>
  ),
}));

vi.mock('../../components/DataTable', () => ({
  DataTable: ({ data, onRefresh }: { data: Array<Record<string, unknown>>; onRefresh?: () => void }) => (
    <section data-testid="data-table">
      <pre>{JSON.stringify(data)}</pre>
      {onRefresh && <button type="button" onClick={onRefresh}>Table refresh</button>}
    </section>
  ),
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

import { PermissionBrowser } from '../enterprise/PermissionBrowser';
import { Subscriptions } from '../content/Subscriptions';

const backendDetail = 'SQLSTATE secret backend detail';

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getPermissions.mockResolvedValue({ success: true, data: {} });
  apiMocks.getSubscriptions.mockResolvedValue({ success: true, data: [] });
});

describe('PermissionBrowser load states', () => {
  it.each([
    ['resolved failure', () => Promise.resolve({ success: false, error: backendDetail })],
    ['rejected request', () => Promise.reject(new Error(backendDetail))],
  ])('renders %s as an error, never as an empty permission set', async (_label, response) => {
    apiMocks.getPermissions.mockImplementationOnce(response);
    render(<PermissionBrowser />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load data');
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
    expect(screen.queryByText(backendDetail)).not.toBeInTheDocument();
  });

  it('retries an initial failure and renders the confirmed permission map', async () => {
    apiMocks.getPermissions
      .mockResolvedValueOnce({ success: false, error: backendDetail })
      .mockResolvedValueOnce({ success: true, data: { security: ['users.view'] } });
    render(<PermissionBrowser />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('users.view')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retains confirmed permissions when a refresh fails', async () => {
    apiMocks.getPermissions
      .mockResolvedValueOnce({ success: true, data: { security: ['users.view'] } })
      .mockResolvedValueOnce({ success: false, error: backendDetail });
    render(<PermissionBrowser />);

    expect(await screen.findByText('users.view')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load data');
    expect(screen.getByText('users.view')).toBeInTheDocument();
  });

  it('renders a genuine success-empty permission map as empty', async () => {
    render(<PermissionBrowser />);
    expect(await screen.findByText('No data available')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Subscriptions load states', () => {
  it('treats success:false as an error instead of no subscriptions', async () => {
    apiMocks.getSubscriptions.mockResolvedValueOnce({ success: false, error: backendDetail });
    render(<Subscriptions />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load subscriptions');
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
    expect(screen.queryByText(backendDetail)).not.toBeInTheDocument();
  });

  it('retries a rejection and keeps confirmed subscription data across a later failed refresh', async () => {
    apiMocks.getSubscriptions
      .mockRejectedValueOnce(new Error(backendDetail))
      .mockResolvedValueOnce({ success: true, data: [{ id: 4, tenant_name: 'Hour Timebank', plan_name: 'Community' }] })
      .mockResolvedValueOnce({ success: false, error: backendDetail });
    render(<Subscriptions />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/Hour Timebank/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load subscriptions');
    expect(screen.getByText(/Hour Timebank/)).toBeInTheDocument();
  });

  it('renders a genuine success-empty subscription list as empty', async () => {
    render(<Subscriptions />);
    expect(await screen.findByText('No data available')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
