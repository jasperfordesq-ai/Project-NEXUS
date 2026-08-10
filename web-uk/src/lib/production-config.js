// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

// 🔴 Secrets that are PUBLISHED IN THIS PUBLIC REPOSITORY and must never sign
// anything real. Knowing a signing key means being able to forge the cookies
// and sessions it signs.
//
// Added 2026-08-10 after finding the length check could not catch them. The
// tracked web-uk/.env.docker ships:
//   COOKIE_SECRET=docker-dev-cookie-secret-minimum-32-characters   (49 chars)
//   SESSION_SECRET=docker-dev-session-secret-minimum-32-chars      (48 chars)
// Both are over 32 characters and neither starts with 'change-this', so the
// original rule passed them. Anyone who loaded that file in production — which
// the production compose profile did — would have booted with signing keys
// printed on the internet, and this check would have reported the
// configuration valid.
//
// Matched exactly, not by prefix: a real secret must never be rejected because
// it happens to begin with the same characters.
const PUBLISHED_PLACEHOLDER_SECRETS = new Set([
  'docker-dev-cookie-secret-minimum-32-characters',
  'docker-dev-session-secret-minimum-32-chars',
]);

// Prefixes that signal a value nobody replaced.
const PLACEHOLDER_PREFIXES = ['change-this', 'changeme', 'replace-me', 'replace_me', 'your-', 'example-', 'test-secret'];

function isPlaceholderSecret(value) {
  const normalized = value.trim().toLowerCase();
  if (PUBLISHED_PLACEHOLDER_SECRETS.has(normalized)) return true;
  return PLACEHOLDER_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function productionConfigErrors(env = process.env) {
  if ((env.NODE_ENV || 'development') !== 'production') return [];

  const cookieSecret = String(env.COOKIE_SECRET || '');
  const sessionSecret = String(env.SESSION_SECRET || '');
  const errors = [];
  if (cookieSecret.length < 32 || isPlaceholderSecret(cookieSecret)) {
    errors.push('COOKIE_SECRET must be a non-placeholder value of at least 32 characters, and must not be a value published in this public repository');
  }
  if (sessionSecret.length < 32 || isPlaceholderSecret(sessionSecret)) {
    errors.push('SESSION_SECRET must be a non-placeholder value of at least 32 characters, and must not be a value published in this public repository');
  }
  if (cookieSecret && sessionSecret && cookieSecret === sessionSecret) {
    errors.push('SESSION_SECRET must be distinct from COOKIE_SECRET');
  }
  if (!String(env.SESSION_REDIS_URL || '').trim()) {
    errors.push('SESSION_REDIS_URL is required for persistent production sessions');
  }
  return errors;
}

function assertProductionConfig(env = process.env) {
  const errors = productionConfigErrors(env);
  if (errors.length) {
    throw new Error(`Invalid production configuration: ${errors.join('; ')}`);
  }
}

module.exports = {
  assertProductionConfig,
  productionConfigErrors,
  // Exported so the test suite can assert the exact published values are
  // rejected, rather than only testing a made-up placeholder.
  PUBLISHED_PLACEHOLDER_SECRETS,
  isPlaceholderSecret,
};
