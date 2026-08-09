// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Centralized error handling utilities
 */

const { ApiError, ApiOfflineError } = require('./api');

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
      return res.status(503).render('errors/503', { title: 'Service unavailable' });
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
          title: 'Forbidden',
          message: err.message || 'You do not have permission to access this resource.'
        });
      }

      // Not found
      if (err.status === 404) {
        return res.status(404).render('errors/404', { title: 'Page not found' });
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
      title: 'Forbidden',
      message: isProduction ? 'You do not have permission to access this resource.' : err.message
    });
  }

  if (status === 404) {
    return res.status(404).render('errors/404', { title: 'Page not found' });
  }

  if (status === 419) {
    return res.status(419).render('errors/419', { title: 'This page has expired' });
  }

  if (status === 429) {
    return res.status(429).render('errors/429', { title: 'Too many requests' });
  }

  if (status === 503 || err instanceof ApiOfflineError) {
    return res.status(503).render('errors/503', { title: 'Service unavailable' });
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
  logError,
  errorLogger,
  finalErrorHandler
};
