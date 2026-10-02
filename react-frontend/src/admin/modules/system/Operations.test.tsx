// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';
import type { User } from '@/types/api';

// ── mock contexts ────────────────────────────────────────────────────────────

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

// The Background Jobs card (the cron jobs) is god-only, so most tests run as a
// god; the non-god tests swap in a platform super admin who is not one.
const GOD_USER = { id: 1, name: 'God User', role: 'admin', is_god: true } as User;
const SUPER_ADMIN_USER = { id: 2, name: 'Super Admin', role: 'admin', is_super_admin: true } as User;
const authState = vi.hoisted(() => ({ user: null as User | null }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: authState.user,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  }),
);

// ── mock adminApi ────────────────────────────────────────────────────────────

const mockGetCacheStats = vi.hoisted(() => vi.fn());
const mockGetJobs = vi.hoisted(() => vi.fn());
const mockClearCache = vi.hoisted(() => vi.fn());
const mockRunJob = vi.hoisted(() => vi.fn());

vi.mock('@/admin/api/adminApi', () => ({
  adminConfig: {
    getCacheStats: mockGetCacheStats,
    getJobs: mockGetJobs,
    clearCache: mockClearCache,
    runJob: mockRunJob,
  },
}));

// ── mock hooks ───────────────────────────────────────────────────────────────

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ── component ────────────────────────────────────────────────────────────────

import Operations from './Operations';

const CACHE_DATA = {
  redis_connected: true,
  redis_memory_used: '4.2 MB',
  redis_keys_count: 312,
};

const JOBS_DATA = [
  { id: 'digest_emails', translation_key: 'digest_emails', name: 'SERVER COPY MUST NOT RENDER', last_run_at: '2026-06-21T08:00:00Z' },
  { id: 'badge_checker', translation_key: 'badge_checker', name: 'SERVER COPY MUST NOT RENDER', last_run_at: null },
];

function setupHappyPath() {
  mockGetCacheStats.mockResolvedValue({ success: true, data: CACHE_DATA });
  mockGetJobs.mockResolvedValue({ success: true, data: JOBS_DATA });
}

describe('Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { ...GOD_USER };
  });

  it('hides the background (cron) jobs from an admin who is not god, and does not fetch them', async () => {
    authState.user = { ...SUPER_ADMIN_USER };
    setupHappyPath();
    render(<Operations />);

    // Control: the page really loaded — the cache card rendered.
    await waitFor(() => {
      expect(screen.getByText('4.2 MB')).toBeInTheDocument();
    });
    expect(screen.queryByText('Background Jobs')).not.toBeInTheDocument();
    expect(screen.queryByText('Email digest sender')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /run.*email digest sender/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Cache statistics and background job controls.')).not.toBeInTheDocument();
    expect(screen.getByText('Cache statistics and controls.')).toBeInTheDocument();
    expect(mockGetJobs).not.toHaveBeenCalled();
  });

  it('shows the background (cron) jobs card to a god account', async () => {
    setupHappyPath();
    render(<Operations />);

    await waitFor(() => {
      expect(screen.getByText('Background Jobs')).toBeInTheDocument();
    });
    expect(screen.getByText('Cache statistics and background job controls.')).toBeInTheDocument();
    expect(mockGetJobs).toHaveBeenCalledTimes(1);
  });

  it('shows loading spinner while fetching', () => {
    mockGetCacheStats.mockReturnValue(new Promise(() => {}));
    mockGetJobs.mockReturnValue(new Promise(() => {}));
    render(<Operations />);

    const spinner = screen.getAllByRole('status').find(
      (el) => el.getAttribute('aria-busy') === 'true',
    );
    expect(spinner).toBeDefined();
  });

  it('renders cache stats after load', async () => {
    setupHappyPath();
    render(<Operations />);

    await waitFor(() => {
      expect(screen.getByText('4.2 MB')).toBeInTheDocument();
    });
    expect(screen.getByText('312')).toBeInTheDocument();
  });

  it('shows redis connected status', async () => {
    setupHappyPath();
    render(<Operations />);

    await waitFor(() => {
      expect(screen.getByText(/connected/i)).toBeInTheDocument();
    });
  });

  it('renders background jobs', async () => {
    setupHappyPath();
    render(<Operations />);

    await waitFor(() => {
      expect(screen.getByText('Email digest sender')).toBeInTheDocument();
    });
    expect(screen.getByText('Badge award checker')).toBeInTheDocument();
    expect(screen.queryByText('SERVER COPY MUST NOT RENDER')).not.toBeInTheDocument();
  });

  it('shows "never run" for a job with no last_run_at', async () => {
    setupHappyPath();
    render(<Operations />);

    await waitFor(() => {
      expect(screen.getByText(/never/i)).toBeInTheDocument();
    });
  });

  it('shows "no jobs" text when jobs list is empty', async () => {
    mockGetCacheStats.mockResolvedValue({ success: true, data: CACHE_DATA });
    mockGetJobs.mockResolvedValue({ success: true, data: [] });
    render(<Operations />);

    // i18n: operations.no_jobs = "No background jobs configured"
    await waitFor(() => {
      expect(screen.getByText(/no background jobs configured/i)).toBeInTheDocument();
    });
  });

  it('calls clearCache and refreshes stats on "Clear cache" press', async () => {
    setupHappyPath();
    mockClearCache.mockResolvedValue({ success: true });
    // Stats refresh after clear
    mockGetCacheStats.mockResolvedValue({ success: true, data: { ...CACHE_DATA, redis_keys_count: 0 } });

    render(<Operations />);

    // i18n: operations.clear_cache = "Clear tenant cache"
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /clear tenant cache/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /clear tenant cache/i }));

    await waitFor(() => {
      expect(mockClearCache).toHaveBeenCalledWith('tenant');
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when clearCache returns success=false', async () => {
    setupHappyPath();
    mockClearCache.mockResolvedValue({ success: false });

    render(<Operations />);

    // i18n: operations.clear_cache = "Clear tenant cache"
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /clear tenant cache/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /clear tenant cache/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('calls runJob with correct id when job run button pressed', async () => {
    setupHappyPath();
    mockRunJob.mockResolvedValue({ success: true });

    render(<Operations />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /run.*email digest sender/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /run.*email digest sender/i }));

    await waitFor(() => {
      expect(mockRunJob).toHaveBeenCalledWith('digest_emails');
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when runJob fails', async () => {
    setupHappyPath();
    mockRunJob.mockResolvedValue({ success: false });

    render(<Operations />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /run.*email digest sender/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /run.*email digest sender/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});
