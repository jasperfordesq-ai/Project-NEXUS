// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Mock dependencies — must be declared before imports
jest.mock('@/lib/storage', () => ({
  storage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
}));
jest.mock('@/lib/constants', () => ({
  API_BASE_URL: 'https://test.api',
  APP_VERSION: '1.2.0',
  STORAGE_KEYS: {
    AUTH_TOKEN: 'nexus_auth_token',
    REFRESH_TOKEN: 'nexus_refresh_token',
    TENANT_SLUG: 'nexus_tenant_slug',
    USER_DATA: 'nexus_user_data',
  },
  TIMEOUTS: {
    API_GET: 30_000,
    API_MUTATION: 15_000,
    API_UPLOAD: 60_000,
    API_REQUEST: 15_000,
  },
}));

import { ApiResponseError, api, registerUnauthorizedCallback, registerLegalAcceptanceRequiredCallback, attemptTokenRefresh, __resetRefreshStateForTests } from './client';
import { storage } from '@/lib/storage';
import { updateRequiredStore } from '@/lib/updates/updateRequiredStore';

const mockStorage = storage as jest.Mocked<typeof storage>;

// ---- helpers ----

/** Build a minimal Response-like object that fetch returns */
function mockResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  const ok = status >= 200 && status < 300;
  const headersMap = new Map(Object.entries(init.headers ?? { 'content-type': 'application/json' }));
  return {
    ok,
    status,
    headers: { get: (k: string) => headersMap.get(k.toLowerCase()) ?? null } as unknown as Headers,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

// ---- setup / teardown ----

let fetchMock: jest.Mock;

beforeEach(() => {
  // 🔴 The refresh promise is cached for 2s after it settles (a deliberate grace window so
  // a late 401 reuses the fresh token). Without this reset a test inherits the previous
  // test's refresh result — which is precisely how the three-way-result change first
  // "failed" 16 tests that were actually fine.
  __resetRefreshStateForTests();
  jest.useFakeTimers();
  fetchMock = jest.fn();
  global.fetch = fetchMock;

  // Default storage: authenticated user with tenant
  mockStorage.get.mockImplementation(async (key: string) => {
    if (key === 'nexus_auth_token') return 'test-token';
    if (key === 'nexus_tenant_slug') return 'hour-timebank';
    if (key === 'nexus_refresh_token') return 'test-refresh-token';
    return null;
  });
  mockStorage.set.mockResolvedValue(undefined);
  mockStorage.remove.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  // Reset the module-level _refreshPromise by advancing past the grace timer
  // (attemptTokenRefresh caches for 2s)
  jest.clearAllTimers();
});

// ---- Tests ----

describe('ApiResponseError', () => {
  it('constructs with status, message, and errors', () => {
    const errors = { email: ['is required', 'must be valid'] };
    const err = new ApiResponseError(422, 'Validation failed', errors);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiResponseError');
    expect(err.status).toBe(422);
    expect(err.message).toBe('Validation failed');
    expect(err.errors).toEqual(errors);
  });

  it('constructs without errors parameter', () => {
    const err = new ApiResponseError(500, 'Internal error');

    expect(err.status).toBe(500);
    expect(err.message).toBe('Internal error');
    expect(err.errors).toBeUndefined();
  });
});

describe('api.get', () => {
  it('makes GET request with correct URL, auth header, and tenant header', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ data: [1, 2, 3] }));

    const result = await api.get<{ data: number[] }>('/api/v2/users');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://test.api/api/v2/users');
    expect(options.method).toBe('GET');
    expect(options.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
      'X-Tenant-Slug': 'hour-timebank',
      'X-Nexus-Mobile': '1',
    });
    expect(result).toEqual({ data: [1, 2, 3] });
  });

  it('appends query params to the URL', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ results: [] }));

    await api.get('/api/v2/search', { q: 'hello', page: '2' });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('q=hello');
    expect(url).toContain('page=2');
  });

  it('merges caller-provided negotiation headers without replacing auth or tenant headers', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ data: [] }));

    await api.get('/api/v2/events', { when: 'upcoming' }, {
      headers: {
        'X-Events-Contract': '2',
        Authorization: 'Bearer untrusted',
        'X-Tenant-Slug': 'other-tenant',
      },
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).toMatchObject({
      'X-Events-Contract': '2',
      Authorization: 'Bearer test-token',
      'X-Tenant-Slug': 'hour-timebank',
    });
  });

  /**
   * 🔴 `anonymous` exists because of a measured dead end, not a tidiness idea. A member who
   * switched to a community their account is not in got 403 on every request, INCLUDING the
   * public community list the picker is built from — so the one screen that could have put
   * them back said "Could not load communities". Sending the token is what broke it.
   */
  it('omits the stored token when a request is marked anonymous', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ data: [] }));

    await api.get('/api/v2/tenants', undefined, { anonymous: true });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
    // The community header still goes out: the list is public, not tenant-less.
    expect(options.headers['X-Tenant-Slug']).toBe('hour-timebank');
  });

  it('still refuses a caller-supplied token on an anonymous request', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ data: [] }));

    await api.get('/api/v2/tenants', undefined, {
      anonymous: true,
      headers: { Authorization: 'Bearer smuggled' },
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('keeps sending the token on every request that did not ask to be anonymous', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ data: [] }));

    await api.get('/api/v2/users');

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer test-token');
  });

  it('omits Authorization header when no token is stored', async () => {
    mockStorage.get.mockImplementation(async (key: string) => {
      if (key === 'nexus_tenant_slug') return 'hour-timebank';
      return null;
    });
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: true }));

    await api.get('/api/v2/public');

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('omits X-Tenant-Slug header when no tenant is stored', async () => {
    mockStorage.get.mockImplementation(async (key: string) => {
      if (key === 'nexus_auth_token') return 'test-token';
      return null;
    });
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: true }));

    await api.get('/api/v2/tenants');

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers['X-Tenant-Slug']).toBeUndefined();
  });
});

