// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The reporting sink that does not depend on Sentry.
 *
 * Two groups of assertions matter here:
 *
 *  1. **It reaches the server.** That is the whole point — Sentry is off in all six
 *     build profiles, so this path is the only one that carries anything today.
 *  2. **It cannot leak a credential, flood the API, or throw.** A diagnostic that does
 *     any of those is worse than no diagnostic at all.
 */

import { APP_VERSION } from '@/lib/constants';
import {
  __resetReportBudgetForTests,
  reportException,
  reportMessage,
  reportSentryMessage,
  safeLinkSummary,
  scrubForReport,
} from './report';

jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

// 🔴 Deliberately NOT 'hour-timebank'. The first version of this mock returned that,
// and the tenant assertion below passed — but it would have passed anyway, because
// DEFAULT_TENANT is also 'hour-timebank', so the test proved nothing about whether the
// stored tenant was ever read. A distinctive value is the difference between a test and
// a coincidence.
jest.mock('@/lib/storage', () => ({
  storage: { get: jest.fn().mockResolvedValue('stored-tenant-slug') },
}));

const Sentry = jest.requireMock('@sentry/react-native') as {
  captureMessage: jest.Mock;
  captureException: jest.Mock;
};

let fetchMock: jest.Mock;

/** The body of the nth POST to /api/app/log. */
function postedBody(call = 0): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

/** Lets the fire-and-forget post settle. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  __resetReportBudgetForTests();
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  global.fetch = fetchMock as unknown as typeof fetch;
  Sentry.captureMessage.mockClear();
  Sentry.captureException.mockClear();
});

describe('reaching the server', () => {
  it('🔴 posts a warning to our own API, not only to Sentry', async () => {
    reportMessage('something drifted', { module: 'events' });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/api/app/log');
    expect(postedBody().event).toBe('mobile_warning');
  });

  it('posts an error with its name and stack', async () => {
    reportException(new TypeError('bad thing'), { screen: 'wallet' });
    await settle();

    const body = postedBody();
    expect(body.event).toBe('mobile_error');
    const data = body.data as Record<string, string>;
    expect(data.name).toBe('TypeError');
    expect(data.message).toBe('bad thing');
    expect(data.screen).toBe('wallet');
  });

  it('still calls Sentry, so a configured DSN keeps working', async () => {
    reportException(new Error('boom'));
    await settle();

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('sends the version header so the server can attribute the report', async () => {
    reportMessage('hello');
    await settle();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    // Compared against the constant, not a literal: this suite does not mock
    // expo-constants, so APP_VERSION is '' here. The assertion that matters is that the
    // header carries whatever the app's version is — a hardcoded '1.2.0' would have been
    // testing the mock, and would break on every version bump.
    expect(headers['X-Nexus-Mobile-Version']).toBe(APP_VERSION);
    expect(headers['X-Tenant-Slug']).toBe('stored-tenant-slug');
  });

  it('forwards a drift report and keeps its module and endpoint', async () => {
    reportSentryMessage('Events contract drift', {
      level: 'warning',
      tags: { module: 'events', endpoint: '/api/v2/events' },
      extra: { issues: [{ path: 'data.0.title', code: 'invalid_type' }] },
    } as Parameters<typeof reportSentryMessage>[1]);
    await settle();

    const data = postedBody().data as Record<string, string>;
    expect(data.module).toBe('events');
    expect(data.endpoint).toBe('/api/v2/events');
    expect(data.detail).toContain('invalid_type');
  });
});

describe('never leaking a credential', () => {
  // 🔴 The reason this exists: the deep-link reporter used to send the WHOLE url, and
  // one of the links this app handles is a password reset — whose token is in the url.

  it('redacts a reset token from a url', () => {
    const scrubbed = scrubForReport('https://app.project-nexus.ie/reset-password?token=abc123secret');

    expect(scrubbed).not.toContain('abc123secret');
    expect(scrubbed).toContain('[redacted]');
  });

  it.each(['token', 'secret', 'password', 'otp', 'code', 'signature', 'key'])(
    'redacts a %s parameter',
    (param) => {
      const scrubbed = scrubForReport(`https://example.test/x?${param}=THE_VALUE`);

      expect(scrubbed).not.toContain('THE_VALUE');
    }
  );

  it('redacts a bearer token and a bare JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjo2NzR9.sig';

    expect(scrubForReport(`Authorization: Bearer ${jwt}`)).not.toContain(jwt);
    expect(scrubForReport(`the token was ${jwt} apparently`)).not.toContain(jwt);
  });

  it('reduces a link to origin plus the first path segment', () => {
    expect(safeLinkSummary('https://app.project-nexus.ie/reset-password/abc123?token=x'))
      .toBe('https://app.project-nexus.ie/reset-password');
  });

  it('drops a query string entirely from a link summary', () => {
    expect(safeLinkSummary('https://app.project-nexus.ie/x?token=secret')).not.toContain('secret');
  });

  it('scrubs what is sent, not just what Sentry sees', async () => {
    reportMessage('failed on https://app.project-nexus.ie/r?token=leakme');
    await settle();

    expect(JSON.stringify(postedBody())).not.toContain('leakme');
  });

  it('caps the length so a huge payload cannot be posted', () => {
    expect(scrubForReport('x'.repeat(5000)).length).toBeLessThanOrEqual(500);
  });
});

describe('never flooding or throwing', () => {
  it('🔴 reports the same thing only once per session', async () => {
    // Contract drift fires on EVERY affected response. Without this a single drifted
    // endpoint would post on every scroll and rate-limit the member's real requests.
    reportMessage('same problem', {}, 'key-1');
    reportMessage('same problem', {}, 'key-1');
    reportMessage('same problem', {}, 'key-1');
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caps the number of reports in one session', async () => {
    for (let i = 0; i < 60; i++) {
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000 + i * 10_000);
      reportMessage(`problem ${i}`, {}, `key-${i}`);
    }
    await settle();

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it('does not throw when the network is gone', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    expect(() => reportMessage('while offline')).not.toThrow();
    await expect(settle()).resolves.toBeUndefined();
  });

  it('does not throw when Sentry itself throws', async () => {
    Sentry.captureException.mockImplementation(() => {
      throw new Error('sentry exploded');
    });

    expect(() => reportException(new Error('original'))).not.toThrow();
    await settle();

    // 🔴 And the server report still happens. Sentry's failure must not take the one
    // working destination down with it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a non-Error throw without choking', async () => {
    expect(() => reportException('just a string')).not.toThrow();
    await settle();

    expect((postedBody().data as Record<string, string>).message).toBe('just a string');
  });

  it('survives context that cannot be serialised', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => reportMessage('circular context', { circular })).not.toThrow();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
