// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── vi.hoisted: stable mock data factories ──────────────────────────────────
const { mockGetApprovals } = vi.hoisted(() => ({
  mockGetApprovals: vi.fn(),
}));

// ─── Mock adminMatching from adminApi ────────────────────────────────────────
vi.mock('../../api/adminApi', () => ({
  adminMatching: {
    getApprovals: mockGetApprovals,
  },
  // Other exports referenced by unrelated imports in the same file
  adminTimebanking: { getOrgWallets: vi.fn() },
  adminSettings: { getFeedAlgorithm: vi.fn(), updateFeedAlgorithm: vi.fn() },
}));

// ─── Mock @/contexts ─────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);

// ─── Mock @/hooks ────────────────────────────────────────────────────────────
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Mock admin sub-components that need full admin context ─────────────────
vi.mock('../../components/DataTable', () => ({
    DataTable: ({ data, onRefresh, totalItems, page, onPageChange }: {
      data: unknown[];
      onRefresh?: () => void;
      totalItems?: number;
      page?: number;
      onPageChange?: (page: number) => void;
    }) => (
      <div data-testid="data-table">
        <span data-testid="row-count">{data.length}</span>
        <span data-testid="total-items">{totalItems}</span>
        {onRefresh && <button onClick={onRefresh}>Refresh</button>}
        {onPageChange && <button onClick={() => onPageChange((page ?? 1) + 1)}>Next page</button>}
      </div>
    ),
    StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock('../../components/EmptyState', () => ({
  EmptyState: ({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) => (
    <div data-testid="empty-state">
      {title}
      {actionLabel && onAction && <button onClick={onAction}>{actionLabel}</button>}
    </div>
  ),
}));

import { SmartMatchUsers } from './SmartMatchUsers';

function makeMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    user_1_name: 'Alice Smith',
    user_1_email: 'alice@example.com',
    user_2_name: 'Bob Jones',
    user_2_email: 'bob@example.com',
    listing_title: 'Gardening help',
    match_score: 85,
    status: 'approved',
    created_at: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

describe('SmartMatchUsers — loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading spinner while fetching', () => {
    mockGetApprovals.mockReturnValue(new Promise(() => {}));
    render(<SmartMatchUsers />);
    const spinner = screen
      .getAllByRole('status')
      .find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinner).toBeInTheDocument();
  });
});

describe('SmartMatchUsers — populated state (array response)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes spinner and renders DataTable when data arrives as array', async () => {
    mockGetApprovals.mockResolvedValue({
      success: true,
      data: [makeMatch(), makeMatch({ id: 2, user_1_name: 'Carol' })],
    });

    render(<SmartMatchUsers />);

    await waitFor(() => {
      const spinner = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(spinner).toBeUndefined();
    });

    expect(screen.getByTestId('data-table')).toBeInTheDocument();
    expect(screen.getByTestId('row-count').textContent).toBe('2');
  });

  // The shared api client (src/lib/api.ts) unwraps the `data` envelope, so a
  // paginated response resolves as `{ success, data: rows, meta }`. An earlier
  // fixture here nested `meta` inside `data`, a shape the client never produces,
  // which hid that the page ignored the real `meta`.
  //
  // Regression: with more than 20 matches the page counted only the 20 rows it
  // was given, so the table never offered a second page.
  it('uses the total from the response meta, not the rows on this page', async () => {
    mockGetApprovals.mockResolvedValue({
      success: true,
      data: [makeMatch(), makeMatch({ id: 2 }), makeMatch({ id: 3 })],
      meta: { current_page: 1, per_page: 20, total: 45, total_pages: 3 },
    });

    render(<SmartMatchUsers />);

    await waitFor(() => {
      expect(screen.getByTestId('data-table')).toBeInTheDocument();
    });

    expect(screen.getByTestId('row-count').textContent).toBe('3');
    expect(screen.getByTestId('total-items').textContent).toBe('45');
  });

  it('requests page 2 when the next page is chosen', async () => {
    mockGetApprovals.mockResolvedValue({
      success: true,
      data: [makeMatch()],
      meta: { current_page: 1, per_page: 20, total: 45, total_pages: 3 },
    });

    render(<SmartMatchUsers />);

    fireEvent.click(await screen.findByRole('button', { name: 'Next page' }));

    await waitFor(() => {
      expect(mockGetApprovals).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    });
  });
});

describe('SmartMatchUsers — empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders EmptyState when data array is empty', async () => {
    mockGetApprovals.mockResolvedValue({
      success: true,
      data: [],
    });

    render(<SmartMatchUsers />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('data-table')).not.toBeInTheDocument();
  });

  it('renders a retryable error when success is false', async () => {
    mockGetApprovals.mockResolvedValue({ success: false });

    render(<SmartMatchUsers />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/failed to load match results/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

describe('SmartMatchUsers — error state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a generic error without a toast when API throws', async () => {
    mockGetApprovals.mockRejectedValue(new Error('server down'));

    render(<SmartMatchUsers />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/failed to load match results/i);
    });
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('shows retry action after API error', async () => {
    mockGetApprovals.mockRejectedValue(new Error('network'));

    render(<SmartMatchUsers />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

describe('SmartMatchUsers — refresh action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-fetches when the DataTable refresh button is pressed', async () => {
    mockGetApprovals.mockResolvedValue({
      success: true,
      data: [makeMatch()],
    });

    render(<SmartMatchUsers />);

    await waitFor(() => {
      expect(screen.getByTestId('data-table')).toBeInTheDocument();
    });

    // The stub DataTable renders a Refresh button that calls onRefresh.
    const tableRefresh = screen.getByTestId('data-table').querySelector('button');
    expect(tableRefresh).not.toBeNull();
    tableRefresh?.click();

    await waitFor(() => {
      expect(mockGetApprovals).toHaveBeenCalledTimes(2);
    });
  });
});