describe('api.post', () => {
  it('makes POST request with JSON body', async () => {
    const payload = { name: 'Test', email: 'test@example.com' };
    fetchMock.mockResolvedValueOnce(mockResponse({ id: 1 }));

    const result = await api.post<{ id: number }>('/api/v2/users', payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://test.api/api/v2/users');
    expect(options.method).toBe('POST');
    expect(options.body).toBe(JSON.stringify(payload));
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(result).toEqual({ id: 1 });
  });

  it('uses a freshly issued login token before encrypted storage can read it', async () => {
    mockStorage.get.mockImplementation(async (key: string) =>
      key === 'nexus_tenant_slug' ? 'partner-demo' : null
    );
    fetchMock
      .mockResolvedValueOnce(mockResponse({ access_token: 'fresh-login-token' }))
      .mockResolvedValueOnce(mockResponse({ data: [] }));

    await api.post('/api/auth/login', { email: 'member@example.test', password: 'secret' });
    await api.get('/api/v2/feed');

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-login-token');
    expect(fetchMock.mock.calls[1][1].headers['X-Tenant-Slug']).toBe('partner-demo');
  });

  it('clears the in-process token after a successful logout', async () => {
    mockStorage.get.mockImplementation(async (key: string) =>
      key === 'nexus_tenant_slug' ? 'partner-demo' : null
    );
    fetchMock
      .mockResolvedValueOnce(mockResponse({ token: 'fresh-login-token' }))
      .mockResolvedValueOnce(mockResponse({ success: true }))
      .mockResolvedValueOnce(mockResponse({ data: [] }));

    await api.post('/api/auth/login', {});
    await api.post('/api/auth/logout');
    await api.get('/api/v2/feed');

    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-login-token');
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBeUndefined();
  });
});

describe('api.upload', () => {
  it('sends FormData without Content-Type header', async () => {
    const formData = new FormData();
    formData.append('file', 'fake-file-data');
    fetchMock.mockResolvedValueOnce(mockResponse({ url: '/uploads/file.jpg' }));

    const result = await api.upload<{ url: string }>('/api/v2/upload', formData);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('POST');
    // Content-Type must NOT be set for FormData — React Native sets the multipart boundary
    expect(options.headers['Content-Type']).toBeUndefined();
    expect(options.headers.Accept).toBe('application/json');
    expect(options.body).toBe(formData);
    expect(result).toEqual({ url: '/uploads/file.jpg' });
  });
});

describe('api.put', () => {
  it('makes PUT request', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ updated: true }));

    await api.put('/api/v2/users/1', { name: 'Updated' });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('PUT');
  });
});

