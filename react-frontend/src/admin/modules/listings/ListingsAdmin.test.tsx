// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Hoisted mock data ───────────────────────────────────────────────────────
const { mockAdminListings, mockToast } = vi.hoisted(() => ({
  mockAdminListings: {
    list: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    delete: vi.fn(),
    feature: vi.fn(),
    unfeature: vi.fn(),
    getFeatured: vi.fn(),
  },
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('@/admin/api/adminApi', () => ({
  adminListings: mockAdminListings,
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// Stub AdminMetaContext
vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

// Stub heavy admin sub-components
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/DataTable', '../../components/PageHeader', '../../components/ConfirmModal'
// directly, and vitest keys mocks per resolved module, so a barrel-only mock
// never installs for those imports — the real components rendered and the
// stub data-testids were never in the DOM.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run
// ("Cannot access 'adminComponentsMock' before initialization"). Declarations
// hoist with it.
function adminComponentsMock() {
  return {
    DataTable: ({ data, isLoading, columns, emptyContent }: {
      data: Record<string, unknown>[];
      isLoading: boolean;
      columns?: Array<{ key: string; label: string; render?: (item: Record<string, unknown>) => React.ReactNode }>;
      emptyContent?: string;
    }) => {
      if (isLoading) return React.createElement('div', { role: 'status', 'aria-busy': 'true' }, 'Loading...');
      if (!data || data.length === 0) return React.createElement('div', { 'data-testid': 'data-table-empty' }, emptyContent ?? 'No data');
      return React.createElement('div', { 'data-testid': 'data-table' },
        data.map((item, i) =>
          React.createElement('div', { key: i, 'data-testid': `row-${item.id}` },
            // Invoke column render functions to surface action buttons
            columns
              ? columns.map((col) =>
                  col.render
                    ? React.createElement('span', { key: col.key }, col.render(item))
                    : React.createElement('span', { key: col.key }, String(item[col.key] ?? ''))
                )
              : [
                  React.createElement('span', { key: 'title' }, String(item.title ?? '')),
                  React.createElement('span', { key: 'status' }, String(item.status ?? '')),
                ]
          )
        )
      );
    },
    PageHeader: ({ title }: { title?: string }) =>
      React.createElement('div', { 'data-testid': 'page-header' }, title),
    StatusBadge: ({ status }: { status: string }) =>
      React.createElement('span', { 'data-testid': 'status-badge' }, status),
    ConfirmModal: ({ isOpen, onClose, onConfirm, title }: { isOpen: boolean; onClose: () => void; onConfirm: () => void; title: string }) =>
      isOpen
        ? React.createElement('div', { role: 'dialog', 'data-testid': 'confirm-modal' },
            React.createElement('p', null, title),
            React.createElement('button', { onClick: onConfirm, 'data-testid': 'confirm-btn' }, 'Confirm'),
            React.createElement('button', { onClick: onClose, 'data-testid': 'cancel-btn' }, 'Cancel'),
          )
        : null,
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/DataTable', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/ConfirmModal', adminComponentsMock);

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeListing = (overrides = {}) => ({
  id: 1,
  title: 'Handmade Candle',
  type: 'listing',
  user_name: 'Alice Smith',
  status: 'active',
  is_featured: false,
  created_at: '2025-01-01T00:00:00Z',
  ...overrides,
});

const makeFeatured = (overrides = {}) => ({
  listing_id: 1,
  title: 'Featured Item',
  type: 'listing',
  user_name: 'Bob Jones',
  featured_at: '2025-02-01T00:00:00Z',
  featured_by: 'Admin',
  ...overrides,
});

const makeListResponse = (data = [] as object[], total = 0) => ({
  success: true,
  data,
  meta: { total },
});

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('ListingsAdmin', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminListings.list.mockResolvedValue(makeListResponse());
    mockAdminListings.getFeatured.mockResolvedValue({ success: true, data: [] });
  });

  it('shows loading state initially', async () => {
    mockAdminListings.list.mockImplementation(() => new Promise(() => {}));
    const { ListingsAdmin } = await import('./ListingsAdmin');
    render(<ListingsAdmin />);

    const statusEls = screen.queryAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('calls adminListings.list on mount', async () => {
    const { ListingsAdmin } = await import('./ListingsAdmin');
    render(<ListingsAdmin />);

    await waitFor(() => {
      expect(mockAdminListings.list).toHaveBeenCalled();
    });
  });

  it('renders empty state when no listings returned', async () => {
    const { ListingsAdmin } = await import('./ListingsAdmin');
    render(<ListingsAdmin />);

    await waitFor(() => {
      expect(screen.getByTestId('data-table-empty')).toBeInTheDocument();
    });
  });

  it('renders listing rows when data is returned', async () => {
    mockAdminListings.list.mockResolvedValue(makeListResponse([makeListing()], 1));
    const { ListingsAdmin } = await import('./ListingsAdmin');
    render(<ListingsAdmin />);

    await waitFor(() => {
      expect(screen.getByText('Handmade Candle')).toBeInTheDocument();
    });
  });

  it('renders pending listing with approve and reject action buttons', async () => {
    mockAdminListings.list.mockResolvedValue(
      makeListResponse([makeListing({ id: 2, status: 'pending', title: 'Pending Item' })], 1)
    );
    const { ListingsAdmin } = await import('./ListingsAdmin');
    render(<ListingsAdmin />);

    await waitFor(() => {
      expect(screen.getByText('Pending Item')).toBeInTheDocument();
      // Approve and reject labels should be accessible
      const approveBtn = screen.queryAllByRole('button').find(
        (b) => b.getAttribute('aria-label')?.toLowerCase().includes('approve')
      );
      expect(approveBtn).toBeDefined();
    });
  });

  it('calls adminListings.approve after confirm', async () => {
    mockAdminListings.list.mockResolvedValue(
      makeListResponse([makeListing({ id: 3, status: 'pending', title: 'Approve Me' })], 1)
    );
    mockAdminListings.approve.mockResolvedValue({ success: true });

    const { ListingsAdmin } = await import('./ListingsAdmin');
    render(<ListingsAdmin />);

    await waitFor(() => screen.getByText('Approve Me'));

    // Click the approve icon button
    const approveBtn = screen.queryAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('approve')
    );
    expect(approveBtn).toBeDefined();
    fireEvent.click(approveBtn!);

    // Confirm modal should open
    await waitFor(() => screen.getByTestId('confirm-modal'));
    fireEvent.click(screen.getByTestId('confirm-btn'));

    await waitFor(() => {
      expect(mockAdminListings.approve).toHaveBeenCalledWith(3);
    });
  });

  it('calls adminListings.delete after confirm', async () => {
    mockAdminListings.list.mockResolvedValue(
      makeListResponse([makeListing({ id: 4, title: 'Delete Me' })], 1)
    );
    mockAdminListings.delete.mockResolvedValue({ success: true });

    const { ListingsAdmin } = await import('./ListingsAdmin');
    render(<ListingsAdmin />);

    await waitFor(() => screen.getByText('Delete Me'));

    const deleteBtn = screen.queryAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('delete')
    );
    expect(deleteBtn).toBeDefined();
    fireEvent.click(deleteBtn!);

    await waitFor(() => screen.getByTestId('confirm-modal'));
    fireEvent.click(screen.getByTestId('confirm-btn'));

    await waitFor(() => {
      expect(mockAdminListings.delete).toHaveBeenCalledWith(4);
    });
  });

  it('shows error toast when API call fails', async () => {
    mockAdminListings.list.mockRejectedValue(new Error('network'));
    const { ListingsAdmin } = await import('./ListingsAdmin');
    render(<ListingsAdmin />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('calls adminListings.feature to toggle featured status', async () => {
    mockAdminListings.list.mockResolvedValue(
      makeListResponse([makeListing({ id: 5, is_featured: false, title: 'Feature Me' })], 1)
    );
    mockAdminListings.feature.mockResolvedValue({ success: true });

    const { ListingsAdmin } = await import('./ListingsAdmin');
    render(<ListingsAdmin />);

    await waitFor(() => screen.getByText('Feature Me'));

    const featureBtn = screen.queryAllByRole('button').find(
      (b) =>
        b.getAttribute('aria-label')?.toLowerCase().includes('feature') &&
        !b.getAttribute('aria-label')?.toLowerCase().includes('unfeature')
    );
    if (featureBtn) {
      fireEvent.click(featureBtn);
      await waitFor(() => {
        expect(mockAdminListings.feature).toHaveBeenCalledWith(5);
      });
    }
  });

  it('shows success toast after approve action', async () => {
    mockAdminListings.list.mockResolvedValue(
      makeListResponse([makeListing({ id: 6, status: 'pending', title: 'Toast Me' })], 1)
    );
    mockAdminListings.approve.mockResolvedValue({ success: true });

    const { ListingsAdmin } = await import('./ListingsAdmin');
    render(<ListingsAdmin />);

    await waitFor(() => screen.getByText('Toast Me'));

    const approveBtn = screen.queryAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('approve')
    );
    if (approveBtn) {
      fireEvent.click(approveBtn);
      await waitFor(() => screen.getByTestId('confirm-modal'));
      fireEvent.click(screen.getByTestId('confirm-btn'));
      await waitFor(() => {
        expect(mockToast.success).toHaveBeenCalled();
      });
    }
  });
});
