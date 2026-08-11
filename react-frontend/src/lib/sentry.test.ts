// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidElement } from 'react';

// Mock Sentry and consent storage before importing sentry.ts.
vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureFeedback: vi.fn(),
  captureMessage: vi.fn(),
  startInactiveSpan: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({})),
  feedbackIntegration: vi.fn(() => ({ name: 'Feedback' })),
  replayIntegration: vi.fn(() => ({ name: 'Replay' })),
  ErrorBoundary: vi.fn(),
  withProfiler: vi.fn((fn) => fn),
}));

vi.mock('@/lib/cookieConsentStorage', () => ({
  readStoredConsent: vi.fn(),
}));

import { readStoredConsent } from '@/lib/cookieConsentStorage';
const mockReadStoredConsent = readStoredConsent as ReturnType<typeof vi.fn>;

describe('sentry (disabled - no DSN)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_SENTRY_DSN', '');
    // No VITE_SENTRY_DSN set — Sentry is disabled
    mockReadStoredConsent.mockReturnValue({ analytics: true });
  });

  it('initSentry is a callable function', async () => {
    const { initSentry } = await import('./sentry');
    expect(typeof initSentry).toBe('function');
    // Should not throw even without DSN
    expect(() => initSentry()).not.toThrow();
  });

  it('setSentryUser is a no-op when disabled', async () => {
    const { setSentryUser } = await import('./sentry');
    const Sentry = await import('@sentry/react');
    expect(() => setSentryUser({ id: 1, name: 'Alice', email: 'alice@test.com' } as Parameters<typeof setSentryUser>[0])).not.toThrow();
    // Sentry.setUser should NOT be called since DSN is missing
    expect(Sentry.setUser).not.toHaveBeenCalled();
  });

  it('setSentryTenant is a no-op when disabled', async () => {
    const { setSentryTenant } = await import('./sentry');
    const Sentry = await import('@sentry/react');
    expect(() => setSentryTenant({ id: 1, name: 'Test Bank', slug: 'test' })).not.toThrow();
    expect(Sentry.setTag).not.toHaveBeenCalled();
  });

  it('captureSentryException is a no-op when disabled', async () => {
    const { captureSentryException } = await import('./sentry');
    const Sentry = await import('@sentry/react');
    expect(() => captureSentryException(new Error('Test error'))).not.toThrow();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('captureSentryMessage is a no-op when disabled', async () => {
    const { captureSentryMessage } = await import('./sentry');
    const Sentry = await import('@sentry/react');
    expect(captureSentryMessage('test message')).toBeNull();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('addSentryBreadcrumb is a no-op when disabled', async () => {
    const { addSentryBreadcrumb } = await import('./sentry');
    const Sentry = await import('@sentry/react');
    expect(() => addSentryBreadcrumb('Navigation event', 'nav')).not.toThrow();
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
  });

  it('captureNavigation is a no-op when disabled', async () => {
    const { captureNavigation } = await import('./sentry');
    expect(() => captureNavigation('/home', '/feed')).not.toThrow();
  });

  it('captureApiCall is a no-op when disabled', async () => {
    const { captureApiCall } = await import('./sentry');
    expect(() => captureApiCall('GET', '/v2/users', 200, 120)).not.toThrow();
  });

  it('captureAuthEvent is a no-op when disabled', async () => {
    const { captureAuthEvent } = await import('./sentry');
    expect(() => captureAuthEvent('login', 1)).not.toThrow();
  });

  it('startSentrySpan returns undefined when disabled', async () => {
    const { startSentrySpan } = await import('./sentry');
    const result = startSentrySpan('my-span');
    expect(result).toBeUndefined();
  });

  it('SentryErrorBoundary uses the local crash boundary even when the SDK is disabled', async () => {
    const { SentryErrorBoundary } = await import('./sentry');
    const children = 'test-children';
    const result = SentryErrorBoundary({ children });
    expect(isValidElement(result)).toBe(true);
  });
});

describe('sentry analytics consent checks', () => {
  it('defers SDK initialization until after first paint and idle time', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.sentry.io/1');
    mockReadStoredConsent.mockReturnValue({ analytics: true });
    const Sentry = await import('@sentry/react');
    vi.clearAllMocks();

    const animationCallbacks: FrameRequestCallback[] = [];
    const idleCallbacks: IdleRequestCallback[] = [];
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: (() => 0) as typeof window.requestIdleCallback,
    });
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationCallbacks.push(callback);
      return animationCallbacks.length;
    });
    const idleSpy = vi.spyOn(window, 'requestIdleCallback').mockImplementation((callback) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    });

    const { initSentryAfterIdle } = await import('./sentry');
    initSentryAfterIdle();

    expect(Sentry.init).not.toHaveBeenCalled();
    expect(animationCallbacks).toHaveLength(1);

    animationCallbacks.shift()?.(0);
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(animationCallbacks).toHaveLength(1);

    animationCallbacks.shift()?.(16);
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(idleCallbacks).toHaveLength(1);

    idleCallbacks.shift()?.({
      didTimeout: false,
      timeRemaining: () => 10,
    });

    await vi.waitFor(() => expect(Sentry.init).toHaveBeenCalled());

    rafSpy.mockRestore();
    idleSpy.mockRestore();
    vi.useRealTimers();
  });

  it('queues context and breadcrumbs without touching the SDK before idle initialization', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.sentry.io/1');
    mockReadStoredConsent.mockReturnValue({ analytics: true });
    const Sentry = await import('@sentry/react');
    vi.clearAllMocks();

    const animationCallbacks: FrameRequestCallback[] = [];
    const idleCallbacks: IdleRequestCallback[] = [];
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: (() => 0) as typeof window.requestIdleCallback,
    });
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationCallbacks.push(callback);
      return animationCallbacks.length;
    });
    const idleSpy = vi.spyOn(window, 'requestIdleCallback').mockImplementation((callback) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    });

    const {
      initSentryAfterIdle,
      setSentryUser,
      setSentryTenant,
      addSentryBreadcrumb,
    } = await import('./sentry');

    setSentryUser({ id: 42, name: 'Alice', email: 'alice@test.com' } as Parameters<typeof setSentryUser>[0]);
    setSentryTenant({ id: 7, name: 'Hour Timebank', slug: 'hour-timebank' });
    addSentryBreadcrumb('bootstrapped tenant', 'tenant', { slug: 'hour-timebank' });

    expect(Sentry.setUser).not.toHaveBeenCalled();
    expect(Sentry.setTag).not.toHaveBeenCalled();
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();

    initSentryAfterIdle();
    animationCallbacks.shift()?.(0);
    animationCallbacks.shift()?.(16);
    idleCallbacks.shift()?.({
      didTimeout: false,
      timeRemaining: () => 10,
    });

    await vi.waitFor(() => expect(Sentry.init).toHaveBeenCalled());
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: '42' });
    expect(Sentry.setTag).toHaveBeenCalledWith('tenant_slug', 'hour-timebank');
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({
      message: 'bootstrapped tenant',
      category: 'tenant',
    }));

    rafSpy.mockRestore();
    idleSpy.mockRestore();
    vi.useRealTimers();
  });

  /**
   * 🔴 The two tests these replaced were named "is disabled when no consent
   * stored" / "...when analytics consent is false" and asserted only
   * `expect(() => initSentry()).not.toThrow()`. They never checked that anything
   * was disabled, so they passed identically before and after the consent model
   * changed — pinning nothing at all. The consent split is a privacy contract and
   * has to be asserted in both directions.
   */
  it('reports crashes even without analytics consent — that is the point', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.sentry.io/1');
    mockReadStoredConsent.mockReturnValue(null);
    const Sentry = await import('@sentry/react');
    vi.clearAllMocks();

    const { initSentry, captureSentryException } = await import('./sentry');
    initSentry();
    await vi.waitFor(() => expect(Sentry.init).toHaveBeenCalled());

    captureSentryException(new Error('safari only boom'));
    // captureSentryException resolves the SDK lazily (`loadSentry().then(...)`),
    // so the dispatch is not synchronous.
    await vi.waitFor(() => expect(Sentry.captureException).toHaveBeenCalled());
  });

  it('withholds the member identity without analytics consent', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.sentry.io/1');
    mockReadStoredConsent.mockReturnValue({ analytics: false });
    const Sentry = await import('@sentry/react');
    vi.clearAllMocks();

    const { initSentry, setSentryUser } = await import('./sentry');
    initSentry();
    await vi.waitFor(() => expect(Sentry.init).toHaveBeenCalled());

    setSentryUser({ id: 4242 } as Parameters<typeof setSentryUser>[0]);
    await vi.waitFor(() => expect(Sentry.setUser).toHaveBeenCalled());
    // Reported, but not attributed to anybody.
    expect(Sentry.setUser).toHaveBeenLastCalledWith(null);
  });

  it('attaches the member id once analytics consent is given', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.sentry.io/1');
    mockReadStoredConsent.mockReturnValue({ analytics: true });
    const Sentry = await import('@sentry/react');
    vi.clearAllMocks();

    const { initSentry, setSentryUser } = await import('./sentry');
    initSentry();
    await vi.waitFor(() => expect(Sentry.init).toHaveBeenCalled());

    setSentryUser({ id: 4242 } as Parameters<typeof setSentryUser>[0]);
    await vi.waitFor(() =>
      expect(Sentry.setUser).toHaveBeenLastCalledWith({ id: '4242' }),
    );
  });

  it('does not trace performance without analytics consent', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.sentry.io/1');
    vi.stubEnv('VITE_SENTRY_TRACES_SAMPLE_RATE', '1');
    mockReadStoredConsent.mockReturnValue({ analytics: false });
    const Sentry = await import('@sentry/react');
    vi.clearAllMocks();

    const { initSentry } = await import('./sentry');
    initSentry();
    await vi.waitFor(() => expect(Sentry.init).toHaveBeenCalled());

    // Not merely sampled to zero — the integration must not be registered.
    expect(Sentry.browserTracingIntegration).not.toHaveBeenCalled();
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: 0 }),
    );
  });

  it('does not record the screen without analytics consent', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.sentry.io/1');
    // Replay explicitly enabled by env, and still refused without consent.
    vi.stubEnv('VITE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE', '1');
    mockReadStoredConsent.mockReturnValue({ analytics: false });
    const Sentry = await import('@sentry/react');
    vi.clearAllMocks();

    const { initSentry } = await import('./sentry');
    initSentry();
    await vi.waitFor(() => expect(Sentry.init).toHaveBeenCalled());

    expect(Sentry.replayIntegration).not.toHaveBeenCalled();
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ replaysOnErrorSampleRate: 0 }),
    );
  });

  /**
   * 🔴 Scrubbing became load-bearing the moment faults started being sent WITHOUT
   * analytics consent. Before that, a member who declined sent nothing at all, so a
   * gap in `beforeSend` was latent. It is not any more.
   *
   * Only POST bodies were filtered. Request URLs, query strings, headers and
   * breadcrumbs were not — and `sendDefaultPii: false` covers none of them.
   */
  describe('beforeSend scrubbing (what rides along on an unconsented fault)', () => {
    async function getHooks() {
      vi.resetModules();
      vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.sentry.io/1');
      mockReadStoredConsent.mockReturnValue(null);
      const Sentry = await import('@sentry/react');
      vi.clearAllMocks();

      const { initSentry } = await import('./sentry');
      initSentry();
      await vi.waitFor(() => expect(Sentry.init).toHaveBeenCalled());

      const calls = (Sentry.init as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      // Indexing a mock's calls is `T | undefined` under strict TS, and the
      // test-type gate is shrink-only — so assert the call exists rather than
      // suppressing it.
      const firstCall = calls[0];
      expect(firstCall).toBeDefined();

      return firstCall![0] as {
        beforeSend: (e: Record<string, unknown>) => Record<string, unknown>;
        beforeBreadcrumb: (b: Record<string, unknown>) => Record<string, unknown> | null;
      };
    }

    it('drops the query string from the request URL, keeping the path', async () => {
      const { beforeSend } = await getHooks();

      const event = beforeSend({
        request: { url: 'https://app.example.ie/reset-password?token=SECRET123' },
      });

      const url = (event.request as { url: string }).url;
      expect(url).toBe('https://app.example.ie/reset-password');
      expect(url).not.toContain('SECRET123');
    });

    it('removes query_string, cookies and credential headers', async () => {
      const { beforeSend } = await getHooks();

      const event = beforeSend({
        request: {
          url: 'https://app.example.ie/search',
          query_string: 'q=something+the+member+typed',
          cookies: { token: 'abc' },
          headers: {
            Cookie: 'session=abc',
            Authorization: 'Bearer abc',
            'X-CSRF-Token': 'abc',
            'User-Agent': 'kept',
          },
        },
      });

      const request = event.request as Record<string, unknown>;
      expect(request.query_string).toBeUndefined();
      expect(request.cookies).toBeUndefined();
      const headers = request.headers as Record<string, unknown>;
      expect(headers.Cookie).toBeUndefined();
      expect(headers.Authorization).toBeUndefined();
      expect(headers['X-CSRF-Token']).toBeUndefined();
      // Diagnostics that are not credentials survive.
      expect(headers['User-Agent']).toBe('kept');
    });

    it('still filters sensitive POST body fields', async () => {
      const { beforeSend } = await getHooks();

      const event = beforeSend({
        request: { data: { email: 'someone@example.ie', password: 'hunter2', keep: 'yes' } },
      });

      const data = (event.request as { data: Record<string, unknown> }).data;
      expect(data.password).toBe('[FILTERED]');
      expect(data.email).toBe('[FILTERED]');
      expect(data.keep).toBe('yes');
    });

    it('strips query strings from auto-captured fetch breadcrumbs', async () => {
      const { beforeBreadcrumb } = await getHooks();

      const crumb = beforeBreadcrumb({
        category: 'fetch',
        message: 'GET /api/v2/search?q=private+search+term',
        data: { url: 'https://api.example.ie/v2/search?q=private+search+term' },
      });

      expect(JSON.stringify(crumb)).not.toContain('private');
      expect((crumb?.data as { url: string }).url).toBe('https://api.example.ie/v2/search');
    });

    it('strips query strings from navigation breadcrumbs attached to the event', async () => {
      const { beforeSend } = await getHooks();

      const event = beforeSend({
        breadcrumbs: [
          { category: 'navigation', data: { from: '/a?token=X1', to: '/b?invite=Y2' } },
        ],
      });

      expect(JSON.stringify(event.breadcrumbs)).not.toContain('X1');
      expect(JSON.stringify(event.breadcrumbs)).not.toContain('Y2');
    });

    it('leaves a console debug breadcrumb dropped, as before', async () => {
      const { beforeBreadcrumb } = await getHooks();
      expect(beforeBreadcrumb({ category: 'console', level: 'debug' })).toBeNull();
    });
  });

  it('stays fully off when no DSN is configured, consent or not', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SENTRY_DSN', '');
    mockReadStoredConsent.mockReturnValue({ analytics: true });
    const Sentry = await import('@sentry/react');
    vi.clearAllMocks();

    const { initSentry, captureSentryException } = await import('./sentry');
    initSentry();
    captureSentryException(new Error('should go nowhere'));

    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('returns the Sentry event id for captured messages when enabled', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.sentry.io/1');
    mockReadStoredConsent.mockReturnValue({ analytics: true });
    const Sentry = await import('@sentry/react');
    vi.clearAllMocks();
    vi.mocked(Sentry.captureMessage).mockReturnValue('event-id-123');

    const { initSentry, captureSentryMessage } = await import('./sentry');
    initSentry();
    await vi.waitFor(() => expect(Sentry.init).toHaveBeenCalled());

    const eventId = captureSentryMessage('Support report submitted', 'info', {
      route: '/messages',
    });

    expect(eventId).toBe('event-id-123');
    expect(Sentry.captureMessage).toHaveBeenCalledWith('Support report submitted', expect.objectContaining({
      level: 'info',
      contexts: { additional: { route: '/messages' } },
    }));
  });

  it('registers Sentry user feedback without auto-injecting the Sentry widget', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.sentry.io/1');
    mockReadStoredConsent.mockReturnValue({ analytics: true });
    const Sentry = await import('@sentry/react');
    vi.clearAllMocks();

    const { initSentry } = await import('./sentry');
    initSentry();
    await vi.waitFor(() => expect(Sentry.init).toHaveBeenCalled());

    expect(Sentry.feedbackIntegration).toHaveBeenCalledWith(expect.objectContaining({
      colorScheme: 'system',
      autoInject: false,
    }));
    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({
      sendDefaultPii: false,
      integrations: expect.arrayContaining([
        expect.objectContaining({ name: 'Feedback' }),
      ]),
    }));
  });

  it('sends user feedback when enabled by consent and DSN', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.sentry.io/1');
    mockReadStoredConsent.mockReturnValue({ analytics: true });
    const Sentry = await import('@sentry/react');
    vi.clearAllMocks();
    vi.mocked(Sentry.captureFeedback).mockReturnValue('feedback-id-123');

    const { initSentry, captureSentryFeedback } = await import('./sentry');
    initSentry();
    await vi.waitFor(() => expect(Sentry.init).toHaveBeenCalled());

    const feedbackId = captureSentryFeedback({
      message: 'NXR-260527-RAASDS: Checkout button does not respond',
      source: 'support_report',
      associatedEventId: 'event-id-123',
      tags: {
        support_report_reference: 'NXR-260527-RAASDS',
        impact: 'major',
      },
    });

    expect(feedbackId).toBe('feedback-id-123');
    expect(Sentry.captureFeedback).toHaveBeenCalledWith(expect.objectContaining({
      message: 'NXR-260527-RAASDS: Checkout button does not respond',
      source: 'support_report',
      associatedEventId: 'event-id-123',
      tags: expect.objectContaining({
        support_report_reference: 'NXR-260527-RAASDS',
        impact: 'major',
      }),
    }), expect.objectContaining({ includeReplay: false }));
  });

  it('adds masked on-error replay only when the explicit env sample rate is set', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.sentry.io/1');
    vi.stubEnv('VITE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE', '1');
    mockReadStoredConsent.mockReturnValue({ analytics: true });
    const Sentry = await import('@sentry/react');
    vi.clearAllMocks();

    const { initSentry } = await import('./sentry');
    initSentry();
    await vi.waitFor(() => expect(Sentry.init).toHaveBeenCalled());

    expect(Sentry.replayIntegration).toHaveBeenCalledWith(expect.objectContaining({
      maskAllText: true,
      blockAllMedia: true,
    }));
    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1,
    }));
  });
});