describe('api.patch', () => {
  it('makes PATCH request', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ patched: true }));

    await api.patch('/api/v2/users/1', { name: 'Patched' });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('PATCH');
  });
});

describe('api.delete', () => {
  it('makes DELETE request without body', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(null, { status: 204, headers: {} }));

    await api.delete('/api/v2/users/1');

    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('DELETE');
    expect(options.body).toBeUndefined();
  });

  /**
   * 🔴 `api.delete()` hardcoded `undefined` as its body until 2026-08-25, so any data
   * handed to it vanished without a word — `cancelExchangeRequest` still routes its
   * reason through the query string because of it. Account deletion forced the fix:
   * `DELETE /v2/users/me` requires the member's password, and a password in a URL is
   * written to server logs, proxy logs and crash reports.
   */
  it('sends options.body as the request body', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ success: true }));

    await api.delete('/api/v2/users/me', { body: { password: 'hunter2' } });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('DELETE');
    expect(JSON.parse(options.body as string)).toEqual({ password: 'hunter2' });
  });

  it('does not mistake a body-only options object for query parameters', async () => {
    // The legacy two-signature detection decides "options or params?" by looking for
    // known option keys. Before `body` joined that list, `{ body: {...} }` was read as a
    // params bag and produced `?body=%5Bobject%20Object%5D` — the password would have
    // been in the URL as well as the body.
    fetchMock.mockResolvedValueOnce(mockResponse({ success: true }));

    await api.delete('/api/v2/users/me', { body: { password: 'hunter2' } });

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://test.api/api/v2/users/me');
  });
});

describe('204 No Content response', () => {
  it('returns null without attempting to parse JSON', async () => {
    const res = mockResponse(null, { status: 204, headers: { 'content-type': 'application/json' } });
    fetchMock.mockResolvedValueOnce(res);

    const result = await api.delete('/api/v2/items/1');

    expect(result).toBeNull();
    // json() should NOT have been called for 204
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('error responses', () => {
  it('throws ApiResponseError with server message and validation errors', async () => {
    const errorBody = {
      message: 'Validation failed',
      errors: { email: ['The email field is required.'] },
    };
    fetchMock.mockResolvedValueOnce(mockResponse(errorBody, { status: 422 }));

    await expect(api.post('/api/v2/users', {})).rejects.toThrow(ApiResponseError);

    // Re-test with a fresh fetch call for detailed assertions
    fetchMock.mockResolvedValueOnce(mockResponse(errorBody, { status: 422 }));
    try {
      await api.post('/api/v2/users', {});
      fail('Expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseError);
      const apiErr = err as ApiResponseError;
      expect(apiErr.status).toBe(422);
      expect(apiErr.message).toBe('Validation failed');
      expect(apiErr.errors).toEqual({ email: ['The email field is required.'] });
    }
  });

  it('uses default message when server provides none', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({}, { status: 500 }));

    await expect(api.get('/api/v2/fail')).rejects.toThrow('Request failed with status 500');
  });
});

describe('machine error codes', () => {
  it('keeps the code from a v2 error envelope', async () => {
    // 🔴 Only the MESSAGE used to be kept, so the app could tell that something was
    // refused but never WHY — and could not respond by showing the right screen.
    // Every failed precondition looked like a generic error.
    fetchMock.mockResolvedValueOnce(
      mockResponse(
        { errors: [{ code: 'LEGAL_ACCEPTANCE_REQUIRED', message: 'Please accept' }], success: false },
        { status: 403 },
      ),
    );

    try {
      await api.post('/api/v2/comments', {});
      fail('Expected to throw');
    } catch (err) {
      const apiErr = err as ApiResponseError;
      expect(apiErr.code).toBe('LEGAL_ACCEPTANCE_REQUIRED');
      expect(apiErr.status).toBe(403);
      expect(apiErr.message).toBe('Please accept');
    }
  });

  it('accepts a top-level code too', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ code: 'ONBOARDING_REQUIRED' }, { status: 403 }));

    try {
      await api.get('/api/v2/anything');
      fail('Expected to throw');
    } catch (err) {
      expect((err as ApiResponseError).code).toBe('ONBOARDING_REQUIRED');
    }
  });

  it('leaves the code undefined when the server sent none', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ message: 'Nope' }, { status: 400 }));

    try {
      await api.get('/api/v2/anything');
      fail('Expected to throw');
    } catch (err) {
      expect((err as ApiResponseError).code).toBeUndefined();
    }
  });

  it('skips an entry whose code is blank rather than reporting an empty code', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ errors: [{ code: '' }, { code: 'REAL_CODE' }] }, { status: 400 }),
    );

    try {
      await api.get('/api/v2/anything');
      fail('Expected to throw');
    } catch (err) {
      expect((err as ApiResponseError).code).toBe('REAL_CODE');
    }
  });
});

