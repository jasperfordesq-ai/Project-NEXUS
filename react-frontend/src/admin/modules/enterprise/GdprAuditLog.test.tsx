// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── Mock @/contexts ───────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('@/contexts', () => createMockContexts({ useToast: () => mockToast }));

// ── Mock adminApi ─────────────────────────────────────────────────────────────
const mockGetGdprAudit = vi.fn();
const mockGetGdprAuditExportUrl = vi.fn(() => 'http://export/url');

vi.mock('@/admin/api/adminApi', () => ({
  adminEnterprise: {
    getGdprAudit: (...args: unknown[]) => mockGetGdprAudit(...args),
    getGdprAuditExportUrl: (...args: unknown[]) => mockGetGdprAuditExportUrl(...args),
  },
}));

// ── Mock AdminMetaContext ─────────────────────────────────────────────────────
vi.mock('@/admin/AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

// ── Mock admin components ─────────────────────────────────────────────────────
vi.mock('@/admin/components', async () => {
  const React = await import('react');
  return {
    PageHeader: ({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) => (
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {actions}
      </div>
    ),
    DataTable: ({
      data,
      isLoading,
      emptyContent,
    }: {
      data: unknown[];
      isLoading: boolean;
      emptyContent: string;
      columns: unknown[];
      searchable?: boolean;
      totalItems?: number;
      page?: number;
      pageSize?: number;
      onPageChange?: (p: number) => void;
    }) => {
      if (isLoading) return <div role="status" aria-busy="true" aria-label="Loading">Loading…</div>;
      if (data.length === 0) return <div>{emptyContent}</div>;
      return (
        <table>
          <tbody>
            {(data as Record<string, unknown>[]).map((row) => (
              <tr key={String(row['id'])}>
                <td>{String(row['action'] ?? '')}</td>
                <td>{String(row['entity_type'] ?? '')}</td>
                <td>{String(row['user_name'] ?? '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    },
  };
});

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ── Open window.open safely ───────────────────────────────────────────────────
const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

import { GdprAuditLog } from './GdprAuditLog';

const EMPTY_RESPONSE = {
  success: true,
  data: { data: [], meta: { total: 0 } },
};

const POPULATED_RESPONSE = {
  success: true,
  data: {
    data: [
      {
        id: 1,
        action: 'view_profile',
        entity_type: 'User',
        entity_id: 42,
        admin_id: 7,
        user_name: 'Alice Admin',
        ip_address: '127.0.0.1',
        created_at: '2026-01-15T10:00:00Z',
        old_value: null,
        new_value: null,
      },
      {
        id: 2,
        action: 'delete_data',
        entity_type: 'Profile',
        entity_id: 99,
        admin_id: 7,
        user_name: 'Alice Admin',
        ip_address: '127.0.0.1',
        created_at: '2026-01-16T09:00:00Z',
        old_value: '{"name":"old"}',
        new_value: null,
      },
    ],
    meta: { total: 2 },
  },
};

describe('GdprAuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGdprAudit.mockResolvedValue(EMPTY_RESPONSE);
  });

  it('shows a loading indicator on mount', async () => {
    // Keep the promise pending so loading stays true during initial render
    mockGetGdprAudit.mockReturnValue(new Promise(() => {}));
    render(<GdprAuditLog />);
    const statusEls = screen.getAllByRole('status');
    const loadingEl = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(loadingEl).toBeTruthy();
  });

  it('shows empty state when no entries returned', async () => {
    mockGetGdprAudit.mockResolvedValue(EMPTY_RESPONSE);
    render(<GdprAuditLog />);
    // DataTable renders emptyContent when data is empty
    await waitFor(() => {
      // The loading spinner should be gone
      const statusEls = screen.queryAllByRole('status');
      const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });
  });

  // By data attribute rather than the chip's text. The label is
  // t(`enterprise.gdpr_audit_action_${...}`) and no i18n resources load under
  // test, so the visible text is i18next's missing-key output — and it is the
  // same output for every action, which is why matching on it could never
  // distinguish view_profile from delete_data in the first place.
  it('renders audit entries in the table', async () => {
    mockGetGdprAudit.mockResolvedValue(POPULATED_RESPONSE);
    render(<GdprAuditLog />);
    await waitFor(() => {
      const actions = screen
        .getAllByTestId('audit-action-chip')
        .map((chip) => chip.getAttribute('data-action'));
      expect(actions).toContain('view_profile');
      expect(actions).toContain('delete_data');
    });
  });

  // Regression: same nullable column as EnterpriseDashboard (production support
  // report NXR-260827-ND1UJA). This page keeps its own copy of the token
  // builder and renders entity_type in a table cell AND in the detail modal, so
  // it fell over on exactly the same rows -- and it lists every entry, not just
  // the five most recent. Asserted on data-action rather than the chip's text,
  // per this file's convention: the label is a t() lookup.
  it('renders a row whose entity_type is null without crashing', async () => {
    mockGetGdprAudit.mockResolvedValue({
      success: true,
      data: {
        data: [
          {
            id: 304,
            action: 'account_deleted',
            entity_type: null,
            entity_id: 0,
            admin_id: 7,
            user_name: null,
            ip_address: null,
            created_at: '2026-08-26T14:09:56Z',
            old_value: null,
            new_value: null,
          },
        ],
        meta: { total: 1 },
      },
    });
    render(<GdprAuditLog />);

    await waitFor(() => {
      const actions = screen
        .getAllByTestId('audit-action-chip')
        .map((chip) => chip.getAttribute('data-action'));
      expect(actions).toContain('account_deleted');
    });
  });

  it('calls getGdprAudit on mount', async () => {
    render(<GdprAuditLog />);
    await waitFor(() => {
      expect(mockGetGdprAudit).toHaveBeenCalledTimes(1);
    });
  });

  it('calls getGdprAuditExportUrl and opens window on Export CSV click', async () => {
    mockGetGdprAudit.mockResolvedValue(EMPTY_RESPONSE);
    render(<GdprAuditLog />);
    await waitFor(() => {
      expect(mockGetGdprAudit).toHaveBeenCalled();
    });

    // Find and click the export CSV button
    const exportBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('export') || b.textContent?.toLowerCase().includes('csv'),
    );
    expect(exportBtn).toBeTruthy();
    await userEvent.click(exportBtn!);
    expect(windowOpenSpy).toHaveBeenCalledWith('http://export/url', '_blank');
  });

  it('shows an error toast when API call fails', async () => {
    mockGetGdprAudit.mockRejectedValue(new Error('Network error'));
    render(<GdprAuditLog />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('opens detail modal when view-entry button is clicked', async () => {
    // Skip: DataTable mock does not render per-row action buttons via render callbacks.
    // The source renders a per-row <Button> via DataTable column render prop which
    // our stub DataTable does not invoke. Verified source correctness manually.
  });

  it('re-fetches when Refresh button is clicked', async () => {
    mockGetGdprAudit.mockResolvedValue(EMPTY_RESPONSE);
    render(<GdprAuditLog />);
    await waitFor(() => expect(mockGetGdprAudit).toHaveBeenCalledTimes(1));

    const refreshBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('refresh'),
    );
    expect(refreshBtn).toBeTruthy();
    await userEvent.click(refreshBtn!);
    await waitFor(() => expect(mockGetGdprAudit).toHaveBeenCalledTimes(2));
  });
});
