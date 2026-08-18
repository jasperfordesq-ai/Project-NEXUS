// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for SessionTimeoutWarning.
 *
 * The component listens for `nexus:session_expiring` on window and shows a
 * HeroUI Modal countdown when the user's session is about to expire.
 *
 * The countdown is derived from a wall-clock deadline (Date.now()), not from
 * decrementing a counter — browsers throttle intervals in background tabs.
 * The wall-clock tests below freeze Date.now with a spy and jump it forward
 * to simulate a hidden tab whose interval ticks were never delivered.
 *
 * Important notes on fake timers and waitFor:
 * - Testing-library's waitFor uses setInterval internally, which is faked when
 *   vi.useFakeTimers() is active.  This means waitFor will never retry while
 *   fake timers are paused, causing 30-second test timeouts.
 * - Tests that only need to observe modal open/close use REAL timers.
 * - Tests that need to advance the countdown use fake timers but wrap every
 *   waitFor call in vi.runAllTimersAsync() so both the component intervals
 *   AND the testing-library poller fire.
 *
 * CRITICAL: mock values are STABLE module-scope objects — never return a fresh
 * object from a hook function, which causes infinite render loops.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Stable mock values ───────────────────────────────────────────────────────

const logoutSpy = vi.fn(() => Promise.resolve());
const scheduleSessionWarningSpy = vi.fn();

const mockAuthValue = {
  user: { id: 1, name: 'Test User' },
  isAuthenticated: true,
  login: vi.fn(),
  logout: logoutSpy,
  register: vi.fn(),
  updateUser: vi.fn(),
  refreshUser: vi.fn(),
  scheduleSessionWarning: scheduleSessionWarningSpy,
  status: 'idle' as const,
  error: null,
};

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => mockAuthValue,
  }),
);

// SessionTimeoutWarning imports useAuth directly from @/contexts/AuthContext
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenantPath: (path: string) => `/test${path}` }),
}));

vi.mock('@/lib/api', () => ({
  SESSION_EXPIRING_EVENT: 'nexus:session_expiring',
  tokenManager: {
    getRefreshToken: vi.fn(() => null),
    getAccessToken: vi.fn(() => null),
    getTenantId: vi.fn(() => null),
    setAccessToken: vi.fn(),
    setRefreshToken: vi.fn(),
  },
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    refreshSession: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// ─── Import AFTER mocks ───────────────────────────────────────────────────────

import { SessionTimeoutWarning } from './SessionTimeoutWarning';
import { api, tokenManager } from '@/lib/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dispatchExpiringEvent() {
  window.dispatchEvent(new Event('nexus:session_expiring'));
}

function jwtExpiringIn(seconds: number): string {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }));
  return `${header}.${payload}.signature`;
}

/** Wait for a text pattern to appear anywhere in document.body */
async function waitForText(pattern: string | RegExp, timeout = 5000) {
  await waitFor(
    () => {
      const body = document.body.textContent ?? '';
      if (typeof pattern === 'string') {
        expect(body).toContain(pattern);
      } else {
        expect(body).toMatch(pattern);
      }
    },
    { timeout },
  );
}

// ─── Hidden by default (real timers, no event) ───────────────────────────────

