// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts());

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from '@/lib/api';
import { VereinMembershipBadge } from './VereinMembershipBadge';

/** Helper: build a mock API success response */
function makeResponse(
  current: { status: string } | null,
  isMember = false
) {
  return {
    success: true,
    data: {
      user_id: 1,
      organization_id: 10,
      current_year: 2026,
      current,
      is_current_member: isMember,
    },
  };
}

describe('VereinMembershipBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Loading / null state ────────────────────────────────────────────────

  it('renders no chip while the API is still pending', () => {
    // Keep the promise unresolved so data stays null
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<VereinMembershipBadge userId={1} organizationId={10} />);
    // No chip rendered — query by the known chip text patterns
    expect(screen.queryByRole('img', { hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
  });

  // ── No record (data.current === null) with hideWhenAbsent=true ──────────

  it('renders no chip when current is null and hideWhenAbsent=true', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeResponse(null));
    render(<VereinMembershipBadge userId={1} organizationId={10} />);
    // Wait for the effect to resolve then confirm nothing renders
    await waitFor(() => {
      expect(api.get).toHaveBeenCalled();
    });
    expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pending/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
  });

  // ── No record with hideWhenAbsent=false — status 'none' ───────────────

  it('renders no chip for status "none" (fallthrough to null return)', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeResponse({ status: 'none' })
    );
    render(<VereinMembershipBadge userId={1} organizationId={10} hideWhenAbsent={false} />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalled();
    });
    // 'none' falls through to `return null` at the end of the component
    expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
  });

  // ── Paid membership ────────────────────────────────────────────────────

  it('renders a chip containing the year for status "paid"', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeResponse({ status: 'paid' }, true)
    );
    render(<VereinMembershipBadge userId={1} organizationId={10} />);
    await waitFor(() => {
      expect(screen.getByText(/2026/)).toBeInTheDocument();
    });
  });

  // ── Waived membership ──────────────────────────────────────────────────

  it('renders a chip containing the year for status "waived"', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeResponse({ status: 'waived' }, true)
    );
    render(<VereinMembershipBadge userId={1} organizationId={10} />);
    await waitFor(() => {
      expect(screen.getByText(/2026/)).toBeInTheDocument();
    });
  });

  // ── Pending status ─────────────────────────────────────────────────────

  it('renders a warning chip for status "pending"', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeResponse({ status: 'pending' })
    );
    render(<VereinMembershipBadge userId={1} organizationId={10} hideWhenAbsent={false} />);
    await waitFor(() => {
      // i18n in test env returns the key or fallback; key contains 'pending'
      expect(screen.getByText(/pending/i)).toBeInTheDocument();
    });
  });

  // ── Overdue status ─────────────────────────────────────────────────────

  it('renders a warning chip for status "overdue"', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeResponse({ status: 'overdue' })
    );
    render(<VereinMembershipBadge userId={1} organizationId={10} hideWhenAbsent={false} />);
    await waitFor(() => {
      expect(screen.getByText(/overdue/i)).toBeInTheDocument();
    });
  });

  // ── API failure (silenced) ─────────────────────────────────────────────

  it('renders no chip when the API call throws (silent best-effort)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'));
    render(<VereinMembershipBadge userId={1} organizationId={10} />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalled();
    });
    expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
  });

  // ── API success=false ──────────────────────────────────────────────────

  it('renders no chip when res.success is false', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: false, data: null });
    render(<VereinMembershipBadge userId={1} organizationId={10} />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalled();
    });
    expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
  });

  // ── Correct API URL ────────────────────────────────────────────────────

  it('fetches from the correct URL with userId and organizationId', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: false, data: null });
    render(<VereinMembershipBadge userId={42} organizationId={7} />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        '/v2/users/42/verein-membership-status?organization_id=7'
      );
    });
  });
});
