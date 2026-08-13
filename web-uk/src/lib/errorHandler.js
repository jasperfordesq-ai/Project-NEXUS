// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Centralized error handling utilities
 */

const { ApiError, ApiOfflineError } = require('./api');
const { createChoiceTranslator, createTranslator } = require('./localization');
const { prefixLocalPath } = require('./accessible-shell');
const { localeFromAcceptLanguage } = require('../middleware/localization');

/**
 * 🔴 MAKE THE ERROR PAGES RENDERABLE WHEREVER A REQUEST DIES.
 *
 * Every template under `views/errors/` — and `views/layouts/error.njk` itself —
 * CALLS `t(...)` and `urlFor(...)`. Nunjucks tolerates a missing *value* (it
 * renders empty) but not a missing *callable*: an interpolated `t(key)` with no
 * `t` in scope throws `Unable to call \`t\`, which is undefined or falsey`. So the
 * error page becomes its own second failure — exactly what the comment at the
 * top of `layouts/error.njk` promises cannot happen. This middleware is what
 * makes that promise true.
 *
 * 🔴 It is not hypothetical. `generalLimiter` is mounted DELIBERATELY above the
 * body parsers, the session and `localization` — a rate-limited request must not
 * cost a body copy or a session lookup — so its 429 handler renders with no
 * `res.locals.t` at all. Production, 2026-08-13: a scanner walked the site,
 * spent the 100-requests-per-15-minutes allowance, and the 429 page crashed
 * instead of saying "too many requests" (Sentry NEXUS-WEBUK-3). A real member
 * hitting the same limit gets the same crash, and 100 page views in fifteen
 * minutes is an ordinary browsing session, not an attack.
 *
 * Mounted early so the fallbacks are in place BEFORE anything can fail. Every
 * value is installed only when absent, so the real `localization` middleware and
 * `buildShellLocals` still own these locals on a normal request.
 */
function errorPageFallbackLocals(req, res, next) {
  const locale = localeFromAcceptLanguage(
    req.get?.('accept-language') || req.headers?.['accept-language']
  ) || 'en';

  if (typeof res.locals.t !== 'function') res.locals.t = createTranslator(locale);
  if (typeof res.locals.tc !== 'function') res.locals.tc = createChoiceTranslator(locale);
  if (!res.locals.locale) res.locals.locale = locale;
  if (!res.locals.htmlLang) res.locals.htmlLang = locale;
  if (!res.locals.htmlDirection) res.locals.htmlDirection = locale === 'ar' ? 'rtl' : 'ltr';

  if (typeof res.locals.urlFor !== 'function') {
    // `tenantRouting` runs before this, so a shared-mount request already knows
    // its `/{slug}/accessible` prefix. With no prefix the unprefixed path is
    // correct — that is what a custom accessible domain serves.
    res.locals.urlFor = (pathname) => prefixLocalPath(pathname, req.accessibleRouting?.prefix || '');
  }

  next();
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

/**
 * Wrap an async route handler to catch errors and pass them to next()
 * @param {Function} fn - Async route handler function
 * @returns {Function} Wrapped function that catches errors
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Create a route-level error handler for API errors
 * Handles common API error patterns and renders appropriate responses
 * @param {Object} options - Handler options
 * @param {string} options.redirectTo - URL to redirect on recoverable errors
 * @param {string} options.errorView - View to render on errors (alternative to redirect)
 * @param {Object} options.viewData - Additional data to pass to error view
 * @returns {Function} Express error handling middleware
 */
function apiErrorHandler(options = {}) {
  return (err, req, res, next) => {
    // API is offline/unreachable
    if (err instanceof ApiOfflineError) {
      return res.status(503).render('errors/503', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.503_title') : 'Service unavailable') });
    }

    // API returned an error
    if (err instanceof ApiError) {
      // Unauthorized - clear token and redirect to login
      if (err.status === 401) {
        res.clearCookie('token', { path: '/', httpOnly: true, signed: true, sameSite: 'lax' });
        res.clearCookie('refresh_token', { path: '/', httpOnly: true, signed: true, sameSite: 'lax' });
        return redirectTo(res, '/login');
      }

      // Forbidden
      if (err.status === 403) {
        return res.status(403).render('errors/403', {
          title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.403_title') : 'Forbidden'),
          message: err.message || 'You do not have permission to access this resource.'
        });
      }

      // Not found
      if (err.status === 404) {
        return res.status(404).render('errors/404', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.404_title') : 'Page not found') });
      }

      // Validation errors (400) - redirect back with flash message
      if (err.status === 400 && options.redirectTo) {
        if (req.flash) {
          req.flash('error', err.message || 'Invalid request');
        }
        return redirectTo(res, options.redirectTo);
      }

      // If we have a custom error view, use it
      if (options.errorView) {
        return res.status(err.status || 500).render(options.errorView, {
          title: 'Error',
          error: err.message,
          ...options.viewData
        });
      }
    }

    // Pass to global error handler
    next(err);
  };
}

/**
 * Log error details (respects NODE_ENV)
 * @param {Error} err - Error to log
 * @param {Object} context - Additional context (req, etc.)
 */
function logError(err, context = {}) {
  const isProduction = process.env.NODE_ENV === 'production';

  const logData = {
    message: err.message,
    name: err.name,
    status: err.status,
    timestamp: new Date().toISOString()
  };

  if (context.req) {
    logData.method = context.req.method;
    logData.url = context.req.originalUrl;
    logData.ip = context.req.ip;
  }

  if (!isProduction) {
    logData.stack = err.stack;
    logData.data = err.data;
  }

  console.error('Application Error:', JSON.stringify(logData, null, 2));
}

/**
 * Express middleware for enhanced error logging
 */
function errorLogger(err, req, res, next) {
  logError(err, { req });
  next(err);
}

/**
 * Final error handler - renders error page
 */
function finalErrorHandler(err, req, res, next) {
  // Don't leak error details in production
  const isProduction = process.env.NODE_ENV === 'production';

  const status = err.status || 500;

  // Already handled by previous middleware
  if (res.headersSent) {
    return next(err);
  }

  // Handle specific statuses
  if (status === 401) {
    res.clearCookie('token', { path: '/', httpOnly: true, signed: true, sameSite: 'lax' });
    res.clearCookie('refresh_token', { path: '/', httpOnly: true, signed: true, sameSite: 'lax' });
    return redirectTo(res, '/login');
  }

  if (status === 403) {
    return res.status(403).render('errors/403', {
      title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.403_title') : 'Forbidden'),
      message: isProduction ? 'You do not have permission to access this resource.' : err.message
    });
  }

  if (status === 404) {
    return res.status(404).render('errors/404', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.404_title') : 'Page not found') });
  }

  if (status === 419) {
    return res.status(419).render('errors/419', { title: 'This page has expired' });
  }

  if (status === 429) {
    return res.status(429).render('errors/429', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.429_title') : 'Too many requests') });
  }

  if (status === 503 || err instanceof ApiOfflineError) {
    return res.status(503).render('errors/503', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.503_title') : 'Service unavailable') });
  }

  // Generic server error
  res.status(status).render('errors/500', {
    title: 'Problem with the service',
    errorDetails: isProduction ? null : {
      message: err.message,
      stack: err.stack
    }
  });
}

module.exports = {
  asyncHandler,
  apiErrorHandler,
  errorPageFallbackLocals,
  logError,
  errorLogger,
  finalErrorHandler
};
