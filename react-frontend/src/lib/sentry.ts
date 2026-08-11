// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Sentry Error Tracking - React Frontend
 *
 * This wrapper deliberately avoids a static @sentry/react import. Public routes
 * import these helpers for breadcrumbs and error capture, so loading the SDK at
 * module evaluation time would put Sentry in the startup bundle before it is
 * needed. The dynamic import keeps it out of the startup graph.
 *
 * 🔴 CONSENT MODEL — changed 2026-08-11 by owner decision. Read this before
 * touching `checkEnabled()`.
 *
 * Crash reporting used to require ANALYTICS consent, so one click on "Essential
 * only" meant the platform never learned that anything had broken for that
 * member. The consequence was measured, not theoretical: **2 frontend errors in
 * 14 days across 369 members**, and a coordinator who hit real faults over three
 * days generated NO client-side record at all. We were blind to exactly the
 * people careful enough to decline optional cookies.
 *
 * The split is now:
 *
 *   ALWAYS ON — the error report itself: exception, stack, browser, OS, release.
 *   Knowing our own software is broken is not tracking the person who found it.
 *   `sendDefaultPii` stays false and `beforeSend` still scrubs sensitive fields.
 *
 *   ANALYTICS CONSENT ONLY — everything that goes beyond "it broke":
 *     - the member's user id (pseudonymous, but it is still identifying them)
 *     - performance tracing
 *     - session replay, which records the screen
 *
 * So without consent we learn that a crash happened and where in the code, but
 * not who it happened to. That is enough to find a Safari-only fault, which is
 * what this change was for. Do not quietly widen it.
 */

import { Component, createElement } from 'react';
import { readStoredConsent } from '@/lib/cookieConsentStorage';
import type { User } from '@/types';
import type { ComponentType, ErrorInfo, ReactElement, ReactNode } from 'react';

interface TenantInfo {
  id: number;
  name: string;
  slug: string;
}

type SeverityLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';
type SentryModule = typeof import('@sentry/react');
type SentrySpan = ReturnType<SentryModule['startInactiveSpan']>;

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const REPLAY_ON_ERROR_SAMPLE_RATE = Number.parseFloat(
  (import.meta.env.VITE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE as string | undefined) || '0',
);

/**
 * Whether to report crashes at all. A configured DSN is the only requirement —
 * see the consent model in the module docblock.
 */
function checkEnabled(): boolean {
  return Boolean(DSN);
}

/**
 * Gates the parts that go beyond "something broke": the member's user id,
 * performance tracing, and session replay.
 */
function hasAnalyticsConsent(): boolean {
  return readStoredConsent()?.analytics === true;
}

let IS_ENABLED = checkEnabled();
let sentryModule: SentryModule | null = null;
let sentryLoading: Promise<SentryModule | null> | null = null;
let hasInitialized = false;
let idleInitHandle: number | null = null;
let pendingUser: User | null | undefined;
let pendingTenant: TenantInfo | null | undefined;
const pendingBreadcrumbs: Array<{
  message: string;
  category: string;
  data: Record<string, unknown>;
  level: SeverityLevel;
}> = [];
const MAX_PENDING_BREADCRUMBS = 25;

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function getReplayOnErrorSampleRate(): number {
  return Number.isFinite(REPLAY_ON_ERROR_SAMPLE_RATE)
    ? Math.max(0, Math.min(1, REPLAY_ON_ERROR_SAMPLE_RATE))
    : 0;
}

/**
 * Keep the path, drop the query string.
 *
 * A path tells us which page failed, which is the whole point of a fault report. A
 * query string is member input — a reset token, a search term, an invite code — and
 * must never leave the browser attached to diagnostics.
 *
 * Deliberately string-based rather than `new URL()`: breadcrumb URLs are sometimes
 * relative, and `new URL()` throws on those.
 */
