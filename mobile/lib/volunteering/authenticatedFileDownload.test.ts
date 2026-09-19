// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockDownloadAsync = jest.fn();
const mockDeleteAsync = jest.fn();
const mockMakeDirectoryAsync = jest.fn();
const mockIsAvailableAsync = jest.fn();
const mockShareAsync = jest.fn();
const mockStorageGet = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  downloadAsync: (...args: unknown[]) => mockDownloadAsync(...args),
  deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args),
  makeDirectoryAsync: (...args: unknown[]) => mockMakeDirectoryAsync(...args),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: (...args: unknown[]) => mockIsAvailableAsync(...args),
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
}));
jest.mock('@/lib/storage', () => ({
  storage: { get: (...args: unknown[]) => mockStorageGet(...args) },
}));
jest.mock('@/lib/constants', () => ({
  API_BASE_URL: 'https://api.example.test',
  APP_VERSION: '9.9.9',
  DEFAULT_TENANT: 'default-tenant',
  STORAGE_KEYS: { AUTH_TOKEN: 'nexus_auth_token', TENANT_SLUG: 'nexus_tenant_slug' },
}));
jest.mock('i18next', () => ({ t: (key: string) => key }));

import { ApiResponseError, clearApiSession, installApiSession } from '@/lib/api/client';
import { DOWNLOAD_CANCELLED, SHARING_UNAVAILABLE, downloadAuthenticatedFile } from './authenticatedFileDownload';

/**
 * 🔴 S4-11. Group files and volunteering certificates used to be opened with
 * `Linking.openURL(<api url>)`. The browser has no bearer token, so the member saw the
 * API's "Unauthenticated" JSON instead of the file. These pin the replacement: the
 * request carries the stored token and tenant, a non-2xx body is never shared, and the
 * file lands in the share sheet.
 */
