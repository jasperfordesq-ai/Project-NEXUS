// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * `lib/env.ts` decides nothing at runtime — it only warns. That is precisely why
 * it is worth pinning: the warnings are the only thing standing between a
 * developer and a build that silently points at the LIVE members' API, or one
 * that has no tenant to load and therefore appears broken on first launch.
 *
 * 🔴 `isDev` is captured at module load (`process.env.NODE_ENV === 'development'`).
 * Under Jest `NODE_ENV` is `test`, so every warning is suppressed and the whole
 * warning path is unreachable for a plain import. Each case therefore sets
 * `NODE_ENV` and re-requires the module. Without that the file can only ever
 * report the no-op branch as covered.
 */

const PRODUCTION_API_URL = 'https://api.project-nexus.ie';

/** Run `validateEnv()` with a fresh module instance under a given environment. */
function runValidateEnv(env: Record<string, string | undefined>): {
  warnings: string[];
  notes: string[];
} {
  const warnings: string[] = [];
  const notes: string[] = [];

  const originalEnv = process.env;
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation((m: unknown) => void warnings.push(String(m)));
  const logSpy = jest.spyOn(console, 'log').mockImplementation((m: unknown) => void notes.push(String(m)));

  try {
    process.env = { ...originalEnv, ...env } as NodeJS.ProcessEnv;
    jest.isolateModules(() => {
      require('./env').validateEnv();
    });
  } finally {
    process.env = originalEnv;
    warnSpy.mockRestore();
    logSpy.mockRestore();
  }

  return { warnings, notes };
}

const devBase = {
  NODE_ENV: 'development',
  EXPO_PUBLIC_API_URL: 'http://10.0.2.2:8090',
  EXPO_PUBLIC_DEFAULT_TENANT: 'hour-timebank',
  EXPO_PUBLIC_SENTRY_DSN: 'https://sentry.example.test/1',
};

describe('environment validation in a development build', () => {
  it('says nothing when everything is configured correctly', () => {
    const { warnings, notes } = runValidateEnv(devBase);

    expect(warnings).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('warns that API calls will fail when no API URL is set', () => {
    const { warnings } = runValidateEnv({ ...devBase, EXPO_PUBLIC_API_URL: undefined });

    expect(warnings.join('\n')).toContain('EXPO_PUBLIC_API_URL is not set');
  });

  it('warns when a development build is pointed at the live production API', () => {
    // This is the one that matters: without the warning, a developer testing
    // freely is doing it against real members' data.
    const { warnings } = runValidateEnv({ ...devBase, EXPO_PUBLIC_API_URL: PRODUCTION_API_URL });

    expect(warnings.join('\n')).toContain('points to production');
  });

  it('stays quiet about the production API when that was opted into explicitly', () => {
    const { warnings } = runValidateEnv({
      ...devBase,
      EXPO_PUBLIC_API_URL: PRODUCTION_API_URL,
      EXPO_PUBLIC_ALLOW_PRODUCTION_API_IN_DEV: 'true',
    });

    expect(warnings.join('\n')).not.toContain('points to production');
  });

  it('treats any value other than the exact string "true" as not opted in', () => {
    const { warnings } = runValidateEnv({
      ...devBase,
      EXPO_PUBLIC_API_URL: PRODUCTION_API_URL,
      EXPO_PUBLIC_ALLOW_PRODUCTION_API_IN_DEV: 'yes',
    });

    expect(warnings.join('\n')).toContain('points to production');
  });

  it('warns about a trailing slash, which would produce double-slash request URLs', () => {
    const { warnings } = runValidateEnv({ ...devBase, EXPO_PUBLIC_API_URL: 'http://10.0.2.2:8090/' });

    expect(warnings.join('\n')).toContain('trailing slash');
  });

  it('warns when no default tenant is set, because first launch has nothing to load', () => {
    const { warnings } = runValidateEnv({ ...devBase, EXPO_PUBLIC_DEFAULT_TENANT: undefined });

    expect(warnings.join('\n')).toContain('EXPO_PUBLIC_DEFAULT_TENANT is not set');
  });

  it('treats a whitespace-only default tenant as unset', () => {
    const { warnings } = runValidateEnv({ ...devBase, EXPO_PUBLIC_DEFAULT_TENANT: '   ' });

    expect(warnings.join('\n')).toContain('EXPO_PUBLIC_DEFAULT_TENANT is not set');
  });

  it('notes rather than warns when crash reporting is switched off', () => {
    // A missing DSN is a normal local state, so it must not read as a problem —
    // but it does need saying, or a developer assumes crashes are being captured.
    const { warnings, notes } = runValidateEnv({ ...devBase, EXPO_PUBLIC_SENTRY_DSN: undefined });

    expect(notes.join('\n')).toContain('Crash reporting (Sentry) is disabled');
    expect(warnings).toEqual([]);
  });
});

describe('environment validation in a production build', () => {
  it('logs nothing at all, even when configuration is missing', () => {
    // Every message is developer-facing. Leaking configuration details into a
    // shipped app's console would be noise at best.
    const { warnings, notes } = runValidateEnv({
      NODE_ENV: 'production',
      EXPO_PUBLIC_API_URL: undefined,
      EXPO_PUBLIC_DEFAULT_TENANT: undefined,
      EXPO_PUBLIC_SENTRY_DSN: undefined,
    });

    expect(warnings).toEqual([]);
    expect(notes).toEqual([]);
  });
});
