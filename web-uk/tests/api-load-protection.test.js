// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Load protection for calls to the API (6 Nov 2026). Crawler bursts on the
 * accessible site used up every Apache worker of the API container that also
 * serves the main website and the phone app (Sentry NEXUS-WEBUK-5..8).
 */

const mockFetch = jest.fn();
global.fetch = mockFetch;
process.env.API_BASE_URL = 'http://localhost:5000';
process.env.API_MAX_CONCURRENT_REQUESTS = '3';

const api = require('../src/lib/api');

function deferredResponse() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  const respond = (body) => resolve({
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body
  });
  return { promise, respond };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('API load protection', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('never has more calls in flight than the limit; the rest wait and then run', async () => {
    const pending = [];
    mockFetch.mockImplementation(() => {
      const d = deferredResponse();
      pending.push(d);
      return d.promise;
    });

    const calls = [1, 2, 3, 4, 5].map((id) => api.getUser('member-token', id));
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(api.apiLoadState().inFlight).toBe(3);
    expect(api.apiLoadState().queued).toBe(2);

    pending[0].respond({ data: { id: 1 } });
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(4);

    pending.slice(1).forEach((d) => d.respond({ data: {} }));
    await flush();
    pending.slice(3).forEach((d) => d.respond({ data: {} }));
    await Promise.all(calls);
    expect(mockFetch).toHaveBeenCalledTimes(5);
    expect(api.apiLoadState()).toEqual({ inFlight: 0, queued: 0, shared: 0 });
  });

  it('frees the slot when a call fails, so a run of errors cannot jam the queue', async () => {
    mockFetch.mockRejectedValue(Object.assign(new TypeError('fetch failed'), {}));
    for (let i = 0; i < 6; i += 1) {
      await expect(api.getUser('member-token', i)).rejects.toBeInstanceOf(api.ApiOfflineError);
    }
    expect(api.apiLoadState().inFlight).toBe(0);
  });

  it('shares one call between identical signed-out reads made at the same moment, with separate copies', async () => {
    const d = deferredResponse();
    mockFetch.mockReturnValue(d.promise);

    const a = api.getPlatformStats({ slug: 'acme' });
    const b = api.getPlatformStats({ slug: 'acme' });
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    d.respond({ data: { members: 10 } });
    const [first, second] = await Promise.all([a, b]);
    expect(first).toEqual(second);
    first.data.members = 99;
    expect(second.data.members).toBe(10);
    expect(api.apiLoadState().shared).toBe(0);
  });

  it('does not share reads for different communities, or signed-in reads', async () => {
    mockFetch.mockImplementation(() => {
      const d = deferredResponse();
      d.respond({ data: {} });
      return d.promise;
    });

    await Promise.all([
      api.getPlatformStats({ slug: 'acme' }),
      api.getPlatformStats({ slug: 'other' })
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    mockFetch.mockClear();
    await Promise.all([api.getUser('token-a', 7), api.getUser('token-b', 7)]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not keep a shared answer once the call has finished', async () => {
    mockFetch.mockImplementation(() => {
      const d = deferredResponse();
      d.respond({ data: { n: mockFetch.mock.calls.length } });
      return d.promise;
    });

    const first = await api.getPlatformStats({ slug: 'acme' });
    const second = await api.getPlatformStats({ slug: 'acme' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(first.data.n).toBe(1);
    expect(second.data.n).toBe(2);
  });
});