describe('the legal acceptance callback', () => {
  it('fires once when the gate refuses a request, and still throws', async () => {
    // Registered centrally rather than at each of the app's 562 call sites: a
    // refusal only some screens knew about would show as a generic error on all
    // the others.
    const onGate = jest.fn();
    registerLegalAcceptanceRequiredCallback(onGate);

    fetchMock.mockResolvedValueOnce(
      mockResponse(
        { errors: [{ code: 'LEGAL_ACCEPTANCE_REQUIRED', message: 'Please accept' }] },
        { status: 403 },
      ),
    );

    await expect(api.post('/api/v2/comments', {})).rejects.toThrow(ApiResponseError);
    expect(onGate).toHaveBeenCalledTimes(1);

    registerLegalAcceptanceRequiredCallback(() => {});
  });

  it('does not fire for an unrelated refusal', async () => {
    const onGate = jest.fn();
    registerLegalAcceptanceRequiredCallback(onGate);

    fetchMock.mockResolvedValueOnce(
      mockResponse({ errors: [{ code: 'AUTH_INSUFFICIENT_PERMISSIONS' }] }, { status: 403 }),
    );

    await expect(api.get('/api/v2/admin/thing')).rejects.toThrow(ApiResponseError);
    expect(onGate).not.toHaveBeenCalled();

    registerLegalAcceptanceRequiredCallback(() => {});
  });
});

describe('token refresh on 401', () => {
  it('refreshes token and retries original request on 401', async () => {
    // First call: 401
    fetchMock.mockResolvedValueOnce(mockResponse({}, { status: 401 }));
    // Refresh call: success
    fetchMock.mockResolvedValueOnce(
      mockResponse({ access_token: 'new-token', refresh_token: 'new-refresh' }),
    );
    // Retry call: success
    fetchMock.mockResolvedValueOnce(mockResponse({ data: 'refreshed' }));

    const result = await api.get<{ data: string }>('/api/v2/me');

    // 3 fetch calls: original, refresh, retry
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Refresh call went to the right endpoint
    const [refreshUrl, refreshOptions] = fetchMock.mock.calls[1];
    expect(refreshUrl).toBe('https://test.api/api/auth/refresh-token');
    expect(refreshOptions.method).toBe('POST');
    expect(refreshOptions.headers['X-Nexus-Mobile']).toBe('1');
    expect(JSON.parse(refreshOptions.body)).toEqual({ refresh_token: 'test-refresh-token' });

    // Retry used the new token
    const [, retryOptions] = fetchMock.mock.calls[2];
    expect(retryOptions.headers.Authorization).toBe('Bearer new-token');

    // New tokens were saved
    expect(mockStorage.set).toHaveBeenCalledWith('nexus_auth_token', 'new-token');
    expect(mockStorage.set).toHaveBeenCalledWith('nexus_refresh_token', 'new-refresh');

    expect(result).toEqual({ data: 'refreshed' });

    // Advance past the 2s grace timer so the next test starts clean
    jest.advanceTimersByTime(3000);
  });

  it('calls unauthorized callback and throws when refresh fails', async () => {
    const unauthorizedCb = jest.fn();
    registerUnauthorizedCallback(unauthorizedCb);

    // First call: 401
    fetchMock.mockResolvedValueOnce(mockResponse({}, { status: 401 }));
    // Refresh call: fails (e.g. refresh token expired)
    fetchMock.mockResolvedValueOnce(mockResponse({}, { status: 401 }));

    await expect(api.get('/api/v2/me')).rejects.toThrow('Your session has expired');

    // Credentials were cleared
    expect(mockStorage.remove).toHaveBeenCalledWith('nexus_auth_token');
    expect(mockStorage.remove).toHaveBeenCalledWith('nexus_refresh_token');
    expect(mockStorage.remove).toHaveBeenCalledWith('nexus_user_data');

    // Callback was invoked
    expect(unauthorizedCb).toHaveBeenCalledTimes(1);

    // Clean up
    registerUnauthorizedCallback(jest.fn());
    jest.advanceTimersByTime(3000);
  });

  it('calls unauthorized callback when no refresh token is stored', async () => {
    const unauthorizedCb = jest.fn();
    registerUnauthorizedCallback(unauthorizedCb);

    // No refresh token in storage
    mockStorage.get.mockImplementation(async (key: string) => {
      if (key === 'nexus_auth_token') return 'test-token';
      if (key === 'nexus_tenant_slug') return 'hour-timebank';
      return null; // no refresh token
    });

    // First call: 401
    fetchMock.mockResolvedValueOnce(mockResponse({}, { status: 401 }));

    await expect(api.get('/api/v2/me')).rejects.toThrow('Your session has expired');
    expect(unauthorizedCb).toHaveBeenCalled();

    registerUnauthorizedCallback(jest.fn());
    jest.advanceTimersByTime(3000);
  });
});

