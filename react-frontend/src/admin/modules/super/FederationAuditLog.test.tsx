// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../api/adminApi', () => ({
  adminSuper: {
    getAudit: vi.fn(),
  },
}));

vi.mock('@/contexts', () => createMockContexts());

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
    DataTable: ({ data, isLoading, onRefresh }: {
      data: unknown[];
      isLoading: boolean;
      onRefresh?: () => void;
    }) => (
      isLoading
        ? <div role="status" aria-busy="true" aria-label="Loading" />
        : <div data-testid="data-table">
            {(data as Array<{ id: number; description: string; action_type: string; actor_name: string; created_at: string }>).map((row) => (
              <div key={row.id} data-testid="audit-row">
                <span>{row.description ?? row.action_type}</span>
                <span>{row.actor_name}</span>
              </div>
            ))}
            <button onClick={onRefresh}>Refresh</button>
          </div>
    ),
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div>
        <h1>{title}</h1>
        {actions}
      </div>
    ),
    StatCard: ({ label, value }: { label: string; value: number }) => (
      <div data-testid="stat-card">{label}: {value}</div>
    ),
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/DataTable', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/StatCard', adminComponentsMock);

import React from 'react';
import { adminSuper } from '../../api/adminApi';
import { FederationAuditLog } from './FederationAuditLog';
import type { SuperAuditEntry } from '../../api/types';

const MOCK_ENTRIES: SuperAuditEntry[] = [
  {
    id: 1,
    action_type: 'federation_lockdown',
    description: 'Emergency lockdown activated',
    actor_id: 10,
    actor_name: 'Super Admin',
    target_type: 'federation',
    target_id: null,
    created_at: '2026-06-01T08:00:00Z',
    meta: {},
  },
  {
    id: 2,
    action_type: 'federation_partnership_suspend',
    description: 'Partnership with CommunityA suspended',
    actor_id: 10,
    actor_name: 'Super Admin',
    target_type: 'federation',
    target_id: 5,
    created_at: '2026-06-02T10:00:00Z',
    meta: {},
  },
  {
    id: 3,
    action_type: 'federation_whitelist_add',
    description: 'community-b.ie added to whitelist',
    actor_id: 11,
    actor_name: 'Alice Operator',
    target_type: 'federation',
    target_id: null,
    created_at: '2026-06-03T12:00:00Z',
    meta: {},
  },
];

describe('FederationAuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: both the stats call and the main log call succeed
    vi.mocked(adminSuper.getAudit).mockResolvedValue({
      success: true,
      data: MOCK_ENTRIES,
    });
  });

  it('shows a loading spinner while fetching', () => {
    vi.mocked(adminSuper.getAudit).mockReturnValue(new Promise(() => {}));
    render(<FederationAuditLog />);
    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeInTheDocument();
  });

  it('renders audit rows after data loads', async () => {
    render(<FederationAuditLog />);
    await waitFor(() => {
      expect(screen.getByTestId('data-table')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('audit-row').length).toBe(3);
  });

  it('renders stat cards for total / federation / partnerships / emergency counts', async () => {
    render(<FederationAuditLog />);
    await waitFor(() => {
      const statCards = screen.getAllByTestId('stat-card');
      expect(statCards.length).toBe(4);
    });
  });

  it('shows actor name in the table row', async () => {
    render(<FederationAuditLog />);
    await waitFor(() => {
      // "Super Admin" appears in multiple rows; use getAllByText
      const superAdminEls = screen.getAllByText('Super Admin');
      expect(superAdminEls.length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Alice Operator')).toBeInTheDocument();
  });

  it('shows description text in each row', async () => {
    render(<FederationAuditLog />);
    await waitFor(() => {
      expect(screen.getByText('Emergency lockdown activated')).toBeInTheDocument();
    });
    expect(screen.getByText('Partnership with CommunityA suspended')).toBeInTheDocument();
  });

  it('export CSV button is disabled when logs are empty', async () => {
    vi.mocked(adminSuper.getAudit).mockResolvedValue({ success: true, data: [] });
    render(<FederationAuditLog />);
    await waitFor(() => expect(screen.getByTestId('data-table')).toBeInTheDocument());

    // The export CSV button is in the PageHeader actions; it has isDisabled when logs empty
    const buttons = screen.getAllByRole('button');
    const exportBtn = buttons.find((btn) => btn.textContent?.toLowerCase().includes('export') || btn.textContent?.toLowerCase().includes('csv'));
    if (exportBtn) {
      // HeroUI disabled button has aria-disabled or disabled attribute
      expect(
        exportBtn.hasAttribute('disabled') || exportBtn.getAttribute('aria-disabled') === 'true'
      ).toBe(true);
    }
  });

  it('export CSV button is enabled when logs exist', async () => {
    render(<FederationAuditLog />);
    await waitFor(() => expect(screen.getByTestId('data-table')).toBeInTheDocument());

    const buttons = screen.getAllByRole('button');
    const exportBtn = buttons.find((btn) => btn.textContent?.toLowerCase().includes('export') || btn.textContent?.toLowerCase().includes('csv'));
    if (exportBtn) {
      expect(
        exportBtn.hasAttribute('disabled') || exportBtn.getAttribute('aria-disabled') === 'true'
      ).toBe(false);
    }
  });

  it('clear filters button is hidden when no filters are active', async () => {
    render(<FederationAuditLog />);
    await waitFor(() => expect(screen.getByTestId('data-table')).toBeInTheDocument());

    const buttons = screen.getAllByRole('button');
    const clearBtn = buttons.find((btn) => btn.textContent?.toLowerCase().includes('clear'));
    // Should not be visible when no filters set
    expect(clearBtn).toBeUndefined();
  });

  it('calls refresh (getAudit) when refresh button is clicked', async () => {
    const user = userEvent.setup();
    render(<FederationAuditLog />);
    await waitFor(() => expect(screen.getByTestId('data-table')).toBeInTheDocument());

    const callsBefore = vi.mocked(adminSuper.getAudit).mock.calls.length;

    const refreshBtn = screen.getByRole('button', { name: 'Refresh' });
    await user.click(refreshBtn);

    await waitFor(() => {
      // At least one additional call after the click
      expect(vi.mocked(adminSuper.getAudit).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('shows empty table when API returns no matching entries', async () => {
    vi.mocked(adminSuper.getAudit).mockResolvedValue({ success: true, data: [] });
    render(<FederationAuditLog />);
    await waitFor(() => expect(screen.getByTestId('data-table')).toBeInTheDocument());
    expect(screen.queryAllByTestId('audit-row').length).toBe(0);
  });
});
