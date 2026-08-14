// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Route helper utilities for consistent error handling
 */

const { ApiError, ApiOfflineError } = require('./api');
const { clearAuthCookies } = require('../middleware/auth');

function resolveRedirectTarget(res, target) {
  if (typeof target !== 'string') return target;
  const urlFor = res && res.locals && typeof res.locals.urlFor === 'function'
    ? res.locals.urlFor
    : (value) => value;
  return urlFor(target);
}

/**
 * Report a fault that this file HANDLES and therefore hides from Sentry.
 *
 * 🔴 Why this is needed at all. Sentry's Express error handler only sees errors that
 * reach the end of the middleware chain. Every branch in `handleApiError` that
 * returns `true` deliberately stops that from happening — which is right for the
 * member (they get a real page instead of a stack trace) and wrong for us, because
 * two of those branches hide genuine server faults: the platform API being
 * unreachable, and a 5xx turned into a flash message.
 *
 * Deliberately narrow. 401, 404 and 4xx are the API behaving correctly and are not
 * reported; flooding Sentry with expected outcomes is how a fault report becomes
 * something nobody reads.
 *
 * Required lazily so this module does not pull in the Sentry wrapper (and, through
 * it, `@sentry/node`) at load time — the wrapper is a clean no-op without a DSN,
 * which is the normal state in development and under test.
 */
function reportSwallowedFault(error, req, reason) {
  try {
    const { captureError } = require('./sentry');
    captureError(error, {
      swallowed_by: 'handleApiError',
      reason,
      method: req && req.method,
      // Path only — never `originalUrl`, which carries the query string and so a
      // member's search terms.
      path: req && req.path,
      status: error && error.status
    });
  } catch {
    // Reporting must never be able to break the response the member is waiting for.
  }
}

/**
 * Handle API errors consistently across routes
 * Returns true if error was handled, false if it should be thrown
 *
 * @param {Error} error - The error to handle
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Object} options - Additional options
 * @param {string} options.redirectOn401 - Where to redirect on 401 (default: '/login')
 * @param {string} options.redirectOnError - Where to redirect for other API errors
 * @param {string} options.notFoundTitle - Title for 404 page
 * @returns {boolean} - Whether the error was handled
 */
function handleApiError(error, req, res, options = {}) {
  const {
    redirectOn401 = '/login',
    redirectOnError = null,
    notFoundTitle = 'Not found'
  } = options;

  // Handle service unavailable
  if (error instanceof ApiOfflineError) {
    // 🔴 REPORTED. The platform API being unreachable is exactly the fault an
    // operator needs to hear about, and it was silently rendered as a 503 page:
    // this branch returns true, so Sentry's Express error handler never sees it.
    reportSwallowedFault(error, req, 'api-offline');
    res.status(503).render('errors/503', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.503_title') : 'Service unavailable') });
    return true;
  }

  if (error instanceof ApiError) {
    // Handle 401 - clear cookies, clear flash messages, and redirect to login
    if (error.status === 401) {
      clearAuthCookies(res);
      // Consume any pending flash messages so they don't leak into the login page
      if (req.flash) {
        req.flash('success');
        req.flash('error');
      }
      res.redirect(resolveRedirectTarget(res, redirectOn401));
      return true;
    }

    // Handle 404
    if (error.status === 404) {
      // 🔴 Use the TRANSLATED 404 title, not the English `notFoundTitle`. 96 call sites
      // pass a hardcoded English string ("Event not found", …) which was rendered
      // straight into <title>, so under any non-English locale the page showed a
      // translated H1 (errors/404.njk already uses error_pages.404_title) above an
      // English tab name. The tab now matches the heading in all eleven languages.
      // notFoundTitle survives only as the fallback when no translator is present.
      res.status(404).render('errors/404', {
        title: res.locals.t ? res.locals.t('govuk_alpha.error_pages.404_title') : notFoundTitle
      });
      return true;
    }

    // Handle other API errors with flash message if redirect provided
    if (redirectOnError) {
      // 🔴 A 5xx from Laravel is a SERVER fault, and this branch turned it into a
      // flash message and a redirect — visible to the member, invisible to us.
      // 4xx is deliberately NOT reported: validation failures, conflicts and
      // permission refusals are the API working correctly.
      if (error.status >= 500) {
        reportSwallowedFault(error, req, 'api-5xx-swallowed');
      }
      if (req.flash) {
        req.flash('error', error.message);
      }
      res.redirect(resolveRedirectTarget(res, redirectOnError));
      return true;
    }
  }

  // Error not handled - should be thrown
  return false;
}

/**
 * Wrap an async route handler to automatically handle common API errors
 * This eliminates the need for repetitive try/catch blocks with 401 handling
 *
 * @param {Function} fn - Async route handler function
 * @param {Object} options - Error handling options
 * @param {string} options.redirectOn401 - Where to redirect on 401 (default: '/login')
 * @param {string} options.notFoundTitle - Title for 404 page
 * @returns {Function} Wrapped Express route handler
 */
function asyncRoute(fn, options = {}) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      // Try to handle the error automatically
      const handled = handleApiError(error, req, res, options);
      if (!handled) {
        // Pass unhandled errors to Express error middleware
        next(error);
      }
    }
  };
}

module.exports = {
  handleApiError,
  asyncRoute
};
