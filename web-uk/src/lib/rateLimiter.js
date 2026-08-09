// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Rate limiting configuration and utilities
 * Provides different rate limits for different types of operations
 */

const rateLimit = require('express-rate-limit');

const NODE_ENV = process.env.NODE_ENV || 'development';
const isDevelopment = NODE_ENV !== 'production';

/**
 * Create a rate limiter with consistent options
 * @param {Object} options - Rate limit options
 * @returns {Function} Express middleware
 */
function createLimiter(options) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isDevelopment, // Skip in development for easier testing
    handler: (req, res) => {
      res.status(429).render('errors/429', {
        title: 'Too many requests',
        retryAfter: Math.ceil(options.windowMs / 1000 / 60)
      });
    },
    ...options
  });
}

// General page requests - generous limit
const generalLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests, please try again later.'
});

// Authentication attempts (login, register, forgot password)
const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Strict limit
  message: 'Too many authentication attempts, please try again later.',
  keyGenerator: (req) => {
    // Rate limit by IP + email to prevent credential stuffing
    return `${req.ip}-${req.body?.email || 'unknown'}`;
  }
});

// Sensitive actions (password reset, email change)
const sensitiveLimiter = createLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: 'Too many attempts. Please try again in an hour.'
});

// Form submissions (messages, listings, etc.)
const formLimiter = createLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20,
  message: 'Too many submissions, please slow down.'
});

// API-style actions (quick actions like marking read)
const actionLimiter = createLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30,
  message: 'Too many actions, please slow down.'
});

// Search queries
const searchLimiter = createLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30,
  message: 'Too many searches, please slow down.'
});

// Wallet/financial operations
const walletLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'Too many wallet operations. Please try again later.'
});

/**
 * Apply rate limiting based on route pattern
 * Can be used as middleware to automatically apply appropriate limits
 */
function autoRateLimit(req, res, next) {
  // Skip in development
  if (isDevelopment) {
    return next();
  }

  const path = req.path.toLowerCase();
  const method = req.method;

  // Only rate limit POST/PUT/DELETE
  if (!['POST', 'PUT', 'DELETE'].includes(method)) {
    return next();
  }

  // Auth routes
  if (path.includes('/login') || path.includes('/register') || path.includes('/forgot-password')) {
    return authLimiter(req, res, next);
  }

  // Password reset
  if (path.includes('/reset-password')) {
    return sensitiveLimiter(req, res, next);
  }

  // Wallet operations
  if (path.includes('/wallet')) {
    return walletLimiter(req, res, next);
  }

  // Default form limit
  return formLimiter(req, res, next);
}

module.exports = {
  createLimiter,
  generalLimiter,
  authLimiter,
  sensitiveLimiter,
  formLimiter,
  actionLimiter,
  searchLimiter,
  walletLimiter,
  autoRateLimit
};
