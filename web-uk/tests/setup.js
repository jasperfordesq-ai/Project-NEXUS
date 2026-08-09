// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Jest setup file

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECRET = 'test-secret-minimum-32-characters-long';
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!!';
process.env.ACCESSIBLE_BACKEND_TARGET = 'laravel';
process.env.LARAVEL_BASE_URL = 'http://127.0.0.1:8088';

// Suppress console output during tests
if (process.env.JEST_SILENT !== 'false') {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
}
