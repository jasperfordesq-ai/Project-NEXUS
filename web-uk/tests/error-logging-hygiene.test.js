// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const path = require('node:path');
const { logError } = require('../src/lib/errorHandler');

// A member's single-use password-reset token and their search terms ride the
// query string. They must never reach the access log or the error log. These
// tests lock both sinks: errorHandler.logError (path only) and the morgan
// `:url` token override in server.js (path only, so combined/dev both drop it).
describe('log hygiene: reset token and search terms never reach the logs', () => {
  it('logError records the path, not originalUrl with its query string', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      logError(new Error('boom'), {
        req: {
          method: 'GET',
          path: '/password/reset',
          originalUrl: '/password/reset?token=SECRET-RESET-TOKEN-123',
          ip: '203.0.113.7'
        }
      });
      const emitted = spy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(emitted).toContain('/password/reset');
      expect(emitted).not.toContain('SECRET-RESET-TOKEN-123');
      expect(emitted).not.toContain('token=');
      expect(emitted).not.toContain('?');
    } finally {
      spy.mockRestore();
    }
  });

  it('server.js overrides the morgan :url token to req.path', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    expect(source).toMatch(/morgan\.token\(\s*'url'\s*,\s*\(req\)\s*=>\s*req\.path\s*\)/);
  });
});
