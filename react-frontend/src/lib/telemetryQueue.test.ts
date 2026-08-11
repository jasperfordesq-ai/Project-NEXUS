// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 WHY THIS FILE EXISTS.
 *
 * The change that made crash reporting consent-free was only half true. The three
 * direct callers — `ErrorBoundary`, `FeatureErrorBoundary`, `main.tsx` — really did
 * become unconditional. But `logError()`, used at over a thousand call sites, and
 * every failed API response report through THIS queue, and the queue dropped
 * everything without analytics consent:
 *
 *   function enqueueSentryTask(task) { if (!hasAnalyticsConsent()) return; … }
 *   function flushPendingTasks() { … if (!hasAnalyticsConsent()) { pendingTasks.length = 0; … } }
 *
 * So the cookie banner promised "we always record anonymous fault reports" while,
 * for the large majority of faults, nothing was recorded. No test covered the
 * queue at all, which is why a green suite said nothing about it.
 *
 * These tests pin the split in BOTH directions: faults go out without consent,
 * analytics does not. One direction alone would pass just as happily if the split
 * were removed in the other.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockReadStoredConsent = vi.fn();
vi.mock('@/lib/cookieConsentStorage', () => ({
  readStoredConsent: () => mockReadStoredConsent(),
}));

const captureSentryException = vi.fn();
const captureSentryMessage = vi.fn();
const setSentryUser = vi.fn();
const addSentryBreadcrumb = vi.fn();
const captureApiCall = vi.fn();

vi.mock('@/lib/sentry', () => ({
  captureSentryException: (...args: unknown[]) => captureSentryException(...args),
  captureSentryMessage: (...args: unknown[]) => captureSentryMessage(...args),
  setSentryUser: (...args: unknown[]) => setSentryUser(...args),
  setSentryTenant: vi.fn(),
  addSentryBreadcrumb: (...args: unknown[]) => addSentryBreadcrumb(...args),
  captureApiCall: (...args: unknown[]) => captureApiCall(...args),
  captureAuthEvent: vi.fn(),
}));

/**
 * The queue defers work behind `setTimeout` + `requestIdleCallback` and a 45-second
 * delay. Fake timers plus a stubbed idle callback make the flush deterministic
 * rather than waiting three quarters of a minute.
 */
async function loadQueue() {
  vi.resetModules();
  vi.clearAllMocks();
  return import('./telemetryQueue');
}

async function flush() {
  // Drive the 45s delay, then the two rAF hops, then the idle callback.
  await vi.advanceTimersByTimeAsync(46_000);
  await vi.advanceTimersByTimeAsync(4_000);
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  // A page that is not an auth entry path — the queue deliberately refuses to
  // flush on /login and friends.
  Object.defineProperty(window, 'location', {
    value: { pathname: '/dashboard' },
    writable: true,
  });
  // requestIdleCallback is absent in jsdom; the queue falls back to setTimeout.
  delete (window as unknown as Record<string, unknown>).requestIdleCallback;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('faults are reported without analytics consent', () => {
  it('sends an exception when consent was never given', async () => {
    mockReadStoredConsent.mockReturnValue(null);
    const { queueSentryException } = await loadQueue();

    queueSentryException(new Error('boom'));
    await flush();

    expect(captureSentryException).toHaveBeenCalledTimes(1);
  });

  it('sends an exception when analytics was explicitly declined', async () => {
    mockReadStoredConsent.mockReturnValue({ analytics: false });
    const { queueSentryException } = await loadQueue();

    queueSentryException(new Error('boom'));
    await flush();

    expect(captureSentryException).toHaveBeenCalledTimes(1);
  });

  it('sends an error-level message without consent', async () => {
    // This is the path `logError()` takes when it has a message rather than an
    // Error object.
    mockReadStoredConsent.mockReturnValue({ analytics: false });
    const { queueSentryMessage } = await loadQueue();

    queueSentryMessage('request failed', 'error');
    await flush();

    expect(captureSentryMessage).toHaveBeenCalledTimes(1);
  });
});

describe('analytics is still withheld without consent', () => {
  it('does not send the member identity', async () => {
    mockReadStoredConsent.mockReturnValue({ analytics: false });
    const { queueSentryUser } = await loadQueue();

    queueSentryUser({ id: 7 } as Parameters<typeof queueSentryUser>[0]);
    await flush();

    expect(setSentryUser).not.toHaveBeenCalled();
  });

  it('does not send breadcrumbs or API-call timings', async () => {
    mockReadStoredConsent.mockReturnValue({ analytics: false });
    const { queueSentryBreadcrumb, queueSentryApiCall } = await loadQueue();

    queueSentryBreadcrumb('clicked', 'ui', {});
    queueSentryApiCall('GET', '/v2/listings', 200, 12);
    await flush();

    expect(addSentryBreadcrumb).not.toHaveBeenCalled();
    expect(captureApiCall).not.toHaveBeenCalled();
  });

  it('does not send a quieter-than-error message', async () => {
    // A warning is diagnostic colour, not a fault, so it carries no obligation to
    // be recorded for somebody who declined analytics.
    mockReadStoredConsent.mockReturnValue({ analytics: false });
    const { queueSentryMessage } = await loadQueue();

    queueSentryMessage('slow render', 'warning');
    await flush();

    expect(captureSentryMessage).not.toHaveBeenCalled();
  });

  it('sends everything once consent IS given', async () => {
    // The control. Without it, "analytics is withheld" would pass just as well if
    // the queue sent nothing at all, ever.
    mockReadStoredConsent.mockReturnValue({ analytics: true });
    const { queueSentryUser, queueSentryBreadcrumb, queueSentryException } = await loadQueue();

    queueSentryUser({ id: 7 } as Parameters<typeof queueSentryUser>[0]);
    queueSentryBreadcrumb('clicked', 'ui', {});
    queueSentryException(new Error('boom'));
    await flush();

    expect(setSentryUser).toHaveBeenCalledTimes(1);
    expect(addSentryBreadcrumb).toHaveBeenCalledTimes(1);
    expect(captureSentryException).toHaveBeenCalledTimes(1);
  });
});

describe('a full queue evicts analytics before faults', () => {
  it('keeps the exception when 100+ breadcrumbs pile up behind it', async () => {
    // A burst of breadcrumbs must not push the actual crash out of a bounded queue —
    // that would lose exactly the event the queue exists to deliver.
    mockReadStoredConsent.mockReturnValue({ analytics: true });
    const { queueSentryBreadcrumb, queueSentryException } = await loadQueue();

    queueSentryException(new Error('the one that matters'));
    for (let i = 0; i < 150; i += 1) {
      queueSentryBreadcrumb(`crumb ${i}`, 'ui', {});
    }
    await flush();

    expect(captureSentryException).toHaveBeenCalledTimes(1);
  });
});
