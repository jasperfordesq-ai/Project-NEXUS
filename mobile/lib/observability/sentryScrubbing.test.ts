// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * These two hooks are the last thing between a member's bearer token and a
 * third-party service, and a failure here looks exactly like success — Sentry keeps
 * accepting events either way, just with credentials attached. So the assertions are
 * deliberately about what is ABSENT.
 */

import { scrubSentryBreadcrumb, scrubSentryEvent } from './sentryScrubbing';

const TOKEN = 'Bearer eyJhbGciOiJIUzI1NiJ9.super-secret-token';

describe('scrubbing an outgoing event', () => {
  it('removes the Authorization header', () => {
    const event = { request: { headers: { Authorization: TOKEN, Accept: 'application/json' } } };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request?.headers).not.toHaveProperty('Authorization');
    expect(scrubbed.request?.headers).toEqual({ Accept: 'application/json' });
  });

  it('removes cookies as well as bearer tokens', () => {
    const event = { request: { headers: { Cookie: 'session=abc', 'Set-Cookie': 'session=abc' } } };

    expect(Object.keys(scrubSentryEvent(event).request?.headers ?? {})).toEqual([]);
  });

  it.each([
    'Authorization',
    'authorization',
    'AUTHORIZATION',
    'AuThOrIzAtIoN',
    'Proxy-Authorization',
    'X-Auth-Token',
  ])('removes %s regardless of the case it arrives in', (header) => {
    // 🔴 The inline version this replaced deleted only the exact `Authorization` and
    // `authorization` spellings. HTTP header names are case-insensitive and
    // intermediaries do normalise them, so an `AUTHORIZATION` header was sent to
    // Sentry verbatim. That is the bug this test exists to keep fixed.
    const event = { request: { headers: { [header]: TOKEN } } };

    expect(Object.keys(scrubSentryEvent(event).request?.headers ?? {})).toEqual([]);
  });

  it('keeps every non-sensitive header, because the report is still wanted', () => {
    const event = {
      request: {
        headers: {
          Authorization: TOKEN,
          'X-Tenant-Slug': 'hour-timebank',
          'X-Nexus-Mobile': '1',
          'Content-Type': 'application/json',
        },
      },
    };

    expect(scrubSentryEvent(event).request?.headers).toEqual({
      'X-Tenant-Slug': 'hour-timebank',
      'X-Nexus-Mobile': '1',
      'Content-Type': 'application/json',
    });
  });

  it('returns the event rather than dropping it', () => {
    // Returning null would discard the crash report entirely. The goal is the
    // report WITHOUT the credentials, not the loss of the report.
    const event = { request: { headers: { Authorization: TOKEN } } };

    expect(scrubSentryEvent(event)).toBe(event);
  });

  it.each([
    ['no request at all', {}],
    ['a request with no headers', { request: {} }],
    ['undefined headers', { request: { headers: undefined } }],
  ])('handles %s without throwing', (_label, event) => {
    // A throw inside beforeSend loses the report — the opposite of what a crash
    // reporter is for.
    expect(() => scrubSentryEvent(event)).not.toThrow();
  });
});

describe('scrubbing a breadcrumb', () => {
  it('removes auth material from the data bag', () => {
    // The API client attaches request context to breadcrumbs, so a token reaches
    // Sentry through this path as readily as through a header.
    const crumb = { data: { authorization: TOKEN, url: '/api/v2/wallet/balance', method: 'GET' } };

    expect(scrubSentryBreadcrumb(crumb).data).toEqual({
      url: '/api/v2/wallet/balance',
      method: 'GET',
    });
  });

  it('removes it whatever the case', () => {
    const crumb = { data: { AUTHORIZATION: TOKEN, Cookie: 'session=abc' } };

    expect(Object.keys(scrubSentryBreadcrumb(crumb).data ?? {})).toEqual([]);
  });

  it('returns the breadcrumb, and survives one with no data', () => {
    const crumb = { data: { authorization: TOKEN } };
    expect(scrubSentryBreadcrumb(crumb)).toBe(crumb);
    expect(() => scrubSentryBreadcrumb({})).not.toThrow();
  });

  it('leaves diagnostic fields intact so the breadcrumb is still useful', () => {
    const crumb = { data: { status_code: 401, url: '/api/auth/refresh-token' } };

    expect(scrubSentryBreadcrumb(crumb).data).toEqual({
      status_code: 401,
      url: '/api/auth/refresh-token',
    });
  });
});
