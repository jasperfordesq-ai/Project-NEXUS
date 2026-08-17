// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tenant bootstrap caching.
 *
 * `GET /api/v2/tenant/bootstrap` runs on every single page view, so it is cached
 * — but it is the ONE response where a wrong cache key hands one community another
 * community's configuration. These tests pin the isolation properties, not just
 * the cache hit.
 */

const mockFetch = jest.fn();
global.fetch = mockFetch;

process.env.API_BASE_URL = 'http://localhost:5000';

const api = require('../src/lib/api');
const { cache } = require('../src/lib/cache');
const { runWithRequestLocale } = require('../src/lib/request-locale-context');

function jsonOnce(payload, { ok = true, status = 200 } = {}) {
  mockFetch.mockResolvedValueOnce({
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(payload)
  });
}

describe('tenant bootstrap cache', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    cache.clear();
  });

  it('serves a repeat lookup for the same community from cache', async () => {
    jsonOnce({ data: { id: 2, slug: 'acme', name: 'Acme' } });

    const first = await api.getTenantBootstrap({ slug: 'acme' });
    const second = await api.getTenantBootstrap({ slug: 'acme' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second.data.slug).toBe('acme');
  });

  it('never shares an entry between two communities resolved by slug', async () => {
    jsonOnce({ data: { id: 2, slug: 'acme', name: 'Acme' } });
    jsonOnce({ data: { id: 3, slug: 'beta', name: 'Beta' } });

    const acme = await api.getTenantBootstrap({ slug: 'acme' });
    const beta = await api.getTenantBootstrap({ slug: 'beta' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(acme.data.slug).toBe('acme');
    expect(beta.data.slug).toBe('beta');
  });

  it('never shares an entry between two communities resolved by host', async () => {
    jsonOnce({ data: { id: 2, slug: 'acme', name: 'Acme' } });
    jsonOnce({ data: { id: 3, slug: 'beta', name: 'Beta' } });

    const acme = await api.getTenantBootstrap({ host: 'acme-accessible.test:5180' });
    const beta = await api.getTenantBootstrap({ host: 'beta-accessible.test' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(acme.data.slug).toBe('acme');
    expect(beta.data.slug).toBe('beta');
  });

  it('does not let a slug lookup answer a host lookup', async () => {
    jsonOnce({ data: { id: 2, slug: 'acme' } });
    jsonOnce({ data: { id: 9, slug: 'other' } });

    await api.getTenantBootstrap({ slug: 'acme' });
    const byHost = await api.getTenantBootstrap({ host: 'acme-accessible.test' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(byHost.data.slug).toBe('other');
  });

  it('treats the same host with and without a port as one community', async () => {
    jsonOnce({ data: { id: 2, slug: 'acme' } });

    await api.getTenantBootstrap({ host: 'acme-accessible.test:5180' });
    await api.getTenantBootstrap({ host: 'acme-accessible.test' });

    // The port is stripped before the request is built, so both produce the same
    // upstream call and must not be fetched twice.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refetches the same community for a different language', async () => {
    // 🔴 The response varies by locale: request() forwards it as Accept-Language,
    // so a locale-blind key would serve German visitors the English bootstrap.
    jsonOnce({ data: { id: 2, slug: 'acme', name: 'Acme' } });
    jsonOnce({ data: { id: 2, slug: 'acme', name: 'Acme (Deutsch)' } });

    const english = await runWithRequestLocale('en', () => api.getTenantBootstrap({ slug: 'acme' }));
    const german = await runWithRequestLocale('de', () => api.getTenantBootstrap({ slug: 'acme' }));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(english.data.name).toBe('Acme');
    expect(german.data.name).toBe('Acme (Deutsch)');
  });

  it('still serves a cache hit within one language', async () => {
    jsonOnce({ data: { id: 2, slug: 'acme', name: 'Acme' } });

    await runWithRequestLocale('ga', () => api.getTenantBootstrap({ slug: 'acme' }));
    await runWithRequestLocale('ga', () => api.getTenantBootstrap({ slug: 'acme' }));

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refetches once the entry expires', async () => {
    const realNow = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow);

    try {
      jsonOnce({ data: { id: 2, slug: 'acme', name: 'Before' } });
      jsonOnce({ data: { id: 2, slug: 'acme', name: 'After' } });

      const before = await api.getTenantBootstrap({ slug: 'acme' });
      expect(before.data.name).toBe('Before');

      nowSpy.mockReturnValue(realNow + 31000);

      const after = await api.getTenantBootstrap({ slug: 'acme' });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(after.data.name).toBe('After');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('does not cache a failed lookup', async () => {
    jsonOnce({ error: 'Tenant not found' }, { ok: false, status: 404 });
    jsonOnce({ data: { id: 5, slug: 'later', name: 'Later' } });

    await expect(api.getTenantBootstrap({ slug: 'later' })).rejects.toThrow(api.ApiError);

    // A community created (or a backend recovered) seconds later must resolve,
    // rather than inheriting the cached failure.
    const recovered = await api.getTenantBootstrap({ slug: 'later' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(recovered.data.slug).toBe('later');
  });

  it('does not cache at all when the arguments do not identify a community', async () => {
    jsonOnce({ data: { id: 1, slug: 'from-request-context' } });
    jsonOnce({ data: { id: 1, slug: 'from-request-context' } });

    await api.getTenantBootstrap({});
    await api.getTenantBootstrap({});

    // With no slug and no host the community is resolved per-request downstream,
    // so caching on these arguments could serve the wrong community entirely.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('hands every caller its own copy', async () => {
    jsonOnce({ data: { id: 2, slug: 'acme', modules: { events: true } } });

    const first = await api.getTenantBootstrap({ slug: 'acme' });
    first.data.injected = 'from another request';
    first.data.modules.events = false;

    const second = await api.getTenantBootstrap({ slug: 'acme' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(second.data.injected).toBeUndefined();
    expect(second.data.modules.events).toBe(true);
  });
});