describe('concurrent token refresh', () => {
  it('collapses multiple 401 refresh attempts into a single refresh request', async () => {
    // Both calls return 401
    fetchMock.mockResolvedValueOnce(mockResponse({}, { status: 401 }));
    fetchMock.mockResolvedValueOnce(mockResponse({}, { status: 401 }));
    // Single refresh call
    fetchMock.mockResolvedValueOnce(
      mockResponse({ access_token: 'shared-new-token' }),
    );
    // Both retries succeed
    fetchMock.mockResolvedValueOnce(mockResponse({ id: 1 }));
    fetchMock.mockResolvedValueOnce(mockResponse({ id: 2 }));

    const [r1, r2] = await Promise.all([
      api.get<{ id: number }>('/api/v2/users/1'),
      api.get<{ id: number }>('/api/v2/users/2'),
    ]);

    // Count refresh calls (POST to /api/auth/refresh-token)
    const refreshCalls = fetchMock.mock.calls.filter(
      ([url, opts]: [string, RequestInit]) =>
        url.includes('/api/auth/refresh-token') && opts.method === 'POST',
    );
    expect(refreshCalls).toHaveLength(1);

    expect(r1).toEqual({ id: 1 });
    expect(r2).toEqual({ id: 2 });

    jest.advanceTimersByTime(3000);
  });
});

describe('network error', () => {
  it('throws ApiResponseError with status 0 on fetch failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

    try {
      await api.get('/api/v2/me');
      fail('Expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseError);
      const apiErr = err as ApiResponseError;
      expect(apiErr.status).toBe(0);
      expect(apiErr.message).toBe('Network error. Please check your connection.');
    }
  });
});

describe('timeout', () => {
  it('throws ApiResponseError with timeout message when request is aborted', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(abortError);

    try {
      await api.get('/api/v2/slow');
      fail('Expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseError);
      const apiErr = err as ApiResponseError;
      expect(apiErr.status).toBe(0);
      expect(apiErr.message).toBe('Request timed out. Please check your connection.');
    }
  });
});