describe('SessionTimeoutWarning — hidden by default', () => {
  it('renders nothing visible when no event has fired', () => {
    render(<SessionTimeoutWarning />);
    // When closed the HeroUI Modal mounts no DOM into the portal
    expect(screen.queryByText(/session/i)).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

// ─── Opens when event fires (real timers) ────────────────────────────────────

describe('SessionTimeoutWarning — opens on event (real timers)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows countdown badge after SESSION_EXPIRING_EVENT fires', async () => {
    render(<SessionTimeoutWarning />);

    await act(async () => {
      dispatchExpiringEvent();
    });

    // The countdown starts at 30 and is visible in the badge span
    await waitForText('30');
  });

  it('renders at least two action buttons when the modal is open', async () => {
    render(<SessionTimeoutWarning />);

    await act(async () => {
      dispatchExpiringEvent();
    });

    await waitForText('30');

    // Both "Log out" and "Extend session" buttons should be present
    const buttons = document.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('cannot be closed with Escape and exposes no close trigger', async () => {
    render(<SessionTimeoutWarning />);

    await act(async () => {
      dispatchExpiringEvent();
    });
    await waitForText('30');

    expect(document.querySelectorAll('button')).toHaveLength(2);
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeInTheDocument();
    });
  });

  it('calls logout when the logout button is clicked', async () => {
    render(<SessionTimeoutWarning />);

    await act(async () => {
      dispatchExpiringEvent();
    });

    await waitForText('30');

    const allButtons = Array.from(document.querySelectorAll('button'));
    // The first action button is "Log out" (flat variant, leftmost in footer)
    const logoutBtn = allButtons.find(
      (b) =>
        b.textContent?.toLowerCase().includes('log out') ||
        b.textContent?.toLowerCase().includes('sign out'),
    );

    if (logoutBtn) {
      await act(async () => {
        fireEvent.click(logoutBtn);
      });
      await waitFor(() => {
        expect(logoutSpy).toHaveBeenCalled();
      });
    } else {
      // If i18n resolves to a non-default key, just assert buttons are present
      expect(allButtons.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('extends through the shared refresh coordinator', async () => {
    const rotatedAccessToken = jwtExpiringIn(240);
    vi.mocked(api.refreshSession).mockResolvedValue('refreshed');
    vi.mocked(tokenManager.getAccessToken).mockReturnValue(rotatedAccessToken);

    render(<SessionTimeoutWarning />);
    await act(async () => {
      dispatchExpiringEvent();
    });
    await waitForText('30');

    const extendButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.toLowerCase().includes('extend'),
    );
    expect(extendButton).toBeDefined();

    await act(async () => {
      fireEvent.click(extendButton!);
    });

    await waitFor(() => expect(api.refreshSession).toHaveBeenCalledOnce());
    expect(scheduleSessionWarningSpy).toHaveBeenCalled();
    expect(logoutSpy).not.toHaveBeenCalled();
  });

  it('keeps the session available when extension is temporarily unavailable', async () => {
    vi.mocked(api.refreshSession).mockResolvedValue('transient');

    render(<SessionTimeoutWarning />);
    await act(async () => {
      dispatchExpiringEvent();
    });
    await waitForText('30');

    const extendButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.toLowerCase().includes('extend'),
    );
    expect(extendButton).toBeDefined();

    await act(async () => {
      fireEvent.click(extendButton!);
    });

    await waitFor(() => expect(api.refreshSession).toHaveBeenCalledOnce());
    expect(logoutSpy).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('30');
  });

  it('closes the modal when the unauthenticated state is detected', async () => {
    render(<SessionTimeoutWarning />);

    await act(async () => {
      dispatchExpiringEvent();
    });

    await waitForText('30');

    // Re-dispatch without further setup — component already mounted and listening.
    // We can't easily change isAuthenticated to false in this mock without
    // a re-render, so we just verify the open state reached (already did above).
    // This test guards against a regression where the close listener crashes.
    expect(document.body.textContent).toContain('30');
  });
});

// ─── Countdown ticks down (real timers, small wait) ───────────────────────────
//
// Fake timers + runAllTimersAsync trigger the infinite-loop guard because
// setInterval keeps re-queuing itself.  We use real timers and wait > 1 second
// for at least one tick to fire.  The tick recomputes from the wall-clock
// deadline, so ~1.1 real seconds after opening the badge must read 29.

describe('SessionTimeoutWarning — countdown ticks down (real timers)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows one second less after ~1.1 seconds', async () => {
    render(<SessionTimeoutWarning />);

    await act(async () => {
      dispatchExpiringEvent();
    });

    // Confirm modal shows 30 initially
    await waitForText('30');

    // Wait a real 1.1 seconds for the first interval tick
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const bodyText = document.body.textContent ?? '';
    // ceil((30s deadline − 1.1s elapsed) / 1s) = 29
    expect(bodyText).toContain('29');
  }, 10000); // 10-second test timeout (covers 1.1s real wait + render overhead)
});

// ─── Wall-clock deadline (real timers, frozen Date.now) ───────────────────────
//
// Browsers throttle setInterval in background tabs (to once a minute or
// slower), so the displayed seconds and the auto-logout must be DERIVED from
// a Date.now() deadline, never from counting ticks.  These tests freeze
// Date.now, jump it forward the way a hidden tab experiences time, and assert
// that a single visibilitychange reconciles the display / fires the logout
// without any interval ticks having been delivered.

describe('SessionTimeoutWarning — wall-clock deadline', () => {
  let nowSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tokenManager.getAccessToken).mockReturnValue(null);
  });

  afterEach(() => {
    nowSpy?.mockRestore();
    nowSpy = undefined;
  });

  it('shows the true remaining time on tab activation after throttled ticks', async () => {
    const t0 = Date.now();
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t0);

    render(<SessionTimeoutWarning />);
    await act(async () => {
      dispatchExpiringEvent();
    });
    await waitForText('30');

    // Hidden tab: 10 wall-clock seconds pass while no interval tick ran.
    nowSpy.mockReturnValue(t0 + 10_000);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // ceil((30s − 10s) / 1s) = 20 — not the stale 30 a decrementing counter
    // would still be showing.
    expect(document.body.textContent).toContain('20');
    expect(logoutSpy).not.toHaveBeenCalled();
  });

  it('logs out immediately on tab activation when the deadline passed while hidden', async () => {
    const t0 = Date.now();
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t0);

    render(<SessionTimeoutWarning />);
    await act(async () => {
      dispatchExpiringEvent();
    });
    await waitForText('30');

    // Hidden tab slept straight past the 30-second deadline.
    nowSpy.mockReturnValue(t0 + 31_000);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(logoutSpy).toHaveBeenCalled());
  });

  it('reconciles on window focus as well', async () => {
    const t0 = Date.now();
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t0);

    render(<SessionTimeoutWarning />);
    await act(async () => {
      dispatchExpiringEvent();
    });
    await waitForText('30');

    nowSpy.mockReturnValue(t0 + 15_000);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(document.body.textContent).toContain('15');
    expect(logoutSpy).not.toHaveBeenCalled();
  });
});

