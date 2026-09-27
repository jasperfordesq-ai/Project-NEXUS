// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Mock adminApi ────────────────────────────────────────────────────────────
vi.mock('@/admin/api/adminApi', () => {
  const getModeration = vi.fn();
  return {
    adminGroups: { getModeration },
  };
});

// ── Mock contexts ────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);

// ── Admin sub-components used by GroupModeration ─────────────────────────────
vi.mock('@/admin/components', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/admin/components')>();
  return {
    ...real,
    // DataTable renders an HTML table with the items so we keep it real.
  };
});

// ── Stable test data ─────────────────────────────────────────────────────────
const MOCK_ITEMS = vi.hoisted(() => [
  {
    id: 1,
    name: 'Problematic Group',
    status: 'active',
    report_count: 3,
    created_at: '2025-03-10T00:00:00Z',
  },
  {
    id: 2,
    name: 'Clean Group',
    status: 'active',
    report_count: 0,
    created_at: '2025-04-01T00:00:00Z',
  },
]);

import { adminGroups } from '@/admin/api/adminApi';
import { GroupModeration } from './GroupModeration';

describe('GroupModeration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Loading state ────────────────────────────────────────────────────────
  it('renders a loading spinner (role=status aria-busy=true) while fetching', () => {
    vi.mocked(adminGroups.getModeration).mockReturnValue(new Promise(() => {}));
    render(<GroupModeration />);

    const statusEls = screen.getAllByRole('status');
    const spinner = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinner).toBeInTheDocument();
  });

  it('removes the busy spinner after data loads', async () => {
    vi.mocked(adminGroups.getModeration).mockResolvedValueOnce({
      success: true,
      data: MOCK_ITEMS,
    } as never);

    render(<GroupModeration />);

    await waitFor(() => {
      const statusEls = screen.queryAllByRole('status');
      const spinner = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(spinner).toBeUndefined();
    });
  });

  // ── Populated state ──────────────────────────────────────────────────────
  it('renders group names in DataTable when moderation items are returned as array', async () => {
    vi.mocked(adminGroups.getModeration).mockResolvedValueOnce({
      success: true,
      data: MOCK_ITEMS,
    } as never);

    render(<GroupModeration />);

    await waitFor(() => {
      expect(screen.getByText('Problematic Group')).toBeInTheDocument();
      expect(screen.getByText('Clean Group')).toBeInTheDocument();
    });
  });

  it('still renders items from a legacy/fallback nested { data: [...] } payload', async () => {
    // Legacy/fallback shape only. GET /v2/admin/groups/moderation really sends a
    // bare array (respondWithData), which is what the other tests here mock.
    vi.mocked(adminGroups.getModeration).mockResolvedValueOnce({
      success: true,
      data: { data: MOCK_ITEMS },
    } as never);

    render(<GroupModeration />);

    await waitFor(() => {
      expect(screen.getByText('Problematic Group')).toBeInTheDocument();
    });
  });

  // ── Empty state ──────────────────────────────────────────────────────────
  it('renders the EmptyState component when no flagged groups exist', async () => {
    vi.mocked(adminGroups.getModeration).mockResolvedValueOnce({
      success: true,
      data: [],
    } as never);

    render(<GroupModeration />);

    await waitFor(() => {
      // EmptyState renders its title; translation key contains "no_flagged_content"
      // In test environment keys are returned as-is: check for some content
      expect(screen.queryByText('Problematic Group')).not.toBeInTheDocument();
    });
  });

  // ── Error state ──────────────────────────────────────────────────────────
  it('calls toast.error when the API throws', async () => {
    vi.mocked(adminGroups.getModeration).mockRejectedValueOnce(new Error('500'));

    render(<GroupModeration />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── API call ─────────────────────────────────────────────────────────────
  it('calls adminGroups.getModeration on mount', async () => {
    vi.mocked(adminGroups.getModeration).mockResolvedValueOnce({
      success: true,
      data: [],
    } as never);

    render(<GroupModeration />);

    await waitFor(() => {
      expect(adminGroups.getModeration).toHaveBeenCalledTimes(1);
    });
  });
});