describe('attemptTokenRefresh', () => {
  it('returns new token on successful refresh', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ access_token: 'refreshed-token', refresh_token: 'new-refresh' }),
    );

    const result = await attemptTokenRefresh();

    // Contract changed from `string | null` to a three-way result so the caller can tell a
    // refused refresh token from an unreachable server. See TokenRefreshResult.
    expect(result).toEqual({ status: 'refreshed', token: 'refreshed-token' });
    expect(mockStorage.set).toHaveBeenCalledWith('nexus_auth_token', 'refreshed-token');
    expect(mockStorage.set).toHaveBeenCalledWith('nexus_refresh_token', 'new-refresh');

    jest.advanceTimersByTime(3000);
  });

  it('reports the session ended when no refresh token is stored', async () => {
    mockStorage.get.mockImplementation(async (key: string) => {
      if (key === 'nexus_tenant_slug') return 'hour-timebank';
      return null;
    });

    const result = await attemptTokenRefresh();

    // Nothing to renew with is a genuine end-of-session, not a failure to reach the server.
    expect(result).toEqual({ status: 'rejected' });
    expect(fetchMock).not.toHaveBeenCalled();

    jest.advanceTimersByTime(3000);
  });

  it('reports the session ended when the refresh endpoint refuses', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({}, { status: 401 }));

    const result = await attemptTokenRefresh();

    // 401/403 only. A 5xx or 429 now reports `unreachable` instead — see the
    // "cannot REACH the server" suite below for why that distinction matters.
    expect(result).toEqual({ status: 'rejected' });

    jest.advanceTimersByTime(3000);
  });

  it('accepts token field as fallback for access_token', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ token: 'fallback-token' }),
    );

    const result = await attemptTokenRefresh();

    expect(result).toEqual({ status: 'refreshed', token: 'fallback-token' });
    expect(mockStorage.set).toHaveBeenCalledWith('nexus_auth_token', 'fallback-token');

    jest.advanceTimersByTime(3000);
  });
});

describe('registerUnauthorizedCallback', () => {
  it('registers a callback that is invoked on unrecoverable 401', async () => {
    const cb = jest.fn();
    registerUnauthorizedCallback(cb);

    // No refresh token available
    mockStorage.get.mockImplementation(async (key: string) => {
      if (key === 'nexus_auth_token') return 'expired';
      if (key === 'nexus_tenant_slug') return 'hour-timebank';
      return null;
    });

    fetchMock.mockResolvedValueOnce(mockResponse({}, { status: 401 }));

    await expect(api.get('/api/v2/me')).rejects.toThrow(ApiResponseError);
    expect(cb).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(3000);
  });
});

// ---------------------------------------------------------------------------
// Session expiry vs an unreachable server
//
// 🔴 These exist because the two were indistinguishable. `attemptTokenRefresh` returned
// `null` both when the server REFUSED the refresh token and when the request never
// completed, and the caller treated both as expiry — signing the member out and firing the
// sign-out callback, which purges the offline event check-in queue. A member on a bad
// connection could lose an attendance roster they had just collected, with no explanation.
//
// The distinction is now a three-way result, and these assert both sides of it.
// ---------------------------------------------------------------------------