export function stripQueryString(value: string): string {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

/** Applies stripQueryString to every URL-shaped field a breadcrumb can carry. */
function scrubBreadcrumbUrls(crumb: Record<string, unknown> | null | undefined): void {
  if (!crumb) return;

  if (typeof crumb.message === 'string' && crumb.message.includes('?')) {
    // fetch/XHR breadcrumbs put the URL in the message, e.g. "GET /search?q=…".
    crumb.message = crumb.message.replace(/(https?:\/\/[^\s?#]+|\/[^\s?#]*)[?#][^\s]*/g, '$1');
  }

  const data = crumb.data as Record<string, unknown> | undefined;
  if (data) {
    for (const key of ['url', 'to', 'from']) {
      if (typeof data[key] === 'string') {
        data[key] = stripQueryString(data[key] as string);
      }
    }
  }
}

function sensitiveFields(): string[] {
  return [
    'password',
    'password_confirmation',
    'current_password',
    'token',
    'api_key',
    'secret',
    'csrf_token',
    'email',
    'phone',
    'credit_card',
    'card_number',
    'cvv',
    'refresh_token',
    'access_token',
  ];
}

function applySentryUser(Sentry: SentryModule, user: User | null): void {
  // Only the id, never email — but an id still identifies the member, so it is
  // attached only with analytics consent. Without it a crash is still reported,
  // just not tied to a person: enough to find the fault, not enough to profile
  // whoever hit it. See the consent model in the module docblock.
  if (!hasAnalyticsConsent()) {
    Sentry.setUser(null);
    return;
  }

  Sentry.setUser(user ? { id: String(user.id) } : null);
}

function applySentryTenant(Sentry: SentryModule, tenant: TenantInfo | null): void {
  if (!tenant) {
    Sentry.setContext('tenant', null);
    return;
  }

  Sentry.setTag('tenant_id', String(tenant.id));
  Sentry.setTag('tenant_name', tenant.name);
  Sentry.setTag('tenant_slug', tenant.slug);
  Sentry.setContext('tenant', {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
  });
}

function flushPendingTelemetry(Sentry: SentryModule): void {
  if (pendingUser !== undefined) {
    applySentryUser(Sentry, pendingUser);
    pendingUser = undefined;
  }

  if (pendingTenant !== undefined) {
    applySentryTenant(Sentry, pendingTenant);
    pendingTenant = undefined;
  }

  for (const breadcrumb of pendingBreadcrumbs.splice(0)) {
    Sentry.addBreadcrumb(breadcrumb);
  }
}

async function loadSentry(): Promise<SentryModule | null> {
  if (!IS_ENABLED) return null;
  if (sentryModule) return sentryModule;
  if (sentryLoading) return sentryLoading;

  sentryLoading = import('@sentry/react')
    .then((mod) => {
      sentryModule = mod;
      return mod;
    })
    .catch(() => null)
    .finally(() => {
      sentryLoading = null;
    });

  return sentryLoading;
}

async function loadAndInitializeSentry(): Promise<void> {
  const Sentry = await loadSentry();
  if (!Sentry || hasInitialized || !IS_ENABLED) return;

  // Everything beyond the crash report itself requires analytics consent.
  const analyticsAllowed = hasAnalyticsConsent();
  const replayOnErrorSampleRate = analyticsAllowed ? getReplayOnErrorSampleRate() : 0;

  const integrations: unknown[] = [
    Sentry.feedbackIntegration({
      colorScheme: 'system',
      autoInject: false,
    }),
  ];

  // Performance tracing measures how a member moves through the app, so it is
  // analytics rather than "did it break". Without consent the integration is not
  // registered at all, not merely sampled at zero.
  if (analyticsAllowed) {
    integrations.push(Sentry.browserTracingIntegration());
  }

  // Session replay records the screen. Consent-only, unconditionally.
  if (replayOnErrorSampleRate > 0) {
    integrations.push(Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }));
  }

  Sentry.init({
    dsn: DSN,
    environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string) || 'production',
    release: `nexus-react@${__BUILD_COMMIT__}`,
    sampleRate: 1.0,
    tracesSampleRate: analyticsAllowed
      ? parseFloat((import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE as string) || '0.1')
      : 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: replayOnErrorSampleRate,
    maxBreadcrumbs: 50,
    sendDefaultPii: false,
    ignoreErrors: [
      // Capacitor Android WebView bridge teardown race: the native
      // @JavascriptInterface object is garbage-collected mid-call when the
      // Activity/WebView is destroyed (app backgrounded, deep-link navigation).
      // Benign platform noise, not our code (Sentry React 127174715).
      /Java object is gone/,
      /Error invoking postMessage/,
    ],
    integrations: integrations as Parameters<SentryModule['init']>[0]['integrations'],
    // 🔴 SCRUBBING IS NOW LOAD-BEARING, because fault reports are sent WITHOUT
    // analytics consent. Before that, a member who declined sent nothing at all, so
    // gaps here were latent. They are not any more.
    //
    // What was missing and is now handled: the request URL and its query string,
    // request headers, and breadcrumbs. `sendDefaultPii: false` does NOT cover any
    // of those — it only stops the SDK attaching the user's IP and similar. Only
    // POST bodies were being filtered.
    //
    // The concrete leak: a member declines analytics, is on
    // `/reset-password?token=…` or `/search?q=<something they typed>`, and any
    // throw sent that URL to Sentry. web-uk's own scrubber
    // (`web-uk/src/lib/sentry.js`) already did this properly; this side did not.
    beforeSend(event) {
      if (event.request?.data && typeof event.request.data === 'object') {
        const data = event.request.data as Record<string, unknown>;
        for (const field of sensitiveFields()) {
          if (field in data) {
            data[field] = '[FILTERED]';
          }
        }
      }

      if (event.request) {
        // A path is diagnostic; a query string is member input. Keep the first,
        // drop the second — a reset token, a search term, an invite code all live
        // there.
        if (typeof event.request.url === 'string') {
          event.request.url = stripQueryString(event.request.url);
        }
        delete event.request.query_string;
        delete event.request.cookies;
        if (event.request.headers) {
          const headers = event.request.headers as Record<string, unknown>;
          for (const name of Object.keys(headers)) {
            const lower = name.toLowerCase();
            if (lower === 'cookie' || lower === 'authorization' || lower === 'x-csrf-token') {
              delete headers[name];
            }
          }
        }
      }

      // Breadcrumbs are auto-captured from fetch/XHR and DOM clicks, so they carry
      // the same URLs. beforeBreadcrumb below strips them as they are recorded, but
      // a breadcrumb can also be attached to the event directly.
      if (Array.isArray(event.breadcrumbs)) {
        for (const crumb of event.breadcrumbs) {
          scrubBreadcrumbUrls(crumb as Record<string, unknown>);
        }
      }

      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'console' && breadcrumb.level === 'debug') {
        return null;
      }
      scrubBreadcrumbUrls(breadcrumb as unknown as Record<string, unknown>);
      return breadcrumb;
    },
  });

  hasInitialized = true;
  Sentry.setTag('platform', 'react');
  Sentry.setTag('app_component', 'frontend');
  Sentry.setTag('build_commit', __BUILD_COMMIT__);
  Sentry.setTag('build_time', __BUILD_TIME__);
  flushPendingTelemetry(Sentry);
}

