// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── Stable hoisted mock data ──────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

const mockGetGdprConsents = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts({
  useToast: () => mockToast,
}));

vi.mock('../../api/adminApi', () => ({
  adminEnterprise: {
    getGdprConsents: mockGetGdprConsents,
  },
}));

// useAdminPageMeta calls useContext — stub out the AdminMetaContext module
vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { GdprConsents } from './GdprConsents';

// ── Test helpers ──────────────────────────────────────────────────────────────
const SAMPLE_CONSENTS = [
  {
    id: 1,
    user_name: 'Alice',
    consent_type: 'marketing',
    consented: true,
    consented_at: '2024-01-15T10:00:00Z',
    created_at: '2024-01-15T10:00:00Z',
  },
  {
    id: 2,
    user_name: 'Bob',
    consent_type: 'analytics',
    consented: false,
    consented_at: null,
    created_at: '2024-02-20T09:00:00Z',
  },
];

describe('GdprConsents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: loading hangs — override per test
    mockGetGdprConsents.mockResolvedValue({ success: true, data: [] });
  });

  // ── Loading state ─────────────────────────────────────────────────────────
  it('shows a loading spinner while fetching', async () => {
    // Never resolves during this check
    mockGetGdprConsents.mockReturnValue(new Promise(() => {}));
    render(<GdprConsents />);

    // DataTable renders an aria-busy spinner while isLoading=true
    const spinners = screen.getAllByRole('status');
    const busyEl = spinners.find(el => el.getAttribute('aria-busy') === 'true');
    expect(busyEl).toBeInTheDocument();
  });

  // ── Populated state ───────────────────────────────────────────────────────
  it('renders consent rows after successful fetch', async () => {
    mockGetGdprConsents.mockResolvedValue({ success: true, data: SAMPLE_CONSENTS });
    render(<GdprConsents />);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  // This one was doubly stale: the chip renders `consent_type_name` (the API's
  // human-readable label) and falls back to a translated "unknown", so the raw
  // consent_type was never on screen — the fixture does not set a name. Asserting
  // the data attribute checks what the test actually means: one chip per consent,
  // carrying the right type.
  it('renders consent_type chips', async () => {
    mockGetGdprConsents.mockResolvedValue({ success: true, data: SAMPLE_CONSENTS });
    render(<GdprConsents />);

    await waitFor(() => {
      expect(screen.getAllByTestId('consent-type-chip').length).toBeGreaterThan(0);
    });

    const types = screen
      .getAllByTestId('consent-type-chip')
      .map((chip) => chip.getAttribute('data-consent-type'));
    expect(types).toContain('marketing');
    expect(types).toContain('analytics');
  });

  // ── Empty state ───────────────────────────────────────────────────────────
  it('renders empty-state message when no consents returned', async () => {
    mockGetGdprConsents.mockResolvedValue({ success: true, data: [] });
    render(<GdprConsents />);

    await waitFor(() => {
      // spinner should be gone
      const busyEl = screen.queryAllByRole('status').find(
        el => el.getAttribute('aria-busy') === 'true',
      );
      expect(busyEl).toBeUndefined();
    });
    // DataTable emptyContent is rendered — key i18n phrase
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  // ── Error state ───────────────────────────────────────────────────────────
  it('shows toast error when API throws', async () => {
    mockGetGdprConsents.mockRejectedValue(new Error('Network error'));
    render(<GdprConsents />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── Refresh action ────────────────────────────────────────────────────────
  it('re-fetches data when Refresh button is pressed', async () => {
    const user = userEvent.setup();
    mockGetGdprConsents.mockResolvedValue({ success: true, data: [] });
    render(<GdprConsents />);

    await waitFor(() => {
      const busyEl = screen.queryAllByRole('status').find(
        el => el.getAttribute('aria-busy') === 'true',
      );
      expect(busyEl).toBeUndefined();
    });

    // Find refresh button — it contains the i18n key text "Refresh"
    const btn = screen.getByRole('button', { name: /refresh/i });
    await user.click(btn);

    // API should have been called a second time
    await waitFor(() => {
      expect(mockGetGdprConsents).toHaveBeenCalledTimes(2);
    });
  });

  // ── success=false branch ─────────────────────────────────────────────────
  it('renders empty table (no toast) when API returns success=false', async () => {
    mockGetGdprConsents.mockResolvedValue({ success: false, data: null });
    render(<GdprConsents />);

    await waitFor(() => {
      const busyEl = screen.queryAllByRole('status').find(
        el => el.getAttribute('aria-busy') === 'true',
      );
      expect(busyEl).toBeUndefined();
    });

    expect(mockToast.error).not.toHaveBeenCalled();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });
});
