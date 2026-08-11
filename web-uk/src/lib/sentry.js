// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Sentry error reporting — web-uk accessible frontend.
 *
 * 🔴 WHY THIS EXISTS. web-uk had NO error reporting at all. The blue/green compose
 * overlay passed a `SENTRY_DSN`, but nothing in this application read it — so the
 * variable looked configured while reporting nothing. Making web-uk an
 * internet-facing production service with no error reporting was one of the
 * recorded open prerequisites in docs/ACCESSIBLE-FRONTEND-TAKEOVER.md.
 *
 * DELIBERATELY DIFFERENT FROM THE REACT APP. `react-frontend/src/lib/sentry.ts`
 * defers loading the SDK until the visitor grants analytics consent, because it
 * runs in the visitor's browser and reports their activity. This runs on OUR
 * server and reports OUR faults: it is operational diagnostics, not analytics
 * about a person, and holding it back until someone accepts cookies would mean
 * losing exactly the crashes that happen before or instead of that choice.
 * `config/sentry.php` takes the same unconditional approach for Laravel.
 *
 * PRIVACY. Matches config/sentry.php: `sendDefaultPii: false`, so no IP address,
 * no cookies and no request body are attached. A `beforeSend` scrub then removes
 * the query string and the tenant-session cookie header, because a URL on this
 * site can carry a search term a member typed.
 */

const DEFAULT_IGNORED_TRANSACTIONS = [
  // Answered constantly by the container healthcheck and the deploy script. They
  // are noise, and /health in particular is hit every 10 seconds per colour.
  '/health',
  '/version',
  '/session/touch'
];

let initialised = false;
let sentryModule = null;

/**
 * @returns {boolean} true when reporting is actually active
 */
function isEnabled() {
  return initialised;
}

/**
 * Scrub anything that could carry member data out of an event.
 *
 * 🔴 Kept narrow and explicit rather than clever. The dangerous fields here are
 * the query string (a search term is member-entered text) and headers (cookies
 * carry the session). `sendDefaultPii: false` already withholds most of it; this
 * is the belt to that braces, because a future SDK default change should not
 * silently start shipping member data.
 */
function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event;

  if (event.request) {
    if (typeof event.request.url === 'string') {
      const questionMark = event.request.url.indexOf('?');
      if (questionMark !== -1) {
        event.request.url = `${event.request.url.slice(0, questionMark)}?[scrubbed]`;
      }
    }
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers && typeof event.request.headers === 'object') {
      delete event.request.headers.cookie;
      delete event.request.headers.Cookie;
      delete event.request.headers.authorization;
      delete event.request.headers.Authorization;
    }
  }

  if (event.user) {
    // Keep nothing but an opaque id if the SDK ever attaches a user.
    event.user = event.user.id ? { id: String(event.user.id) } : undefined;
  }

  return event;
}

/**
 * Initialise Sentry. Safe to call when no DSN is configured — it becomes a no-op,
 * which is the normal state in development and in the test suite.
 *
 * Must be called BEFORE the Express app is constructed so the SDK can instrument
 * the modules it needs to.
 *
 * @returns {boolean} whether reporting was enabled
 */
function initSentry() {
  if (initialised) return true;

  // Read at call time, not at module load, so tests can set the variable.
  const dsn = (process.env.SENTRY_DSN || '').trim();
  if (!dsn) return false;

  // Required rather than imported at module top level: when there is no DSN —
  // development, and every test run — there is no reason to load 29 packages.
  sentryModule = require('@sentry/node');

  sentryModule.init({
    dsn,
    environment: (process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development').trim(),
    // 🔴 MUST be `nexus-webuk@<commit>`, not the bare commit. The convention is set
    // by config/sentry.php (`nexus-php@`) and react-frontend/src/lib/sentry.ts
    // (`nexus-react@`), and scripts/postdeploy-watch.mjs queries
    // `release:nexus-<stack>@<commit>` literally. A bare commit here would make
    // this service invisible to the 30-minute post-deploy error watch — the exact
    // window where a new fault matters most.
    release: (process.env.BUILD_COMMIT || '').trim()
      ? `nexus-webuk@${process.env.BUILD_COMMIT.trim()}`
      : undefined,
    // 🔴 GDPR-aligned with config/sentry.php and the React app: never attach IP
    // address, cookies or request bodies.
    sendDefaultPii: false,
    // Errors: report all. Traces: off unless deliberately enabled, because
    // performance tracing on every request is a quota decision, not a default.
    sampleRate: 1.0,
    tracesSampleRate: Number.parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0') || 0,
    ignoreTransactions: DEFAULT_IGNORED_TRANSACTIONS,
    beforeSend: (event) => scrubEvent(event),
    // The colour this container belongs to, so a fault can be traced to one side
    // of a blue/green pair.
    initialScope: {
      tags: {
        service: 'nexus-webuk',
        color: (process.env.NEXUS_COLOR || 'unknown').trim()
      }
    }
  });

  initialised = true;
  return true;
}

/**
 * Attach Sentry's Express error handler.
 *
 * 🔴 A no-op when reporting is disabled, so the middleware chain is IDENTICAL in
 * development and under test. An error handler that only exists in production is
 * an error handler nobody has ever exercised.
 */
function attachExpressErrorHandler(app) {
  if (!initialised || !sentryModule) return false;
  sentryModule.setupExpressErrorHandler(app);
  return true;
}

/**
 * Report an error explicitly. Used by the existing error logger so a fault is
 * reported through the same path that already logs it, rather than adding a
 * second, divergent notion of "what counts as an error".
 */
function captureError(error, context = {}) {
  if (!initialised || !sentryModule) return false;
  sentryModule.captureException(error, { extra: context });
  return true;
}

module.exports = {
  initSentry,
  attachExpressErrorHandler,
  captureError,
  isEnabled,
  // Exported for tests. Scrubbing is the part that must not silently regress.
  scrubEvent,
  DEFAULT_IGNORED_TRANSACTIONS
};
