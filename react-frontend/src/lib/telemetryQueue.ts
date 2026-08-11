// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { readStoredConsent } from '@/lib/cookieConsentStorage';
import type { User } from '@/types';

type SentryFacade = typeof import('@/lib/sentry');
type SeverityLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';
type SentryTask = (Sentry: SentryFacade) => void;

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number;
};

const MAX_PENDING_TASKS = 100;
const SENTRY_QUEUE_FLUSH_DELAY_MS = 45000;

/**
 * 🔴 A queued task carries whether it needs analytics consent.
 *
 * The queue used to drop EVERYTHING without analytics consent. That silently
 * undid most of the change that made crash reporting consent-free: only the three
 * direct callers (`ErrorBoundary`, `FeatureErrorBoundary`, `main.tsx`) were
 * genuinely unconditional, while `logError()` — over a thousand call sites — and
 * every failed API response report through this queue and stayed gated. So the
 * banner promised anonymous fault reports were always sent, and for the vast
 * majority of faults they were not.
 *
 * This is not a new decision: it finishes the one already taken, which was that
 * errors always send while identity, tracing and session replay stay behind
 * consent. What rides along unconsented is therefore kept deliberately narrow —
 * see `requiresConsent` at each queue function below.
 */
type QueuedTask = {
  task: SentryTask;
  /** false ⇒ an error-class event, sent regardless of analytics consent. */
  requiresConsent: boolean;
};

const pendingTasks: QueuedTask[] = [];
let isScheduled = false;
let isFlushing = false;

const AUTH_ENTRY_PATHS = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/password/forgot',
  '/password/reset',
  '/verify-email',
  '/verify-identity',
  '/auth/oauth/callback',
  '/oauth/callback',
]);

function hasAnalyticsConsent(): boolean {
  return readStoredConsent()?.analytics === true;
}

function isAuthEntryPath(): boolean {
  if (typeof window === 'undefined') return false;

  const normalizedPath = window.location.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  const segments = normalizedPath.split('/').filter(Boolean);
  const candidatePaths = segments.map((_, index) => `/${segments.slice(index).join('/')}`);
  return candidatePaths.some((candidate) => AUTH_ENTRY_PATHS.has(candidate));
}

function runAfterFirstPaintIdle(callback: () => void): void {
  if (typeof window === 'undefined') {
    callback();
    return;
  }

  const scheduleIdle = () => {
    const idleWindow = window as IdleWindow;
    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleWindow.requestIdleCallback(callback, { timeout: 5000 });
      return;
    }

    window.setTimeout(callback, 3000);
  };

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(scheduleIdle);
  });
}

function runAfterDelayedIdle(callback: () => void, delayMs: number): void {
  if (typeof window === 'undefined') {
    callback();
    return;
  }

  window.setTimeout(() => runAfterFirstPaintIdle(callback), delayMs);
}

function scheduleFlush(): void {
  if (isScheduled || isFlushing) return;
  if (isAuthEntryPath()) return;

  isScheduled = true;
  runAfterDelayedIdle(() => {
    isScheduled = false;
    flushPendingTasks();
  }, SENTRY_QUEUE_FLUSH_DELAY_MS);
}

function flushPendingTasks(): void {
  if (isFlushing || pendingTasks.length === 0) return;
  if (isAuthEntryPath()) return;

  const consented = hasAnalyticsConsent();

  // Without consent, drop the analytics tasks and keep the error-class ones. This
  // used to be `pendingTasks.length = 0` — discarding the whole queue, faults
  // included.
  const runnable = consented
    ? pendingTasks.splice(0)
    : pendingTasks.splice(0).filter((entry) => !entry.requiresConsent);

  if (runnable.length === 0) return;

  isFlushing = true;
  void import('@/lib/sentry')
    .then((Sentry) => {
      for (const entry of runnable) {
        entry.task(Sentry);
      }
    })
    .finally(() => {
      isFlushing = false;
      if (pendingTasks.length > 0) {
        scheduleFlush();
      }
    });
}

function enqueueSentryTask(task: SentryTask, requiresConsent = true): void {
  // Analytics tasks are still dropped at the door without consent, so nothing
  // about a member who declined is even held in memory.
  if (requiresConsent && !hasAnalyticsConsent()) return;

  pendingTasks.push({ task, requiresConsent });
  if (pendingTasks.length > MAX_PENDING_TASKS) {
    // 🔴 Evict an ANALYTICS task first, so a burst of breadcrumbs cannot push the
    // actual crash out of a full queue. Only if there are none does an error-class
    // task get dropped.
    const analyticsAt = pendingTasks.findIndex((entry) => entry.requiresConsent);
    pendingTasks.splice(analyticsAt === -1 ? 0 : analyticsAt, 1);
  }

  scheduleFlush();
}

export function queueSentryUser(user: User | null): void {
  enqueueSentryTask(({ setSentryUser }) => setSentryUser(user));
}

export function queueSentryTenant(tenant: { id: number; name: string; slug: string } | null): void {
  enqueueSentryTask(({ setSentryTenant }) => setSentryTenant(tenant));
}

export function queueSentryBreadcrumb(
  message: string,
  category: string,
  data: Record<string, unknown>,
  level: SeverityLevel = 'info',
): void {
  enqueueSentryTask(({ addSentryBreadcrumb }) => {
    addSentryBreadcrumb(message, category, data, level);
  });
}

export function queueSentryApiCall(
  method: string,
  endpoint: string,
  status: number,
  duration: number,
): void {
  enqueueSentryTask(({ captureApiCall }) => {
    captureApiCall(method, endpoint, status, duration);
  });
}

export function queueSentryAuthEvent(
  event: string,
  userId?: number,
  context?: Record<string, unknown>,
): void {
  enqueueSentryTask(({ captureAuthEvent }) => {
    captureAuthEvent(event, userId, context);
  });
}

/**
 * 🔴 `error` and `fatal` levels are sent WITHOUT analytics consent; anything
 * quieter is analytics and stays gated.
 *
 * The level is the dividing line because it is what `logError()` sets. A `warning`
 * or `info` message is diagnostic colour, not a fault, and carries no obligation
 * to be recorded for someone who declined analytics.
 */
export function queueSentryMessage(
  message: string,
  level: SeverityLevel,
  context?: Record<string, unknown>,
): void {
  const isFault = level === 'error' || level === 'fatal';
  enqueueSentryTask(({ captureSentryMessage }) => {
    captureSentryMessage(message, level, context);
  }, !isFault);
}

/**
 * Always sent. An exception is a fault by definition, and this is the path
 * `logError()` uses from over a thousand call sites — the reason "we always record
 * anonymous fault reports" was untrue in practice before this.
 */
export function queueSentryException(
  error: Error,
  context?: Record<string, unknown>,
): void {
  enqueueSentryTask(({ captureSentryException }) => {
    captureSentryException(error, context);
  }, false);
}
