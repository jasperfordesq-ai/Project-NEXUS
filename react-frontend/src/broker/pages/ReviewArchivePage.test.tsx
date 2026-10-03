// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
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

  // Approved / Flagged used to count the rows on screen under a label that
  // read like a total. Each now reads the paginated total of a one-page probe
  // per decision; Reviewers has no such probe and keeps its honest label.
  it('renders whole-archive totals for Approved and Flagged, and an honest per-page Reviewers count', async () => {
    mockGetArchives.mockImplementation(async ({ decision }: { decision?: string }) => {
      const totals: Record<string, number> = { approved: 41, flagged: 9 };
      if (decision && decision in totals) return { success: true, data: [], meta: { total: totals[decision] } };
      return { success: true, data: ARCHIVE_ROWS, meta: { total: 2 } };
    });
    render(<ReviewArchive />);
    await waitFor(() => {
      expect(screen.getByText('Archived records')).toBeInTheDocument();
    });
    expect(screen.getByText('Approved records')).toBeInTheDocument();
    expect(screen.getByText('Flagged records')).toBeInTheDocument();
    expect(screen.queryByText('Approved on this page')).not.toBeInTheDocument();
    expect(screen.queryByText('Flagged on this page')).not.toBeInTheDocument();
    expect(screen.getByText('Reviewers on this page')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('41')).toBeInTheDocument();
      expect(screen.getByText('9')).toBeInTheDocument();
    });
    expect(mockGetArchives).toHaveBeenCalledWith({ page: 1, decision: 'approved' });
    expect(mockGetArchives).toHaveBeenCalledWith({ page: 1, decision: 'flagged' });
  });

  it('names an unexpected decision through the shared status chip, never a capitalised slug', async () => {
    mockGetArchives.mockResolvedValue({
      success: true,
      data: [{ ...ARCHIVE_ROWS[0], decision: 'weird_new_state' }],
      meta: { total: 1 },
    });
    render(<ReviewArchive />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('Weird New State')).not.toBeInTheDocument();
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

describe('ReviewArchivePage — search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    mockGetArchives.mockResolvedValue({ success: true, data: ARCHIVE_ROWS, meta: { total: 2 } });
  });

  // Every keystroke used to fire a request. The search now waits 300 ms of
  // quiet before asking the server, as the Messages page already did.
  it('debounces the search so one request goes out for a word, not one per letter', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<ReviewArchive />);
      await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
      const listCallsBefore = mockGetArchives.mock.calls.filter((c) => 'search' in (c[0] ?? {})).length;

      const input = screen.getByRole('textbox', { name: 'Search archive' });
      fireEvent.change(input, { target: { value: 'a' } });
      fireEvent.change(input, { target: { value: 'al' } });
      fireEvent.change(input, { target: { value: 'ali' } });

      // Nothing yet: still inside the debounce window.
      await vi.advanceTimersByTimeAsync(100);
      expect(mockGetArchives.mock.calls.filter((c) => c[0]?.search === 'ali').length).toBe(0);

      await vi.advanceTimersByTimeAsync(300);
      await waitFor(() => {
        expect(mockGetArchives).toHaveBeenCalledWith(expect.objectContaining({ page: 1, search: 'ali' }));
      });
      const listCallsAfter = mockGetArchives.mock.calls.filter((c) => 'search' in (c[0] ?? {})).length;
      expect(listCallsAfter - listCallsBefore).toBe(1);
      expect(mockGetArchives).not.toHaveBeenCalledWith(expect.objectContaining({ search: 'a' }));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ReviewArchivePage — error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    mockGetArchives.mockRejectedValue(new Error('Network error'));
  });

  it('treats a success:false list response as an error, not an empty archive', async () => {
    mockGetArchives.mockResolvedValue({ success: false, error: 'nope' });
    render(<ReviewArchive />);
    expect(await screen.findByText("Couldn't load the archive")).toBeInTheDocument();
    expect(screen.queryByText('No archived records found.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows error toast on load failure', async () => {
    render(<ReviewArchive />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders an honest error state with retry when loading fails', async () => {
    // The KPI probes share the endpoint, so fail the LIST call (the one that
    // carries a `search` key) once rather than whichever call comes first.
    let listFailed = false;
    mockGetArchives.mockImplementation(async (params: Record<string, unknown>) => {
      if ('search' in params) {
        if (!listFailed) {
          listFailed = true;
          throw new Error('Network error');
        }
        return { success: true, data: ARCHIVE_ROWS, meta: { total: 2 } };
      }
      return { success: true, data: [], meta: { total: 0 } };
    });
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

    // The KPI probe already asked for decision=approved once; the tab click
    // must add a list request for it (the list call carries a `search` key).
    const listCalls = () =>
      mockGetArchives.mock.calls.filter((c) => c[0]?.decision === 'approved' && 'search' in (c[0] ?? {})).length;
    expect(listCalls()).toBe(0);

    // Find the Approved tab (HeroUI Tabs renders tab items with role=tab)
    const approvedTab = screen.getByRole('tab', { name: /approved/i });
    await user.click(approvedTab);

    await waitFor(() => {
      expect(listCalls()).toBe(1);
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
