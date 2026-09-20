// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { prepareAuditedCsv } from './prepareAuditedCsv';
import { fetch } from 'expo/fetch';
import { api, authenticatedApiIdentity } from '@/lib/api/client';
const mockWrite = jest.fn(), mockClose = jest.fn(), mockDelete = jest.fn(), mockCreate = jest.fn();
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-export' }));
jest.mock('expo-file-system', () => ({ Paths: { cache: 'file:///cache' },
  Directory: class { uri = 'file:///cache/export'; exists = true; create() { mockCreate(); } delete() { mockDelete(); } },
  File: class { uri = 'file:///cache/export/export.csv'; create() {} open() { return { writeBytes: mockWrite, close: mockClose }; } },
}));
jest.mock('@/lib/constants', () => ({ API_BASE_URL: 'https://api.example.test', APP_VERSION: '1', API_V2: '/api/v2' }));
jest.mock('@/lib/api/client', () => ({ api: { get: jest.fn() }, authenticatedApiIdentity: jest.fn(), ApiResponseError: class extends Error {
  status: number; constructor(status: number, message: string) { super(message); this.status = status; }
} }));
const mockIdentity = jest.fn(); const active = () => true;
const endpoint = '/api/v2/events/1/registration-product/submissions/export';
const input = { purpose: 'Synthetic audit', correlation_id: 'case-1', include_sensitive: false };
function response(chunks = [new Uint8Array([97, 44, 98, 10]), new Uint8Array([49, 44, 50, 10])]) {
  const read = jest.fn(); for (const value of chunks) read.mockResolvedValueOnce({ done: false, value });
  read.mockResolvedValue({ done: true });
  return { ok: true, status: 200, headers: { get: () => 'text/csv; charset=UTF-8' }, body: { getReader: () => ({ read, releaseLock: jest.fn() }) } };
}
beforeEach(() => { jest.clearAllMocks(); jest.mocked(api.get).mockReset(); mockWrite.mockReset(); mockIdentity.mockReset();
  jest.mocked(authenticatedApiIdentity).mockResolvedValue({ token: 'test-token', tenantSlug: 'test-tenant', assertCurrent: mockIdentity });
  jest.mocked(fetch).mockResolvedValue(response() as never);
});
it('streams chunks using one audited POST, returns an explicit cleanup handle and prevents header overrides', async () => {
  const file = await prepareAuditedCsv(endpoint, 'export.csv', input, { authorization: 'wrong', 'X-Tenant-Slug': 'wrong', 'X-Events-Contract': '2' }, active);
  expect(fetch).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledWith('https://api.example.test' + endpoint, expect.objectContaining({ method: 'POST', redirect: 'error', body: JSON.stringify(input),
    headers: expect.objectContaining({ Authorization: 'Bearer test-token', 'X-Tenant-Slug': 'test-tenant', 'X-Events-Contract': '2' }) }));
  expect(mockWrite.mock.calls).toEqual([[new Uint8Array([97, 44, 98, 10])], [new Uint8Array([49, 44, 50, 10])]]);
  expect(mockClose).toHaveBeenCalledTimes(1); expect(mockDelete).not.toHaveBeenCalled();
  file.dispose(); expect(mockDelete).toHaveBeenCalledTimes(1);
});
it.each(['https://other.example/file', '//other.example/file', '/outside'])('refuses unsafe targets before authentication %s', async path => {
  await expect(prepareAuditedCsv(path, 'export.csv', input, {}, active)).rejects.toThrow(); expect(authenticatedApiIdentity).not.toHaveBeenCalled();
});
it('rejects traversal filenames and inactive actions before transport', async () => {
  await expect(prepareAuditedCsv(endpoint, '../file.csv', input, {}, active)).rejects.toThrow();
  await expect(prepareAuditedCsv(endpoint, 'file.csv', input, {}, () => false)).rejects.toThrow('download_cancelled'); expect(fetch).not.toHaveBeenCalled();
});
it.each([401, 403, 422, 500])('never writes or retries an HTTP %s response', async status => {
  jest.mocked(fetch).mockResolvedValue({ ...response(), ok: false, status } as never);
  await expect(prepareAuditedCsv(endpoint, 'export.csv', input, {}, active)).rejects.toMatchObject({ status });
  expect(mockCreate).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(1);
});
it('rejects a non-CSV response without writing it', async () => {
  jest.mocked(fetch).mockResolvedValue({ ...response(), headers: { get: () => 'application/json' } } as never);
  await expect(prepareAuditedCsv(endpoint, 'export.csv', input, {}, active)).rejects.toThrow('invalid_export_response'); expect(mockWrite).not.toHaveBeenCalled();
});
it('closes and deletes a partial file after a disk failure', async () => {
  const error = new Error('disk full'); mockWrite.mockImplementationOnce(() => { throw error; });
  await expect(prepareAuditedCsv(endpoint, 'export.csv', input, {}, active)).rejects.toBe(error);
  expect(mockClose).toHaveBeenCalledTimes(1); expect(mockDelete).toHaveBeenCalledTimes(1);
});
it('rejects an empty stream and removes its file', async () => {
  jest.mocked(fetch).mockResolvedValue(response([]) as never);
  await expect(prepareAuditedCsv(endpoint, 'export.csv', input, {}, active)).rejects.toThrow('empty_export_response'); expect(mockDelete).toHaveBeenCalledTimes(1);
});
it('removes the file when account identity changes before handoff', async () => {
  mockWrite.mockImplementationOnce(() => { mockIdentity.mockRejectedValue(new Error('account changed')); });
  await expect(prepareAuditedCsv(endpoint, 'export.csv', input, {}, active)).rejects.toThrow('account changed'); expect(mockDelete).toHaveBeenCalledTimes(1);
});
it('stops writing when the originating screen departs', async () => {
  let visible = true; mockWrite.mockImplementationOnce(() => { visible = false; });
  await expect(prepareAuditedCsv(endpoint, 'export.csv', input, {}, () => visible)).rejects.toThrow('download_cancelled');
  expect(mockWrite).toHaveBeenCalledTimes(1); expect(mockDelete).toHaveBeenCalledTimes(1);
});

