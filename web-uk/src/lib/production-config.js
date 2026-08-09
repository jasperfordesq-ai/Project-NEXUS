// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

function productionConfigErrors(env = process.env) {
  if ((env.NODE_ENV || 'development') !== 'production') return [];

  const cookieSecret = String(env.COOKIE_SECRET || '');
  const sessionSecret = String(env.SESSION_SECRET || '');
  const errors = [];
  if (cookieSecret.length < 32 || cookieSecret.startsWith('change-this')) {
    errors.push('COOKIE_SECRET must be a non-placeholder value of at least 32 characters');
  }
  if (sessionSecret.length < 32 || sessionSecret.startsWith('change-this')) {
    errors.push('SESSION_SECRET must be a non-placeholder value of at least 32 characters');
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

module.exports = { assertProductionConfig, productionConfigErrors };
