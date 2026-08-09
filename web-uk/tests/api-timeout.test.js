// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

describe('API request timeout handling', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    process.env.API_BASE_URL = 'http://localhost:5000';
    process.env.API_REQUEST_TIMEOUT_MS = '1000';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.API_REQUEST_TIMEOUT_MS;
    jest.useRealTimers();
  });

  function abortablePendingFetch() {
    return jest.fn((url, config) => new Promise((resolve, reject) => {
      config.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }));
  }

  it('aborts JSON API requests at the configured deadline', async () => {
    global.fetch = abortablePendingFetch();
    const api = require('../src/lib/api');

    const request = api.login('member@example.test', 'secret', 'acme');
    const rejection = expect(request).rejects.toMatchObject({
      name: 'ApiOfflineError',
      status: 503,
      message: 'The service took too long to respond'
    });

    await jest.advanceTimersByTimeAsync(1000);
    await rejection;
    expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('applies the same deadline to binary downloads', async () => {
    global.fetch = abortablePendingFetch();
    const api = require('../src/lib/api');

    const request = api.downloadResource('test-token', 42);
    const rejection = expect(request).rejects.toMatchObject({
      name: 'ApiOfflineError',
      status: 503,
      message: 'The service took too long to respond'
    });

    await jest.advanceTimersByTimeAsync(1000);
    await rejection;
    expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('clears the deadline after a completed response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ access_token: 'token' }),
      text: async () => ''
    });
    const api = require('../src/lib/api');

    await expect(api.login('member@example.test', 'secret', 'acme'))
      .resolves.toEqual({ access_token: 'token' });
    const signal = global.fetch.mock.calls[0][1].signal;
    await jest.advanceTimersByTimeAsync(1000);
    expect(signal.aborted).toBe(false);
  });
});