export function initSentry(): void {
  IS_ENABLED = checkEnabled();
  if (!IS_ENABLED) return;
  void loadAndInitializeSentry();
}

export function initSentryAfterIdle(): void {
  IS_ENABLED = checkEnabled();
  if (!IS_ENABLED || hasInitialized || idleInitHandle !== null) return;

  const scheduleAfterFirstPaint = () => {
    const idleWindow = window as IdleWindow;
    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleInitHandle = idleWindow.requestIdleCallback(() => {
        idleInitHandle = null;
        initSentry();
      }, { timeout: 5000 });
      return;
    }

    idleInitHandle = window.setTimeout(() => {
      idleInitHandle = null;
      initSentry();
    }, 3000);
  };

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(scheduleAfterFirstPaint);
  });
}

export function setSentryUser(user: User | null): void {
  if (!IS_ENABLED) return;
  if (!hasInitialized) {
    pendingUser = user;
    return;
  }

  void loadSentry().then((Sentry) => {
    if (!Sentry) return;
    applySentryUser(Sentry, user);
  });
}

export function setSentryTenant(tenant: TenantInfo | null): void {
  if (!IS_ENABLED) return;
  if (!hasInitialized) {
    pendingTenant = tenant;
    return;
  }

  void loadSentry().then((Sentry) => {
    if (!Sentry) return;
    applySentryTenant(Sentry, tenant);
  });
}