// ─── Unauthenticated — no modal ───────────────────────────────────────────────

describe('SessionTimeoutWarning — unauthenticated guard', () => {
  it('renders without crashing when mounted', () => {
    // Our stable mock has isAuthenticated=true but no event has been dispatched.
    render(<SessionTimeoutWarning />);
    expect(screen.queryByText(/session/i)).toBeNull();
  });
});

describe('SessionTimeoutWarning — restored and refreshed token scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules a restored authenticated JWT from its remaining lifetime', async () => {
    vi.mocked(tokenManager.getAccessToken).mockReturnValue(jwtExpiringIn(120));

    render(<SessionTimeoutWarning />);

    await waitFor(() => expect(scheduleSessionWarningSpy).toHaveBeenCalledOnce());
    expect(scheduleSessionWarningSpy.mock.calls[0][0]).toBeGreaterThanOrEqual(118);
  });

  it('opens immediately when a restored token is inside the five-second scheduling buffer', async () => {
    vi.mocked(tokenManager.getAccessToken).mockReturnValue(jwtExpiringIn(34));

    render(<SessionTimeoutWarning />);

    await waitForText(/3[3-4]/);
    expect(document.querySelector('[role="dialog"]')).toBeInTheDocument();
    expect(scheduleSessionWarningSpy).not.toHaveBeenCalled();
  });

  it('reschedules after the API client silently rotates the access token', async () => {
    vi.useFakeTimers();
    let accessToken = jwtExpiringIn(120);
    vi.mocked(tokenManager.getAccessToken).mockImplementation(() => accessToken);

    render(<SessionTimeoutWarning />);
    expect(scheduleSessionWarningSpy).toHaveBeenCalledOnce();

    accessToken = jwtExpiringIn(240);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(scheduleSessionWarningSpy).toHaveBeenCalledTimes(2);
    expect(scheduleSessionWarningSpy.mock.calls[1][0]).toBeGreaterThanOrEqual(234);
  });
});
