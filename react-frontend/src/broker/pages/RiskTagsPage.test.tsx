// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock adminApi ─────────────────────────────────────────────────────────────
const { mockAdminBroker, mockAdminListings } = vi.hoisted(() => ({
  mockAdminBroker: {
    getRiskTags: vi.fn(),
    saveRiskTag: vi.fn(),
    removeRiskTag: vi.fn(),
  },
  mockAdminListings: {
    list: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminBroker: mockAdminBroker,
  adminListings: mockAdminListings,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Contexts ─────────────────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    useToast: () => mockToast,
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub admin/components ────────────────────────────────────────────────────
vi.mock('@/admin/components', () => ({
  DataTable: ({
    data,
    columns,
    isLoading,
    emptyContent,
  }: {
    data: Record<string, unknown>[];
    columns: { key: string; label: string; render?: (item: Record<string, unknown>) => React.ReactNode }[];
    isLoading?: boolean;
    emptyContent?: React.ReactNode;
  }) => {
    if (isLoading) {
      return <div role="status" aria-busy="true" data-testid="datatable-loading">Loading…</div>;
    }
    if (data.length === 0 && emptyContent) {
      return <div data-testid="datatable-empty">{emptyContent}</div>;
    }
    return (
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, ri) => (
            <tr key={ri}>
              {columns.map((c) => (
                <td key={c.key}>
                  {c.render ? c.render(row) : String(row[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div data-testid="page-header">
      <span>{title}</span>
      <div>{actions}</div>
    </div>
  ),
  ConfirmModal: ({
    isOpen,
    onClose,
    onConfirm,
    title,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message?: string;
    confirmLabel?: string;
    confirmColor?: string;
    isLoading?: boolean;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="Dialog" data-testid="confirm-modal">
        <span>{title}</span>
        <button onClick={onConfirm}>Confirm</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    ) : null,
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// Stub formatServerDate
vi.mock('@/lib/serverTime', () => ({
  formatServerDate: (d: string) => d,
}));

// ─── Stub HeroUI Select / Switch to prevent jsdom hangs ───────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Select: ({ label, children, onSelectionChange }: {
      label?: string;
      children?: React.ReactNode;
      onSelectionChange?: (keys: Set<string>) => void;
      selectedKeys?: Set<string> | string[];
      isRequired?: boolean;
    }) => (
      <select
        aria-label={label ?? 'select'}
        onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}
      >
        {children}
      </select>
    ),
    SelectItem: ({ children, id }: { children: React.ReactNode; id: string }) => (
      <option value={id}>{children}</option>
    ),
    Switch: ({ isSelected, onValueChange, size: _size }: {
      isSelected: boolean;
      onValueChange?: (v: boolean) => void;
      size?: string;
    }) => (
      <input
        type="checkbox"
        data-testid="switch"
        checked={isSelected}
        onChange={(e) => onValueChange?.(e.target.checked)}
      />
    ),
    Tabs: ({ children, onSelectionChange, selectedKey, 'aria-label': al }: {
      children: React.ReactNode;
      onSelectionChange?: (key: React.Key) => void;
      selectedKey?: string;
      'aria-label'?: string;
      variant?: string;
      size?: string;
    }) => (
      <div role="tablist" aria-label={al}>
        {children}
      </div>
    ),
    Tab: ({ key: _key, title }: { key?: string; title: React.ReactNode }) => (
      <div role="tab">{title}</div>
    ),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeTag = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  listing_id: 10,
  listing_title: 'Dog Walking Service',
  owner_name: 'Alice',
  risk_level: 'high' as const,
  risk_category: 'health_safety',
  risk_notes: 'Requires training',
  member_visible_notes: 'Please note risks',
  requires_approval: true,
  insurance_required: true,
  dbs_required: false,
  tagged_by_name: 'Admin Bob',
  created_at: '2025-01-01T00:00:00Z',
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('RiskTagsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminBroker.getRiskTags.mockResolvedValue({
      success: true,
      data: [makeTag()],
    });
    mockAdminBroker.saveRiskTag.mockResolvedValue({ success: true });
    mockAdminBroker.removeRiskTag.mockResolvedValue({ success: true });
    mockAdminListings.list.mockResolvedValue({ success: true, data: [] });
  });

  it('shows skeleton loading state initially', async () => {
    mockAdminBroker.getRiskTags.mockImplementationOnce(() => new Promise(() => {}));
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    // First load renders the shaped BrokerSkeleton, not the table spinner.
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('datatable-loading')).not.toBeInTheDocument();
  });

  // The broker dashboard's "High-risk listings" tile counts high AND critical
  // tags and links here with ?level=elevated. It used to link to ?level=high,
  // which hid every critical tag behind a number that included them.
  it('keeps ?level=elevated and asks the API for high and critical together', async () => {
    window.history.pushState({}, '', '/broker/risk-tags?level=elevated');
    try {
      const { RiskTagsPage } = await import('./RiskTagsPage');
      render(<RiskTagsPage />);

      await waitFor(() => {
        expect(mockAdminBroker.getRiskTags).toHaveBeenCalledWith({ risk_level: 'elevated' });
      });
      expect(screen.getByRole('tab', { name: /High and critical/ })).toBeInTheDocument();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('renders listing title after data loads', async () => {
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    await waitFor(() => {
      expect(screen.getByText('Dog Walking Service')).toBeInTheDocument();
    });
  });

  it('renders owner name in the table', async () => {
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
  });

  it('renders empty table when no tags returned', async () => {
    mockAdminBroker.getRiskTags.mockResolvedValue({ success: true, data: [] });
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    await waitFor(() => {
      expect(screen.queryByText('Dog Walking Service')).not.toBeInTheDocument();
    });
  });

  it('renders an all-clear empty state when the register is empty', async () => {
    mockAdminBroker.getRiskTags.mockResolvedValue({ success: true, data: [] });
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    await waitFor(() => {
      expect(screen.getByText('No risk tags yet')).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        'No listings are currently flagged. Tag a listing to apply controls like broker approval, insurance or vetting.'
      )
    ).toBeInTheDocument();
  });

  it('shows error toast when API fails', async () => {
    mockAdminBroker.getRiskTags.mockRejectedValue(new Error('server error'));
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders an honest error state with a retry button when loading fails', async () => {
    mockAdminBroker.getRiskTags.mockRejectedValue(new Error('server error'));
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load risk tags")).toBeInTheDocument();
    });

    // Retry re-fetches and recovers.
    mockAdminBroker.getRiskTags.mockResolvedValue({ success: true, data: [makeTag()] });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(screen.getByText('Dog Walking Service')).toBeInTheDocument();
    });
    expect(mockAdminBroker.getRiskTags).toHaveBeenCalledTimes(2);
  });

  it('renders KPI stat cards with per-level counts and deep links', async () => {
    mockAdminBroker.getRiskTags.mockResolvedValue({
      success: true,
      data: [
        makeTag(),
        makeTag({ id: 2, listing_id: 11, listing_title: 'Gardening Help', risk_level: 'critical' }),
      ],
    });
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    await waitFor(() => {
      expect(screen.getByText('Dog Walking Service')).toBeInTheDocument();
    });

    expect(screen.getByText('Critical tags')).toBeInTheDocument();
    expect(screen.getByText('High risk')).toBeInTheDocument();
    expect(screen.getByText('Medium risk')).toBeInTheDocument();
    expect(screen.getByText('Low risk')).toBeInTheDocument();

    const criticalCard = screen.getByLabelText('View Critical risk tags');
    expect(criticalCard).toHaveAttribute('href', '/test/broker/risk-tags?level=critical');
    expect(within(criticalCard).getByText('1')).toBeInTheDocument();
  });

  it('renders the risk level as a severity status chip in the table', async () => {
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    await waitFor(() => {
      expect(screen.getByText('Dog Walking Service')).toBeInTheDocument();
    });

    const table = screen.getByRole('table');
    expect(within(table).getByText('High')).toBeInTheDocument();
  });

  it('renders the category label in the table', async () => {
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    await waitFor(() => {
      expect(screen.getByText('Health & Safety')).toBeInTheDocument();
    });
  });

  it('renders requirement chips only for the flags a row carries', async () => {
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    await waitFor(() => {
      expect(screen.getByText('Dog Walking Service')).toBeInTheDocument();
    });

    const table = screen.getByRole('table');
    expect(within(table).getByText('Approval')).toBeInTheDocument();
    expect(within(table).getByText('Insurance')).toBeInTheDocument();
    // No retired role-vetting flag is present on the fixture.
    expect(within(table).queryByText('Legacy role-vetting requirement unavailable')).not.toBeInTheDocument();
  });

  it('shows an existing role-vetting flag read-only and never sends it in updates', async () => {
    mockAdminBroker.getRiskTags.mockResolvedValue({
      success: true,
      data: [makeTag({ dbs_required: true })],
    });
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    await waitFor(() => {
      expect(screen.getByText('Legacy role-vetting requirement unavailable')).toBeInTheDocument();
    });

    const editBtn = screen.getAllByRole('button').find((button) =>
      button.getAttribute('aria-label')?.toLowerCase().includes('edit'),
    );
    expect(editBtn).toBeDefined();
    fireEvent.click(editBtn!);

    await waitFor(() => {
      expect(screen.getByText(/cannot be enabled or satisfied by the messaging contact attestation/i)).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('switch')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Update Tag' }));
    await waitFor(() => expect(mockAdminBroker.saveRiskTag).toHaveBeenCalled());
    expect(mockAdminBroker.saveRiskTag.mock.calls[0][1]).not.toHaveProperty('dbs_required');
  });

  it('opens create modal when Tag Listing button pressed', async () => {
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    await waitFor(() => screen.getByText('Dog Walking Service'));

    const addBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('tag') || b.textContent?.toLowerCase().includes('listing')
    );
    expect(addBtn).toBeDefined();
    if (addBtn) fireEvent.click(addBtn);

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
  });

  it('opens edit modal when edit icon button clicked', async () => {
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    await waitFor(() => screen.getByText('Dog Walking Service'));

    const editBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('edit')
    );
    expect(editBtn).toBeDefined();
    if (editBtn) fireEvent.click(editBtn);

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
  });

  it('opens confirm modal when remove icon button clicked', async () => {
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    await waitFor(() => screen.getByText('Dog Walking Service'));

    const removeBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('remove')
    );
    expect(removeBtn).toBeDefined();
    if (removeBtn) fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
    });
  });

  it('calls removeRiskTag and shows success toast after confirm', async () => {
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    await waitFor(() => screen.getByText('Dog Walking Service'));

    const removeBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('remove')
    );
    if (removeBtn) fireEvent.click(removeBtn);

    await waitFor(() => screen.getByTestId('confirm-modal'));

    const confirmBtn = screen.getByText('Confirm');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockAdminBroker.removeRiskTag).toHaveBeenCalledWith(10);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('renders tab filters (all / critical / high / medium / low)', async () => {
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    await waitFor(() => screen.getByText('Dog Walking Service'));

    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBeGreaterThanOrEqual(5);
  });

  it('renders tagged_by_name in table', async () => {
    const { RiskTagsPage } = await import('./RiskTagsPage');
    render(<RiskTagsPage />);

    await waitFor(() => {
      expect(screen.getByText('Admin Bob')).toBeInTheDocument();
    });
  });
});