export function addSentryBreadcrumb(
  message: string,
  category: string = 'default',
  data: Record<string, unknown> = {},
  level: SeverityLevel = 'info',
): void {
  if (!IS_ENABLED) return;
  if (!hasInitialized) {
    pendingBreadcrumbs.push({ message, category, data, level });
    if (pendingBreadcrumbs.length > MAX_PENDING_BREADCRUMBS) {
      pendingBreadcrumbs.shift();
    }
    return;
  }

  void loadSentry().then((Sentry) => {
    Sentry?.addBreadcrumb({ message, category, data, level });
  });
}

export function captureSentryException(error: Error, context?: Record<string, unknown>): void {
  if (!IS_ENABLED) return;
  void loadSentry().then((Sentry) => {
    Sentry?.captureException(error, {
      contexts: context ? { additional: context } : undefined,
    });
  });
}

export function captureSentryMessage(
  message: string,
  level: SeverityLevel = 'error',
  context?: Record<string, unknown>,
): string | null {
  if (!IS_ENABLED || !sentryModule) return null;

  return sentryModule.captureMessage(message, {
    level,
    contexts: context ? { additional: context } : undefined,
  });
}

export function captureSentryFeedback(params: {
  message: string;
  source?: string;
  associatedEventId?: string | null;
  url?: string;
  tags?: Record<string, string | number | boolean | null>;
}, options: { includeReplay?: boolean } = {}): string | null {
  if (!IS_ENABLED || !sentryModule) return null;

  return sentryModule.captureFeedback({
    message: params.message,
    source: params.source,
    associatedEventId: params.associatedEventId ?? undefined,
    url: params.url,
    tags: Object.fromEntries(
      Object.entries(params.tags ?? {}).filter(([, value]) => value !== null),
    ) as Record<string, string | number | boolean>,
  }, {
    includeReplay: options.includeReplay === true,
  });
}

export function startSentrySpan(name: string, op: string = 'function'): SentrySpan | undefined {
  if (!IS_ENABLED || !sentryModule) return undefined;
  return sentryModule.startInactiveSpan({ name, op });
}

export function captureNavigation(from: string, to: string): void {
  addSentryBreadcrumb(`Navigate: ${from} -> ${to}`, 'navigation', { from, to });
}

export function captureApiCall(
  method: string,
  endpoint: string,
  status: number,
  duration: number,
): void {
  addSentryBreadcrumb(
    `${method} ${endpoint} -> ${status}`,
    'http',
    { method, url: endpoint, status_code: status, duration_ms: Math.round(duration) },
    status >= 400 ? 'error' : 'info',
  );
}

export function captureAuthEvent(
  event: string,
  userId?: number,
  data?: Record<string, unknown>,
): void {
  addSentryBreadcrumb(
    `Auth: ${event}`,
    'auth',
    { event, user_id: userId, ...data },
    event.includes('fail') ? 'warning' : 'info',
  );
}

class LocalErrorBoundary extends Component<{
  children?: ReactNode;
  fallback?: ReactNode | ComponentType<{ error: Error }>;
}, { error: Error | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    captureSentryException(error, {
      source: 'root_error_boundary',
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    const { fallback } = this.props;
    if (!fallback) {
      return null;
    }

    if (typeof fallback === 'function') {
      return createElement(fallback, { error: this.state.error });
    }

    return fallback;
  }
}

export function SentryErrorBoundary({ children, fallback }: {
  children: ReactNode;
  fallback?: ReactNode | ComponentType<{ error: Error }>;
}): ReactNode {
  return createElement(LocalErrorBoundary, { fallback, children });
}

export function SentryProfiler({ children }: { children: ReactNode }): ReactNode {
  if (!IS_ENABLED || !sentryModule) {
    return children;
  }

  const Profiled = sentryModule.withProfiler(() => children as ReactElement);
  return createElement(Profiled);
}