describe('a refresh the server REFUSES', () => {
  beforeEach(() => {
    mockStorage.get.mockImplementation(async (key: string) =>
      key === 'nexus_auth_token' ? 'stale-token' : key === 'nexus_refresh_token' ? 'refresh-token' : null
    );
  });

  it('reports the session as ended', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({}, { status: 401 })); // 401 refresh
    expect(await attemptTokenRefresh()).toEqual({ status: 'rejected' });
  });

  it.each([401, 403])('treats %s on the refresh endpoint as the end of the session', async (status) => {
    fetchMock.mockResolvedValueOnce(mockResponse({}, { status }));
    expect(await attemptTokenRefresh()).toEqual({ status: 'rejected' });
  });

  it('reports ended when there is no refresh token to renew with', async () => {
    mockStorage.get.mockImplementation(async () => null);
    // Nothing to renew is a genuine end-of-session, not a failure to reach the server.
    expect(await attemptTokenRefresh()).toEqual({ status: 'rejected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('🔴 a refresh that cannot REACH the server', () => {
  beforeEach(() => {
    // `remove` accumulates across the file, so the "did NOT remove" assertions below would
    // otherwise read another test's calls and fail for the wrong reason.
    mockStorage.remove.mockClear();
    mockStorage.get.mockImplementation(async (key: string) =>
      key === 'nexus_auth_token' ? 'stale-token' : key === 'nexus_refresh_token' ? 'refresh-token' : null
    );
  });

  it('reports unreachable when the request throws', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect(await attemptTokenRefresh()).toEqual({ status: 'unreachable' });
  });

  it.each([500, 502, 503, 429])('treats %s as unreachable, not as expiry', async (status) => {
    // A server error or a rate limit means "cannot answer right now". Signing people out
    // during an incident is the worst possible moment to also wipe their queued check-ins.
    fetchMock.mockResolvedValueOnce(mockResponse({}, { status }));
    expect(await attemptTokenRefresh()).toEqual({ status: 'unreachable' });
  });

  it('treats a 200 carrying no token as unreachable rather than expiry', async () => {
    // The server contradicting itself is not a reason to destroy anything.
    fetchMock.mockResolvedValueOnce(mockResponse({ refresh_token: 'only-this' }, { status: 200 }));
    expect(await attemptTokenRefresh()).toEqual({ status: 'unreachable' });
  });

  it('🔴 does NOT sign the member out, and leaves their stored tokens alone', async () => {
    const onUnauthorized = jest.fn();
    registerUnauthorizedCallback(onUnauthorized);

    fetchMock
      .mockResolvedValueOnce(mockResponse({}, { status: 401 }))          // the original request
      .mockRejectedValueOnce(new TypeError('Network request failed'));   // the refresh attempt

    // Surfaced as the network failure it is (status 0), so the screen can offer a retry.
    await expect(api.get('/api/v2/wallet/balance')).rejects.toMatchObject({ status: 0 });

    // The assertions that matter: the sign-out callback is what purges the offline
    // check-in queue, and removing the tokens is what makes the logout stick.
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(mockStorage.remove).not.toHaveBeenCalledWith('nexus_auth_token');
    expect(mockStorage.remove).not.toHaveBeenCalledWith('nexus_refresh_token');
    expect(mockStorage.remove).not.toHaveBeenCalledWith('nexus_user_data');
  });

  it('signs the member out when the refresh really is refused', async () => {
    const onUnauthorized = jest.fn();
    registerUnauthorizedCallback(onUnauthorized);

    fetchMock
      .mockResolvedValueOnce(mockResponse({}, { status: 401 }))  // the original request
      .mockResolvedValueOnce(mockResponse({}, { status: 401 })); // the refresh, refused

    await expect(api.get('/api/v2/wallet/balance')).rejects.toMatchObject({ status: 401 });

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(mockStorage.remove).toHaveBeenCalledWith('nexus_auth_token');
    expect(mockStorage.remove).toHaveBeenCalledWith('nexus_refresh_token');
    expect(mockStorage.remove).toHaveBeenCalledWith('nexus_user_data');
  });
});

// ---------------------------------------------------------------------------
// The app version header
//
// 🔴 This is the un-retrofittable half of a force-update lever. The API can already tell a
// request came from the mobile app, but not WHICH VERSION — so it has no way to refuse a
// build that must stop being used. An over-the-air update only reaches devices whose runtime
// version still matches, so a broken NATIVE build cannot be reached any other way.
//
// A binary already on someone's phone cannot be taught to send a header it was not built
// with. Every release that ships without this one is permanently un-retirable, which is why
// it lands before the server-side refusal exists.
// ---------------------------------------------------------------------------

describe('X-Nexus-Mobile-Version', () => {
  beforeEach(() => {
    mockStorage.get.mockImplementation(async (key: string) =>
      key === 'nexus_auth_token' ? 'token' : null
    );
  });

  it('is sent on an ordinary request', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: true }));

    await api.get('/api/v2/wallet/balance');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Nexus-Mobile-Version']).toBe('1.2.0');
    // Sent alongside, not instead of, the existing marker.
    expect((init.headers as Record<string, string>)['X-Nexus-Mobile']).toBe('1');
  });

  it('is sent on the refresh request too', async () => {
    // The refresh endpoint builds its own headers, so it is a separate code path — and a
    // version-gated API would refuse the refresh of a retired build as readily as any other
    // call.
    mockStorage.get.mockImplementation(async (key: string) =>
      key === 'nexus_refresh_token' ? 'refresh-token' : null
    );
    fetchMock.mockResolvedValueOnce(mockResponse({ access_token: 'fresh' }));

    await attemptTokenRefresh();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Nexus-Mobile-Version']).toBe('1.2.0');
    jest.advanceTimersByTime(3000);
  });

  it('is sent on the retry after a refresh', async () => {
    // The retry rebuilds headers from the originals; if it dropped the version a
    // version-gated API would see an inconsistent client.
    mockStorage.get.mockImplementation(async (key: string) =>
      key === 'nexus_auth_token' ? 'stale' : key === 'nexus_refresh_token' ? 'refresh-token' : null
    );
    fetchMock
      .mockResolvedValueOnce(mockResponse({}, { status: 401 }))
      .mockResolvedValueOnce(mockResponse({ access_token: 'fresh' }))
      .mockResolvedValueOnce(mockResponse({ ok: true }));

    await api.get('/api/v2/wallet/balance');

    const [, retryInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect((retryInit.headers as Record<string, string>)['X-Nexus-Mobile-Version']).toBe('1.2.0');
    jest.advanceTimersByTime(3000);
  });
});

