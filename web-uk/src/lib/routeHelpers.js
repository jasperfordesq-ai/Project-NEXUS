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
    res.status(503).render('errors/503', { title: 'Service unavailable' });
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
      res.status(404).render('errors/404', { title: notFoundTitle });
      return true;
    }

    // Handle other API errors with flash message if redirect provided
    if (redirectOnError) {
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
