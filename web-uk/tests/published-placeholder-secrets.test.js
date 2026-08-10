// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Regression guard, added 2026-08-10.
//
// web-uk/.env.docker is TRACKED and therefore published in this public
// repository. Its COOKIE_SECRET and SESSION_SECRET are placeholders that exist
// only to satisfy local length checks. Both are longer than 32 characters and
// neither starts with 'change-this', so the original production check passed
// them: a deployment that loaded that file would have booted with signing keys
// printed on the internet, and the safety check would have called the
// configuration valid.
//
// These tests read the values OUT OF .env.docker rather than hard-coding them,
// so if someone edits that file the guard follows automatically instead of
// silently protecting a value that is no longer there.

const fs = require('node:fs');
const path = require('node:path');
const { productionConfigErrors, isPlaceholderSecret } = require('../src/lib/production-config');

function readEnvDocker() {
  const file = path.join(__dirname, '..', '.env.docker');
  const text = fs.readFileSync(file, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

describe('published placeholder secrets are refused in production', () => {
  const envDocker = readEnvDocker();

  it('.env.docker still defines the two secrets (guard is pointing at something)', () => {
    expect(typeof envDocker.COOKIE_SECRET).toBe('string');
    expect(typeof envDocker.SESSION_SECRET).toBe('string');
    expect(envDocker.COOKIE_SECRET.length).toBeGreaterThan(0);
    expect(envDocker.SESSION_SECRET.length).toBeGreaterThan(0);
  });

  it('those exact published values are long enough to have fooled a length-only check', () => {
    // Proves WHY this guard is needed: the old rule was length + a
    // 'change-this' prefix, and both values clear it comfortably.
    expect(envDocker.COOKIE_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(envDocker.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(envDocker.COOKIE_SECRET.startsWith('change-this')).toBe(false);
    expect(envDocker.SESSION_SECRET.startsWith('change-this')).toBe(false);
  });

  it('recognises each published value as a placeholder', () => {
    expect(isPlaceholderSecret(envDocker.COOKIE_SECRET)).toBe(true);
    expect(isPlaceholderSecret(envDocker.SESSION_SECRET)).toBe(true);
  });

  it('refuses to start production with the published .env.docker secrets', () => {
    const errors = productionConfigErrors({
      NODE_ENV: 'production',
      COOKIE_SECRET: envDocker.COOKIE_SECRET,
      SESSION_SECRET: envDocker.SESSION_SECRET,
      SESSION_REDIS_URL: 'rediss://sessions.example.test:6380/1',
    });

    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('COOKIE_SECRET'),
      expect.stringContaining('SESSION_SECRET'),
    ]));
  });

  it('still accepts genuine, distinct, long secrets', () => {
    const errors = productionConfigErrors({
      NODE_ENV: 'production',
      COOKIE_SECRET: 'Zq7Z0m2xK9pB4vL8rT1yH6nW3cF5jD0aQeUiOoPpAsDfGh',
      SESSION_SECRET: 'Mk4Ns9Wq2Bt7Yr1Xv5Lz8Cd3Fg6Hj0PaSdFgHjKlZxCvBn',
      SESSION_REDIS_URL: 'rediss://sessions.example.test:6380/1',
    });
    expect(errors).toEqual([]);
  });

  it('does not reject a real secret merely for sharing a prefix with a placeholder', () => {
    // Published values are matched exactly, not by prefix, so a legitimate
    // secret that happens to begin similarly must still pass.
    const lookalike = `${envDocker.COOKIE_SECRET}-but-actually-a-real-generated-suffix-9f3a`;
    expect(isPlaceholderSecret(lookalike)).toBe(false);
  });

  it('is inert outside production', () => {
    expect(productionConfigErrors({
      NODE_ENV: 'development',
      COOKIE_SECRET: envDocker.COOKIE_SECRET,
      SESSION_SECRET: envDocker.SESSION_SECRET,
    })).toEqual([]);
  });
});
