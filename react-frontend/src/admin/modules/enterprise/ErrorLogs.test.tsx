// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── Stable hoisted mock data ──────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

const mockGetLogs = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts({
  useToast: () => mockToast,
}));

vi.mock('../../api/adminApi', () => ({
  adminEnterprise: {
    getLogs: mockGetLogs,
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// usePageTitle
vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

import { ErrorLogs } from './ErrorLogs';

// ── Test helpers ──────────────────────────────────────────────────────────────
const SAMPLE_LOGS = [
  {
    id: 10,
    action: 'auth.failed',
    description: 'Login failed for user test@test.com',
    user_name: 'Alice',
    ip_address: '192.168.1.1',
    created_at: '2024-03-01T12:00:00Z',
  },
  {
    id: 11,
    action: 'permission.denied',
    description: 'Unauthorized access attempt',
    user_name: null,
    ip_address: null,
    created_at: '2024-03-02T08:30:00Z',
  },
];

// Mirrors what the shared api client (src/lib/api.ts) really resolves with: it
// unwraps the `data` envelope, so `data` is the bare row array and pagination
// lives on the sibling `meta`. An earlier fixture nested `meta` inside `data`,
// a shape the client never produces, which hid that the page ignored `meta`.
const paginated = (
  data: typeof SAMPLE_LOGS,
  meta: { total?: number; total_pages?: number; per_page?: number; current_page?: number } = {},
) => ({
  success: true,
  data,
  meta: { current_page: 1, per_page: 50, total: data.length, total_pages: 1, ...meta },
});

describe('ErrorLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLogs.mockResolvedValue(paginated([]));
  });

  // ── Loading state ─────────────────────────────────────────────────────────
  it('shows a loading spinner while fetching', () => {
    mockGetLogs.mockReturnValue(new Promise(() => {}));
    render(<ErrorLogs />);

    const spinners = screen.getAllByRole('status');
    const busyEl = spinners.find(el => el.getAttribute('aria-busy') === 'true');
    expect(busyEl).toBeInTheDocument();
  });

  // ── Populated state ───────────────────────────────────────────────────────
  // By data attribute rather than the chip's text: the label is
  // t(`enterprise.error_log_action_${...}`) and no i18n resources load under
  // test, so every action renders the same missing-key output.
  const renderedActions = () =>
    screen.getAllByTestId('error-log-action-chip').map((chip) => chip.getAttribute('data-action'));

  it('renders log rows after successful fetch (array format)', async () => {
    mockGetLogs.mockResolvedValue({ success: true, data: SAMPLE_LOGS });
    render(<ErrorLogs />);

    await waitFor(() => {
      expect(renderedActions()).toContain('auth.failed');
    });
    expect(renderedActions()).toContain('permission.denied');
  });

  it('renders log rows from a paginated response', async () => {
    mockGetLogs.mockResolvedValue(paginated(SAMPLE_LOGS));
    render(<ErrorLogs />);

    await waitFor(() => {
      expect(renderedActions()).toContain('auth.failed');
    });
  });

  it('renders ip address in monospace when present', async () => {
    mockGetLogs.mockResolvedValue({ success: true, data: SAMPLE_LOGS });
    render(<ErrorLogs />);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
    });
  });

  it('renders --- placeholder for null user_name', async () => {
    mockGetLogs.mockResolvedValue({ success: true, data: SAMPLE_LOGS });
    render(<ErrorLogs />);

    await waitFor(() => {
      const dashes = screen.getAllByText('---');
      expect(dashes.length).toBeGreaterThan(0);
    });
  });

  // ── Empty state ───────────────────────────────────────────────────────────
  it('removes loading indicator when empty list is returned', async () => {
    mockGetLogs.mockResolvedValue(paginated([]));
    render(<ErrorLogs />);

    await waitFor(() => {
      const busyEl = screen.queryAllByRole('status').find(
        el => el.getAttribute('aria-busy') === 'true',
      );
      expect(busyEl).toBeUndefined();
    });

    expect(screen.queryAllByTestId('error-log-action-chip')).toHaveLength(0);
  });

  // ── Error state ───────────────────────────────────────────────────────────
  it('calls toast.error when API throws', async () => {
    mockGetLogs.mockRejectedValue(new Error('500 Server Error'));
    render(<ErrorLogs />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── Refresh action ────────────────────────────────────────────────────────
  it('re-fetches when Refresh button is clicked', async () => {
    const user = userEvent.setup();
    mockGetLogs.mockResolvedValue(paginated([]));
    render(<ErrorLogs />);

    await waitFor(() => {
      const busyEl = screen.queryAllByRole('status').find(
        el => el.getAttribute('aria-busy') === 'true',
      );
      expect(busyEl).toBeUndefined();
    });

    const btn = screen.getByRole('button', { name: /refresh/i });
    await user.click(btn);

    await waitFor(() => {
      expect(mockGetLogs).toHaveBeenCalledTimes(2);
    });
  });

  // ── Pagination ────────────────────────────────────────────────────────────
  // Regression: the endpoint returns 50 rows a page with the true total on
  // `meta`. The page counted only the rows it was given, so an admin never saw
  // a page control and every log entry past the first 50 was unreachable.
  it('offers the right number of pages when the API reports more than one', async () => {
    mockGetLogs.mockResolvedValue(paginated(SAMPLE_LOGS, { total: 120, total_pages: 3, per_page: 50 }));
    render(<ErrorLogs />);

    const nav = await screen.findByRole('navigation');
    expect(within(nav).getByRole('button', { name: '3' })).toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: '4' })).not.toBeInTheDocument();
  });

  it('requests page 2 when the next page is chosen', async () => {
    const user = userEvent.setup();
    mockGetLogs.mockResolvedValue(paginated(SAMPLE_LOGS, { total: 120, total_pages: 3, per_page: 50 }));
    render(<ErrorLogs />);

    const nav = await screen.findByRole('navigation');
    await user.click(within(nav).getByRole('button', { name: '2' }));

    await waitFor(() => {
      expect(mockGetLogs).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    });
  });
});