describe('downloadAuthenticatedFile', () => {
  it.each([false, true])('removes partial downloads and preserves the transfer error (cleanup failure: %s)', async (cleanupFails) => {
    const failure = new Error('Connection interrupted');
    mockDownloadAsync.mockRejectedValueOnce(failure);
    if (cleanupFails) mockDeleteAsync.mockRejectedValueOnce(new Error('Cache cleanup failed'));
    await expect(downloadAuthenticatedFile('/api/v2/kb/7/attachments/11/download', 'guide.pdf')).rejects.toBe(failure);
    const directory = mockMakeDirectoryAsync.mock.calls[0][0];
    expect(mockDeleteAsync).toHaveBeenCalledWith(directory, { idempotent: true });
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it.each(['download', 'availability'])('cleans up without sharing when the screen closes during %s', async (stage) => {
    let active = true;
    if (stage === 'download') mockDownloadAsync.mockImplementationOnce(async () => {
      active = false;
      return { uri: 'file:///cache/abandoned.pdf', status: 200 };
    });
    else mockIsAvailableAsync.mockImplementationOnce(async () => { active = false; return true; });
    await expect(downloadAuthenticatedFile('/api/v2/kb/7/attachments/11/download', 'guide.pdf', {}, { isActive: () => active }))
      .rejects.toThrow(DOWNLOAD_CANCELLED);
    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(mockDeleteAsync).toHaveBeenCalledWith(stage === 'download' ? 'file:///cache/abandoned.pdf' : 'file:///cache/nexus-download-1-guide.pdf', { idempotent: true });
  });

  it.each(['download', 'availability', 'community'])('does not share after identity replacement at %s', async (stage) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    if (stage !== 'availability') {
      mockDownloadAsync.mockImplementationOnce(async () => {
        await pending;
        return { uri: 'file:///cache/old-account.json', status: 200 };
      });
    } else {
      mockIsAvailableAsync.mockImplementationOnce(async () => { await pending; return true; });
    }
    const result = downloadAuthenticatedFile('/api/v2/me/data-export', 'export.json');
    const rejection = expect(result).rejects.toMatchObject({ status: 401 });
    // Let identity loading and native download/availability reach their pending boundary.
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    expect(stage !== 'availability' ? mockDownloadAsync : mockIsAvailableAsync).toHaveBeenCalled();
    if (stage === 'community') {
      mockStorageGet.mockImplementation(async (key: string) => key === 'nexus_tenant_slug' ? 'replacement-community' : 'token-123');
    } else {
      installApiSession('replacement-account-token');
    }
    release();
    await rejection;
    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(mockDeleteAsync).toHaveBeenCalledWith(
      stage !== 'availability' ? 'file:///cache/old-account.json' : 'file:///cache/nexus-download-1-guide.pdf',
      { idempotent: true },
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
    clearApiSession();
    mockStorageGet.mockImplementation(async (key: string) => (
      key === 'nexus_auth_token' ? 'token-123' : key === 'nexus_tenant_slug' ? 'hour-timebank' : null
    ));
    mockDownloadAsync.mockResolvedValue({ uri: 'file:///cache/nexus-download-1-guide.pdf', status: 200 });
    mockDeleteAsync.mockResolvedValue(undefined);
    mockMakeDirectoryAsync.mockResolvedValue(undefined);
    mockIsAvailableAsync.mockResolvedValue(true);
    mockShareAsync.mockResolvedValue(undefined);
  });

  it('sends the bearer token and tenant header, then opens the share sheet', async () => {
    await downloadAuthenticatedFile(
      '/api/v2/groups/1/files/31/download',
      'Planting guide.pdf',
      { 'Idempotency-Key': 'download-key-1' },
    );

    expect(mockDownloadAsync).toHaveBeenCalledWith(
      'https://api.example.test/api/v2/groups/1/files/31/download',
      expect.stringMatching(/^file:\/\/\/cache\/nexus-download-\d+-\d+\/Planting guide\.pdf$/),
      { headers: expect.objectContaining({ Authorization: 'Bearer token-123', 'X-Tenant-Slug': 'hour-timebank', 'Idempotency-Key': 'download-key-1' }) },
    );
    expect(mockShareAsync).toHaveBeenCalledWith('file:///cache/nexus-download-1-guide.pdf');
  });

  it('preserves readable Unicode names while keeping files in separate cache directories', async () => {
    await downloadAuthenticatedFile('/api/v2/kb/7/attachments/11/download', 'Treoir cúnamh.pdf');
    await downloadAuthenticatedFile('/api/v2/kb/7/attachments/11/download', '../Treoir cúnamh.pdf');
    const first = mockDownloadAsync.mock.calls[0][1];
    const second = mockDownloadAsync.mock.calls[1][1];
    expect(first).toMatch(/\/Treoir cúnamh\.pdf$/);
    expect(second).toMatch(/\/.._Treoir cúnamh\.pdf$/);
    expect(first.slice(0, first.lastIndexOf('/'))).not.toBe(second.slice(0, second.lastIndexOf('/')));
    expect(mockMakeDirectoryAsync).toHaveBeenCalledWith(first.slice(0, first.lastIndexOf('/') + 1), { intermediates: true });
  });

  it('uses a newly issued bearer and prevents caller identity overrides', async () => {
    installApiSession('fresh-download-token');
    mockStorageGet.mockImplementation(async (key: string) => (
      key === 'nexus_tenant_slug' ? 'hour-timebank' : null
    ));

    await downloadAuthenticatedFile('/api/v2/groups/1/files/31/download', 'guide.pdf', {
      Authorization: 'Bearer caller-token',
      'X-Tenant-Slug': 'other-community',
    });

    expect(mockDownloadAsync.mock.calls[0][2].headers).toMatchObject({
      Authorization: 'Bearer fresh-download-token',
      'X-Tenant-Slug': 'hour-timebank',
    });
  });

  it('refuses without a stored token instead of downloading an "Unauthenticated" page', async () => {
    mockStorageGet.mockResolvedValue(null);

    await expect(downloadAuthenticatedFile('/api/v2/groups/1/files/31/download', 'x.pdf'))
      .rejects.toMatchObject({ status: 401 });
    expect(mockDownloadAsync).not.toHaveBeenCalled();
  });

  it('does not share a non-2xx body and removes it', async () => {
    mockDownloadAsync.mockResolvedValue({ uri: 'file:///cache/nexus-download-2-x.pdf', status: 404 });

    await expect(downloadAuthenticatedFile('/api/v2/groups/1/files/31/download', 'x.pdf'))
      .rejects.toBeInstanceOf(ApiResponseError);
    expect(mockDeleteAsync).toHaveBeenCalledWith('file:///cache/nexus-download-2-x.pdf', { idempotent: true });
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it('refuses to send the token to another origin', async () => {
    await expect(downloadAuthenticatedFile('https://evil.example/steal', 'x.pdf'))
      .rejects.toMatchObject({ status: 400 });
    expect(mockDownloadAsync).not.toHaveBeenCalled();
  });

  it('reports when the device has no share sheet', async () => {
    mockIsAvailableAsync.mockResolvedValue(false);

    await expect(downloadAuthenticatedFile('/api/v2/volunteering/certificates/ABC/html', 'certificate.html'))
      .rejects.toThrow(SHARING_UNAVAILABLE);
  });
});