it.each([250, 120000])('aborts an outstanding native request on departure or timeout (%s ms)', async duration => {
  jest.useFakeTimers(); let visible = true;
  jest.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  try {
    const pending = prepareAuditedCsv(endpoint, 'export.csv', input, {}, () => visible);
    const rejected = expect(pending).rejects.toThrow('aborted');
    await jest.advanceTimersByTimeAsync(0);
    if (duration === 250) visible = false;
    await jest.advanceTimersByTimeAsync(duration);
    await rejected;
    expect(jest.getTimerCount()).toBe(0); expect(mockCreate).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

it('checks the session through the normal refresh-aware client before its single audited POST', async () => {
  const oldIdentity = { token: 'expired-token', tenantSlug: 'test-tenant', assertCurrent: jest.fn() };
  jest.mocked(authenticatedApiIdentity).mockResolvedValueOnce(oldIdentity);
  jest.mocked(api.get).mockImplementationOnce(async () => {
    jest.mocked(authenticatedApiIdentity).mockResolvedValue({ ...oldIdentity, token: 'renewed-token' });
    return { data: {} };
  });
  const file = await prepareAuditedCsv(endpoint, 'export.csv', input, {}, active);
  expect(api.get).toHaveBeenCalledWith('/api/v2/users/me');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer renewed-token' }) }));
  file.dispose();
});
it('does not start an audited export when the session preflight fails', async () => {
  const error = new Error('refresh unreachable'); jest.mocked(api.get).mockRejectedValueOnce(error);
  await expect(prepareAuditedCsv(endpoint, 'export.csv', input, {}, active)).rejects.toBe(error);
  expect(fetch).not.toHaveBeenCalled(); expect(mockCreate).not.toHaveBeenCalled();
});

it('pins the originating account across the read-only renewal request', async () => {
  jest.mocked(api.get).mockImplementationOnce(async () => { mockIdentity.mockRejectedValue(new Error('account changed')); return {}; });
  await expect(prepareAuditedCsv(endpoint, 'export.csv', input, {}, active)).rejects.toThrow('account changed');
  expect(fetch).not.toHaveBeenCalled();
});
it('stops before the audited POST when the originating screen departs during renewal', async () => {
  let live = true; jest.mocked(api.get).mockImplementationOnce(async () => { live = false; return {}; });
  await expect(prepareAuditedCsv(endpoint, 'export.csv', input, {}, () => live)).rejects.toThrow('download_cancelled');
  expect(fetch).not.toHaveBeenCalled();
});