describe('a 426 from the version gate', () => {
  // 🔴 The join between the two halves of the force-update lever. The server refuses an
  // old build (App\Http\Middleware\EnforceMobileMinimumVersion); this is the code that
  // turns that refusal into something the member can act on. Without it, a refused build
  // shows unexplained failures on every screen and the whole lever is inert.

  const REFUSAL = {
    success: false,
    error: { code: 'APP_UPDATE_REQUIRED', message: 'no longer supported' },
    client_version: '1.1.0',
    minimum_version: '1.2.0',
    current_version: '1.3.0',
    update_url: 'https://mobile.project-nexus.ie',
  };

  beforeEach(() => {
    updateRequiredStore.__resetForTests();
    // 🔴 mockClear, not just the store reset. `mockStorage.remove` accumulates calls
    // across every test in this file, so "was the member signed out?" would see an
    // earlier test's sign-out and fail for a reason that has nothing to do with 426.
    // This exact leak has now caused a false failure twice in this suite.
    mockStorage.remove.mockClear();
  });

  it('records what the server said', async () => {
    fetchMock.mockResolvedValue(mockResponse(REFUSAL, { status: 426 }));

    await expect(api.get('/api/v2/feed')).rejects.toThrow();

    expect(updateRequiredStore.getSnapshot()).toEqual({
      clientVersion: '1.1.0',
      minimumVersion: '1.2.0',
      currentVersion: '1.3.0',
      updateUrl: 'https://mobile.project-nexus.ie',
    });
  });

  it('still throws, so a caller cannot mistake a refusal for success', async () => {
    // A caller that treated 426 as success would render an empty screen behind the
    // blocking one.
    fetchMock.mockResolvedValue(mockResponse(REFUSAL, { status: 426 }));

    await expect(api.get('/api/v2/feed')).rejects.toBeInstanceOf(ApiResponseError);
  });

  it('does not sign the member out', async () => {
    // The reason it is 426 and not 403: the client treats 401/403 as a session decision
    // and would clear the session instead of asking for an update.
    fetchMock.mockResolvedValue(mockResponse(REFUSAL, { status: 426 }));

    await expect(api.get('/api/v2/feed')).rejects.toThrow();

    expect(mockStorage.remove).not.toHaveBeenCalled();
  });

  it('is not triggered by any other error status', async () => {
    for (const status of [400, 401, 403, 404, 409, 422, 500, 503]) {
      updateRequiredStore.__resetForTests();
      __resetRefreshStateForTests();
      fetchMock.mockResolvedValue(mockResponse({ error: { code: 'NOPE' } }, { status }));

      await api.get('/api/v2/feed').catch(() => undefined);

      expect(updateRequiredStore.getSnapshot()).toBeNull();
      jest.advanceTimersByTime(3000);
    }
  });

  it('survives a 426 whose body is not what we expect', async () => {
    // The one response the app cannot afford to mishandle: throwing while handling it
    // would leave failures everywhere with no explanation.
    fetchMock.mockResolvedValue(mockResponse('a plain string', { status: 426 }));

    await expect(api.get('/api/v2/feed')).rejects.toThrow();

    expect(updateRequiredStore.getSnapshot()).toEqual({
      clientVersion: '',
      minimumVersion: '',
      currentVersion: '',
      updateUrl: '',
    });
  });
});
