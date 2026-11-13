// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── hoisted mock data ────────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

const mockStatusHealthy = vi.hoisted(() => ({
  tripped: false,
  count_in_current_hour: 12,
  threshold: 100,
  auto_resume_in_seconds: null,
}));

const mockStatusTripped = vi.hoisted(() => ({
  tripped: true,
  count_in_current_hour: 100,
  threshold: 100,
  auto_resume_in_seconds: 3600,
}));

// ── mocks ────────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

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
import { RegistrationBreakerCard } from './RegistrationBreakerCard';

// ── helpers ──────────────────────────────────────────────────────────────────
function mockHealthyStatus() {
  vi.mocked(api.get).mockResolvedValue({
    success: true,
    data: mockStatusHealthy,
  } as never);
}

function mockTrippedStatus() {
  vi.mocked(api.get).mockResolvedValue({
    success: true,
    data: mockStatusTripped,
  } as never);
}

function mockFetchError() {
  vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
}

function mockFetchReturnsNoData() {
  vi.mocked(api.get).mockResolvedValue({
    success: false,
  } as never);
}

// ── tests ────────────────────────────────────────────────────────────────────
// NOTE: NEVER use vi.useFakeTimers with waitFor — they deadlock.
// Instead, spy on setInterval to prevent the 30s polling from running
// during tests (the interval callback is never invoked, which is correct
// since we don't want background polls during unit tests).
describe('RegistrationBreakerCard', () => {
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Prevent the 30s polling from auto-running — return a valid timer id
    setIntervalSpy = vi.spyOn(global, 'setInterval').mockReturnValue(99 as unknown as ReturnType<typeof setInterval>);
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
  });

  it('shows loading spinner on initial fetch', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<RegistrationBreakerCard />);

    const loadingEl = screen.queryAllByRole('status').find(
      el => el.getAttribute('aria-busy') === 'true'
    );
    expect(loadingEl).toBeInTheDocument();
  });

  it('renders nothing (null) when API returns no data', async () => {
    mockFetchReturnsNoData();
    const { container } = render(<RegistrationBreakerCard />);

    await waitFor(() => {
      // When status === null the component returns null — only ToastProvider
      // divs remain (from test-utils wrapper)
      expect(container.querySelector('[data-slot="card"]')).toBeNull();
    });
  });

  it('renders healthy status chip when breaker is not tripped', async () => {
    mockHealthyStatus();
    render(<RegistrationBreakerCard />);

    await waitFor(() => {
      // status_active chip (i18n key or real text)
      const chips = screen.getAllByText(/sign-ups open/i);
      expect(chips.length).toBeGreaterThan(0);
    });
  });

  it('does NOT show Resume Signups button when breaker is healthy', async () => {
    mockHealthyStatus();
    render(<RegistrationBreakerCard />);

    await waitFor(() => {
      // Card rendered (not loading)
      expect(screen.queryAllByRole('status').find(
        el => el.getAttribute('aria-busy') === 'true'
      )).toBeUndefined();
    });

    expect(screen.queryByRole('button', { name: /start sign-ups again/i })).not.toBeInTheDocument();
  });

  it('shows signups count text with threshold info', async () => {
    mockHealthyStatus();
    render(<RegistrationBreakerCard />);

    await waitFor(() => {
      // count_in_current_hour: 12, threshold: 100 — text contains both
      expect(screen.getByText(/12/)).toBeInTheDocument();
    });
    expect(screen.getByText(/100/)).toBeInTheDocument();
  });

  it('renders tripped/paused status when breaker is tripped', async () => {
    mockTrippedStatus();
    render(<RegistrationBreakerCard />);

    await waitFor(() => {
      const pausedChips = screen.getAllByText(/paused|status_paused/i);
      expect(pausedChips.length).toBeGreaterThan(0);
    });
  });

  it('shows Resume Signups button when breaker is tripped', async () => {
    mockTrippedStatus();
    render(<RegistrationBreakerCard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start sign-ups again/i })).toBeInTheDocument();
    });
  });

  it('calls POST resume-signups endpoint and shows success toast', async () => {
    mockTrippedStatus();
    vi.mocked(api.post).mockResolvedValue({ success: true } as never);
    // After resume, fetchStatus re-runs and returns healthy
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: mockStatusTripped } as never)
      .mockResolvedValueOnce({ success: true, data: mockStatusHealthy } as never);

    const user = userEvent.setup();
    render(<RegistrationBreakerCard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start sign-ups again/i })).toBeInTheDocument();
    });

    const resumeBtn = screen.getByRole('button', { name: /start sign-ups again/i });
    await user.click(resumeBtn);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/v2/admin/registration/resume-signups',
        {}
      );
    });
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when resume API fails', async () => {
    mockTrippedStatus();
    vi.mocked(api.post).mockResolvedValue({
      success: false,
      error: 'Permission denied',
    } as never);

    const user = userEvent.setup();
    render(<RegistrationBreakerCard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start sign-ups again/i })).toBeInTheDocument();
    });

    const resumeBtn = screen.getByRole('button', { name: /start sign-ups again/i });
    await user.click(resumeBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('refresh button re-fetches status', async () => {
    mockHealthyStatus();
    const user = userEvent.setup();
    render(<RegistrationBreakerCard />);

    await waitFor(() => {
      // Card is loaded and showing content (not loading)
      expect(screen.queryAllByRole('status').find(
        el => el.getAttribute('aria-busy') === 'true'
      )).toBeUndefined();
    });

    const callsBefore = vi.mocked(api.get).mock.calls.length;
    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    await user.click(refreshBtn);

    await waitFor(() => {
      expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('silent-fails (no toast) when initial fetch errors', async () => {
    // The component intentionally swallows fetch errors — surfaces as stale/missing data
    mockFetchError();
    render(<RegistrationBreakerCard />);

    // Wait for the load to complete (loading spinner disappears)
    await waitFor(() => {
      expect(screen.queryAllByRole('status').find(
        el => el.getAttribute('aria-busy') === 'true'
      )).toBeUndefined();
    });

    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('shows warning threshold percentage when ≥50% of threshold reached', async () => {
    // 60 out of 100 = 60% — above the 50% warning threshold
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { ...mockStatusHealthy, count_in_current_hour: 60, threshold: 100 },
    } as never);

    render(<RegistrationBreakerCard />);

    await waitFor(() => {
      // threshold_percent text rendered containing "60%"
      expect(screen.getByText(/60%/)).toBeInTheDocument();
    });
  });

  // Since 13 Nov 2026 the panel sits inside "Joining and signing in" on the
  // Settings page, where community admins see it: no card of its own, and no
  // server setting named at them.
  it('embedded: renders inside the Settings page without its own card or the server setting', async () => {
    mockHealthyStatus();
    render(<RegistrationBreakerCard embedded />);

    const panel = await screen.findByTestId('registration-breaker');
    expect(panel).toHaveTextContent('New sign-ups');
    expect(panel).toHaveTextContent('Sign-ups open');
    expect(panel).toHaveTextContent('12 of 100 new accounts this hour');
    expect(screen.queryByText(/REGISTRATION_TENANT_HOURLY_CAP/)).toBeNull();
  });

  it('embedded: a paused community gets the plain explanation and the button to start again', async () => {
    mockTrippedStatus();
    render(<RegistrationBreakerCard embedded />);

    expect(await screen.findByRole('button', { name: /start sign-ups again/i })).toBeInTheDocument();
    expect(screen.getByText("New accounts can't be created right now.")).toBeInTheDocument();
    expect(screen.queryByText(/sentry/i)).toBeNull();
  });

  it('does NOT show threshold percentage warning when below 50%', async () => {
    // 12/100 = 12% — below the 50% warning threshold
    mockHealthyStatus();
    render(<RegistrationBreakerCard />);

    await waitFor(() => {
      // Card loaded (no longer loading)
      expect(screen.getByText(/12/)).toBeInTheDocument();
    });

    expect(screen.queryByText(/12%/)).not.toBeInTheDocument();
  });
});
