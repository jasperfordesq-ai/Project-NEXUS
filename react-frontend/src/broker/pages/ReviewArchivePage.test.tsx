// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── Mock adminBroker API ─────────────────────────────────────────────────────
const mockGetArchives = vi.fn();

vi.mock('@/admin/api/adminApi', () => ({
  adminBroker: {
    getArchives: (...args: unknown[]) => mockGetArchives(...args),
  },
}));

// ── Stable context mocks ─────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

// ── serverTime stub ──────────────────────────────────────────────────────────
vi.mock('@/lib/serverTime', () => ({
  formatServerDate: (v: string) => v,
  formatServerDateTime: (v: string) => v,
}));

// ── DataTable mock (renders rows through the page's column renderers) ────────
vi.mock('@/admin/components', () => ({
  DataTable: ({
    columns,
    data,
    isLoading,
    emptyContent,
  }: {
    columns: { key: string; label: string; render?: (item: unknown) => React.ReactNode }[];
    data: unknown[];
    isLoading?: boolean;
    emptyContent?: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <div data-testid="data-table">
      {isLoading && (
        <div role="status" aria-busy="true" aria-label="Loading">
          Loading...
        </div>
      )}
      {!isLoading && data.length === 0 && <div data-testid="empty">{emptyContent}</div>}
      {!isLoading &&
        data.map((row) => (
          <div key={String((row as Record<string, unknown>).id)} data-testid="table-row">
            {columns.map((col) => (
              <div key={col.key}>{col.render ? col.render(row) : null}</div>
            ))}
          </div>
        ))}
    </div>
  ),
}));

// ── Sample data ───────────────────────────────────────────────────────────────
const ARCHIVE_ROWS = [
  {
    id: 1,
    sender_name: 'Alice Smith',
    receiver_name: 'Bob Jones',
    listing_title: 'Tutoring',
    copy_reason: 'flagged',
    decision: 'approved',
    decided_by_name: 'Admin',
    decided_at: '2026-06-01T10:00:00Z',
  },
  {
    id: 2,
    sender_name: 'Carol White',
    receiver_name: 'Dan Brown',
    listing_title: null,
    copy_reason: 'compliance',
    decision: 'flagged',
    decided_by_name: 'Broker',
    decided_at: '2026-06-02T11:00:00Z',
  },
];

import { ReviewArchive } from './ReviewArchivePage';

describe('ReviewArchivePage — loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    mockGetArchives.mockReturnValue(new Promise(() => {})); // pending
  });

  it('shows a shaped skeleton while first loading', () => {
    render(<ReviewArchive />);
    // Initial load renders BrokerSkeleton (role=status), not the data table.
    expect(screen.queryByTestId('data-table')).toBeNull();
    const busy = screen
      .getAllByRole('status')
      .find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeTruthy();
  });
});

describe('ReviewArchivePage — populated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    mockGetArchives.mockResolvedValue({
      success: true,
      data: ARCHIVE_ROWS,
      meta: { total: 2 },
    });
  });

  it('renders archive rows after load', async () => {
    render(<ReviewArchive />);
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.getByText('Carol White')).toBeInTheDocument();
    });
  });

  it('loading skeleton gone after data arrives', async () => {
    render(<ReviewArchive />);
    await waitFor(() => {
      const spinner = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(spinner).toBeUndefined();
    });
  });

  it('calls getArchives with page=1 on mount', async () => {
    render(<ReviewArchive />);
    await waitFor(() => {
      expect(mockGetArchives).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1 }),
      );
    });
  });

  it('renders the KPI header derived from the fetched rows', async () => {
    render(<ReviewArchive />);
    await waitFor(() => {
      expect(screen.getByText('Archived records')).toBeInTheDocument();
    });
    expect(screen.getByText('Approved on this page')).toBeInTheDocument();
    expect(screen.getByText('Flagged on this page')).toBeInTheDocument();
    expect(screen.getByText('Reviewers on this page')).toBeInTheDocument();
  });

  it('renders decision chips for approved and flagged records', async () => {
    render(<ReviewArchive />);
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    // The chip text appears in the row plus the matching filter tab.
    expect(screen.getAllByText('Approved').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Flagged').length).toBeGreaterThanOrEqual(2);
  });

  it('renders reviewer and date cells', async () => {
    render(<ReviewArchive />);
    await waitFor(() => {
      expect(screen.getByText('Admin')).toBeInTheDocument();
    });
    expect(screen.getByText('Broker')).toBeInTheDocument();
    expect(screen.getByText('2026-06-01T10:00:00Z')).toBeInTheDocument();
  });
});

describe('ReviewArchivePage — empty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    mockGetArchives.mockResolvedValue({ success: true, data: [], meta: { total: 0 } });
  });

  it('shows empty content when no archives returned', async () => {
    render(<ReviewArchive />);
    await waitFor(() => {
      expect(screen.getByTestId('empty')).toBeInTheDocument();
    });
    expect(screen.getByText('No archived records found.')).toBeInTheDocument();
  });

  it('shows a filter-aware empty state on a filtered view', async () => {
    window.history.replaceState({}, '', '/?decision=approved');
    render(<ReviewArchive />);
    await waitFor(() => {
      expect(screen.getByText('No matching records')).toBeInTheDocument();
    });
  });
});

describe('ReviewArchivePage — error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    mockGetArchives.mockRejectedValue(new Error('Network error'));
  });

  it('shows error toast on load failure', async () => {
    render(<ReviewArchive />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders an honest error state with retry when loading fails', async () => {
    mockGetArchives
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ success: true, data: ARCHIVE_ROWS, meta: { total: 2 } });
    const user = userEvent.setup();
    render(<ReviewArchive />);

    expect(await screen.findByText("Couldn't load the archive")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
  });
});

describe('ReviewArchivePage — filter tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    mockGetArchives.mockResolvedValue({ success: true, data: ARCHIVE_ROWS, meta: { total: 2 } });
  });

  it('re-fetches with decision=approved when Approved tab clicked', async () => {
    const user = userEvent.setup();
    render(<ReviewArchive />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    // Find the Approved tab (HeroUI Tabs renders tab items with role=tab)
    const approvedTab = screen.getByRole('tab', { name: /approved/i });
    await user.click(approvedTab);

    await waitFor(() => {
      expect(mockGetArchives).toHaveBeenCalledWith(
        expect.objectContaining({ decision: 'approved' }),
      );
    });
  });

  it('honours a deep-linked ?decision=flagged filter', async () => {
    window.history.replaceState({}, '', '/?decision=flagged');
    render(<ReviewArchive />);
    await waitFor(() => {
      expect(mockGetArchives).toHaveBeenCalledWith(
        expect.objectContaining({ decision: 'flagged' }),
      );
    });
  });
});
