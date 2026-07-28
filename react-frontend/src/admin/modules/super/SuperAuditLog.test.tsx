// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── mock adminApi (vi.hoisted so factory can reference the object) ────────────
const mockAdminSuper = vi.hoisted(() => ({
  getAudit: vi.fn(),
}));

vi.mock('../../api/adminApi', () => ({
  adminSuper: mockAdminSuper,
}));

// ── mock contexts ─────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ── mock admin components ─────────────────────────────────────────────────────
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/DataTable' and '../../components/PageHeader'
// directly, and vitest keys mocks per resolved module, so a barrel-only mock
// never installs for those imports — the real components rendered and the stub
// testids were never in the DOM. A function DECLARATION, not a const: vi.mock
// calls are hoisted above the module body, so a const factory is still
// uninitialised when they run.
function adminComponentsMock() {
  return {
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div>
        <h1>{title}</h1>
        {actions}
      </div>
    ),
    DataTable: ({
      data,
      isLoading,
      columns,
    }: {
      data: any[];
      isLoading: boolean;
      columns: any[];
      [key: string]: any;
    }) => (
      <div data-testid="data-table">
        {isLoading && (
          <div role="status" aria-busy="true" aria-label="loading">
            Loading
          </div>
        )}
        {!isLoading && (
          <ul>
            {data.map((row) => (
              <li key={String(row.id)}>
                {columns.map((col: any) => (
                  <span key={col.key}>{col.render ? col.render(row) : row[col.key]}</span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    ),
    StatusBadge: ({ status }: { status: string }) => <span data-testid="status-badge">{status}</span>,
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/DataTable', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);

import SuperAuditLog from './SuperAuditLog';

const MOCK_ENTRIES = [
  {
    id: 1,
    action_type: 'user_created',
    target_type: 'user',
    target_id: 10,
    target_label: 'Alice Smith',
    actor_id: 1,
    actor_name: 'Admin',
    description: 'Created user Alice Smith',
    created_at: '2024-06-01T10:00:00Z',
  },
  {
    id: 2,
    action_type: 'tenant_updated',
    target_type: 'tenant',
    target_id: 5,
    target_label: 'Test Tenant',
    actor_id: 1,
    actor_name: 'Admin',
    description: 'Updated tenant settings',
    created_at: '2024-06-02T12:00:00Z',
  },
];

describe('SuperAuditLog', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── loading state ─────────────────────────────────────────────────────────

  it('shows loading indicator while fetching audit log', async () => {
    mockAdminSuper.getAudit.mockReturnValue(new Promise(() => {}));
    render(<SuperAuditLog />);

    const spinner = screen
      .queryAllByRole('status')
      .find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinner).toBeInTheDocument();
  });

  // ── populated state ───────────────────────────────────────────────────────

  it('renders audit log entries after load', async () => {
    mockAdminSuper.getAudit.mockResolvedValueOnce({ success: true, data: MOCK_ENTRIES });
    render(<SuperAuditLog />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    expect(screen.getByText('Test Tenant')).toBeInTheDocument();
  });

  it('renders action_type badges', async () => {
    mockAdminSuper.getAudit.mockResolvedValueOnce({ success: true, data: MOCK_ENTRIES });
    render(<SuperAuditLog />);

    await waitFor(() => {
      const badges = screen.getAllByTestId('status-badge');
      expect(badges.length).toBeGreaterThanOrEqual(2);
      expect(badges[0].textContent).toBe('user_created');
    });
  });

  // ── empty state ───────────────────────────────────────────────────────────

  it('renders empty table when no entries returned', async () => {
    mockAdminSuper.getAudit.mockResolvedValueOnce({ success: true, data: [] });
    render(<SuperAuditLog />);

    await waitFor(() => {
      const spinner = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(spinner).toBeUndefined();
    });
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    expect(screen.getByTestId('data-table')).toBeInTheDocument();
  });

  // ── error / API failure ───────────────────────────────────────────────────

  it('clears entries when API returns success=false', async () => {
    mockAdminSuper.getAudit.mockResolvedValueOnce({ success: false });
    render(<SuperAuditLog />);

    await waitFor(() => {
      const spinner = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(spinner).toBeUndefined();
    });
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
  });

  it('clears entries on API exception', async () => {
    mockAdminSuper.getAudit.mockRejectedValueOnce(new Error('Network error'));
    render(<SuperAuditLog />);

    await waitFor(() => {
      const spinner = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(spinner).toBeUndefined();
    });
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
  });

  // ── filters ───────────────────────────────────────────────────────────────

  it('calls getAudit on mount', async () => {
    mockAdminSuper.getAudit.mockResolvedValue({ success: true, data: [] });
    render(<SuperAuditLog />);

    await waitFor(() => {
      expect(mockAdminSuper.getAudit).toHaveBeenCalledTimes(1);
    });
  });

  it('clear-filters button is absent when no filters active', async () => {
    mockAdminSuper.getAudit.mockResolvedValue({ success: true, data: [] });
    render(<SuperAuditLog />);

    await waitFor(() => {
      const spinner = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(spinner).toBeUndefined();
    });
    // "clear_filters" button only renders when hasFilters=true
    const clearBtn = screen.queryAllByRole('button').find((b) =>
      /clear/i.test(b.textContent ?? ''),
    );
    expect(clearBtn).toBeUndefined();
  });

  // ── export CSV ────────────────────────────────────────────────────────────

  it('export CSV button is disabled when no log entries', async () => {
    mockAdminSuper.getAudit.mockResolvedValue({ success: true, data: [] });
    render(<SuperAuditLog />);

    await waitFor(() => {
      const spinner = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(spinner).toBeUndefined();
    });

    const csvBtn = screen.getAllByRole('button').find((b) =>
      /csv|export/i.test(b.textContent ?? ''),
    );
    expect(csvBtn).toBeDisabled();
  });

  it('export CSV button is enabled when entries exist', async () => {
    mockAdminSuper.getAudit.mockResolvedValue({ success: true, data: MOCK_ENTRIES });
    render(<SuperAuditLog />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const csvBtn = screen.getAllByRole('button').find((b) =>
      /csv|export/i.test(b.textContent ?? ''),
    );
    expect(csvBtn).not.toBeDisabled();
  });

  it('triggers CSV download when export button is clicked', async () => {
    mockAdminSuper.getAudit.mockResolvedValue({ success: true, data: MOCK_ENTRIES });

    // Spy on URL.createObjectURL and a link click
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<SuperAuditLog />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const csvBtn = screen.getAllByRole('button').find((b) =>
      /csv|export/i.test(b.textContent ?? ''),
    );
    fireEvent.click(csvBtn!);

    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  // ── breadcrumb navigation ─────────────────────────────────────────────────

  it('renders breadcrumb navigation links', async () => {
    mockAdminSuper.getAudit.mockResolvedValue({ success: true, data: [] });
    render(<SuperAuditLog />);

    await waitFor(() => {
      const spinner = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(spinner).toBeUndefined();
    });

    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();
  });
});
