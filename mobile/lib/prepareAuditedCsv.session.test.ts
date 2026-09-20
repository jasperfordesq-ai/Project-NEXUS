// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { prepareAuditedCsv } from './prepareAuditedCsv';
import { clearApiSession } from '@/lib/api/client';
import { storage } from '@/lib/storage';
import { fetch as streamFetch } from 'expo/fetch';
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-session-export' }));
jest.mock('expo-file-system', () => ({ Paths: { cache: 'file:///cache' },
  Directory: class { uri = 'file:///cache/test'; exists = true; create() {} delete() {} },
  File: class { uri = 'file:///cache/test/export.csv'; create() {} open() { return { writeBytes: jest.fn(), close: jest.fn() }; } },
}));
jest.mock('@/lib/storage', () => ({ storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() } }));
jest.mock('@/lib/constants', () => ({ API_BASE_URL: 'https://test.api', API_V2: '/api/v2', APP_VERSION: '1', DEFAULT_TENANT: 'synthetic',
  STORAGE_KEYS: { AUTH_TOKEN: 'token', REFRESH_TOKEN: 'refresh', TENANT_SLUG: 'tenant', USER_DATA: 'user' },
  TIMEOUTS: { API_GET: 30000, API_MUTATION: 15000, API_REQUEST: 15000, API_TOKEN_REFRESH: 10000 },
}));
const originalFetch = global.fetch;
let fetchMock: jest.Mock; let stored: Record<string, string>;
function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
const endpoint = '/api/v2/events/42/registration-product/submissions/export';
const evidence = { purpose: 'Synthetic review', correlation_id: 'case-1', include_sensitive: false };
beforeEach(() => {
  clearApiSession(); jest.clearAllMocks(); stored = { token: 'expired-access', refresh: 'valid-refresh', tenant: 'synthetic' };
  jest.mocked(storage.get).mockImplementation(async key => stored[key] ?? null);
  jest.mocked(storage.set).mockImplementation(async (key, value) => { stored[key] = value; });
  jest.mocked(storage.remove).mockImplementation(async key => { delete stored[key]; });
  fetchMock = jest.fn(); global.fetch = fetchMock;
  const read = jest.fn().mockResolvedValueOnce({ done: false, value: new Uint8Array([97, 10]) }).mockResolvedValue({ done: true });
  jest.mocked(streamFetch).mockResolvedValue({ ok: true, status: 200, headers: { get: () => 'text/csv' }, body: { getReader: () => ({ read, releaseLock: jest.fn() }) } } as never);
});
afterEach(() => { clearApiSession(); global.fetch = originalFetch; });
it('renews an expired bearer via a GET retry, persists rotation, then performs exactly one audited native POST', async () => {
  fetchMock.mockResolvedValueOnce(response(401, { message: 'Expired' }))
    .mockResolvedValueOnce(response(200, { access_token: 'renewed-access', refresh_token: 'rotated-refresh' }))
    .mockResolvedValueOnce(response(200, { data: { id: 7 } }));
  const file = await prepareAuditedCsv(endpoint, 'export.csv', evidence, {}, () => true);
  expect(fetchMock.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
    ['https://test.api/api/v2/users/me', 'GET'], ['https://test.api/api/auth/refresh-token', 'POST'], ['https://test.api/api/v2/users/me', 'GET'],
  ]);
  expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer renewed-access');
  expect(stored).toMatchObject({ token: 'renewed-access', refresh: 'rotated-refresh' });
  expect(streamFetch).toHaveBeenCalledTimes(1);
  expect(streamFetch).toHaveBeenCalledWith('https://test.api' + endpoint, expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer renewed-access' }) }));
  file.dispose();
});
it('keeps credentials and never audits when renewal is temporarily unavailable', async () => {
  fetchMock.mockResolvedValueOnce(response(401, { message: 'Expired' })).mockResolvedValueOnce(response(503, { message: 'Unavailable' }));
  await expect(prepareAuditedCsv(endpoint, 'export.csv', evidence, {}, () => true)).rejects.toMatchObject({ status: 0 });
  expect(streamFetch).not.toHaveBeenCalled(); expect(storage.remove).not.toHaveBeenCalled();
  expect(stored).toMatchObject({ token: 'expired-access', refresh: 'valid-refresh' });
});
