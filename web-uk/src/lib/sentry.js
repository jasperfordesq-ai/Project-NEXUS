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

/**
 * Operational endpoints whose events are noise: answered constantly by the
 * container healthcheck and the deploy script, with /health hit every 10 seconds
 * per colour.
 *
 * 🔴 These are filtered in `beforeSend`, NOT via `ignoreTransactions`.
 * `ignoreTransactions` only ever applies to events of type `transaction`, and
 * tracing here defaults to a 0 sample rate — so no transaction events are produced
 * at all and that option filtered precisely nothing. It looked configured and did
 * nothing, which is the failure mode this codebase keeps finding. If a fault ever
 * throws inside /health, the un-filtered version would have been one Sentry event
 * every 10 seconds per colour.
 */
const IGNORED_OPERATIONAL_PATHS = [
  '/health',
  '/version',
  '/session/touch'
];

/**
 * Does this event come from one of the operational endpoints above?
 *
 * Reads the request URL rather than the transaction name, because an ERROR event
 * carries a request and usually no transaction. Compares the path only, so a query
 * string cannot smuggle a match past it.
 */
function isOperationalNoise(event) {
  const raw = event && event.request && typeof event.request.url === 'string'
    ? event.request.url
    : '';
  if (!raw) return false;

  // Strip scheme+host if present, then the query/hash, leaving a bare path.
  const withoutOrigin = raw.replace(/^https?:\/\/[^/]+/i, '');
  const path = withoutOrigin.split(/[?#]/)[0].replace(/\/+$/, '') || '/';

  return IGNORED_OPERATIONAL_PATHS.includes(path);
}

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
      // 🔴 Case-insensitive, and it now removes the FORWARDED-IP headers too.
      //
      // The module comment promised "no IP address", and `sendDefaultPii: false`
      // does suppress the SDK's own `user.ip_address` — but not request headers.
      // `app.set('trust proxy', 1)` means Apache forwards `x-forwarded-for`, so a
      // member's IP address was reaching Sentry inside the headers while the
      // comment above said it could not.
      //
      // Header names arrive lower-cased from Node, but an event can be
      // hand-assembled, so match on the lower-cased name rather than listing
      // spellings.
      const REDACT = new Set([
        'cookie',
        'authorization',
        'x-csrf-token',
        'x-forwarded-for',
        'x-real-ip',
        'cf-connecting-ip',
        'true-client-ip',
        'x-client-ip'
      ]);
      for (const name of Object.keys(event.request.headers)) {
        if (REDACT.has(name.toLowerCase())) {
          delete event.request.headers[name];
        }
      }
    }
  }

  if (event.user) {
    // Keep nothing but an opaque id if the SDK ever attaches a user.
    event.user = event.user.id ? { id: String(event.user.id) } : undefined;
    if (event.user) delete event.user.ip_address;
  }

  // Breadcrumbs carry the same URLs — outgoing HTTP calls to Laravel include the
  // query string, and a search term is member-entered text.
  if (Array.isArray(event.breadcrumbs)) {
    for (const crumb of event.breadcrumbs) {
      if (!crumb || typeof crumb !== 'object') continue;
      if (crumb.data && typeof crumb.data === 'object') {
        for (const key of ['url', 'to', 'from']) {
          if (typeof crumb.data[key] === 'string') {
            crumb.data[key] = crumb.data[key].split(/[?#]/)[0];
          }
        }
      }
      if (typeof crumb.message === 'string' && crumb.message.includes('?')) {
        crumb.message = crumb.message.replace(/(https?:\/\/[^\s?#]+|\/[^\s?#]*)[?#][^\s]*/g, '$1');
      }
    }
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
    // Kept for the case where tracing IS deliberately switched on, so operational
    // transactions stay out. It is NOT what filters error events — see
    // isOperationalNoise() and the comment on IGNORED_OPERATIONAL_PATHS.
    ignoreTransactions: IGNORED_OPERATIONAL_PATHS,
    beforeSend: (event) => {
      // Drop noise BEFORE scrubbing: no point sanitising an event that is discarded.
      if (isOperationalNoise(event)) return null;
      return scrubEvent(event);
    },
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
 * Report an error explicitly.
 *
 * 🔴 This docblock used to claim it was "used by the existing error logger". It was
 * not called anywhere in `web-uk/src` — a dead export whose comment asserted a
 * wiring that did not exist. It is now genuinely called from `errorLogger`
 * (`src/middleware/error-logging.js`), which is what the claim always described.
 *
 * Sentry's Express handler only sees errors that reach the end of the middleware
 * chain. Anything `asyncRoute`/`handleApiError` deals with and does not re-throw —
 * the majority of handled faults — never reaches it, so without this path those
 * were logged to stdout and reported nowhere.
 */
function captureError(error, context = {}) {
  if (!initialised || !sentryModule) return false;
  sentryModule.captureException(error, { extra: context });
  return true;
}

/**
 * Flush queued events, with a bounded wait.
 *
 * 🔴 Exists because `process.exit()` does not wait for Sentry. The
 * `uncaughtException` handler in `src/server.js` called `console.error` then
 * `process.exit(1)` synchronously; Sentry's own handler had captured the exception,
 * but transmission is asynchronous, so the process died first and the crash — the
 * single most valuable event this service can send — usually never arrived.
 *
 * Resolves rather than rejecting: a failure to flush must not itself prevent the
 * exit, or a broken network would leave the process wedged instead of restarting.
 *
 * @param {number} timeoutMs upper bound on how long to wait
 * @returns {Promise<void>}
 */
function flushSentry(timeoutMs = 2000) {
  if (!initialised || !sentryModule || typeof sentryModule.flush !== 'function') {
    return Promise.resolve();
  }
  return sentryModule
    .flush(timeoutMs)
    .then(() => undefined)
    .catch(() => undefined);
}

module.exports = {
  initSentry,
  attachExpressErrorHandler,
  captureError,
  flushSentry,
  isEnabled,
  // Exported for tests. Scrubbing is the part that must not silently regress.
  scrubEvent,
  isOperationalNoise,
  IGNORED_OPERATIONAL_PATHS
};
