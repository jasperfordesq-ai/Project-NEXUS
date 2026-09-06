// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockDownloadAsync = jest.fn();
const mockDeleteAsync = jest.fn();
const mockIsAvailableAsync = jest.fn();
const mockShareAsync = jest.fn();
const mockStorageGet = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  downloadAsync: (...args: unknown[]) => mockDownloadAsync(...args),
  deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args),
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

import { ApiResponseError } from '@/lib/api/client';
import { SHARING_UNAVAILABLE, downloadAuthenticatedFile } from './authenticatedFileDownload';

/**
 * 🔴 S4-11. Group files and volunteering certificates used to be opened with
 * `Linking.openURL(<api url>)`. The browser has no bearer token, so the member saw the
 * API's "Unauthenticated" JSON instead of the file. These pin the replacement: the
 * request carries the stored token and tenant, a non-2xx body is never shared, and the
 * file lands in the share sheet.
 */
describe('downloadAuthenticatedFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorageGet.mockImplementation(async (key: string) => (
      key === 'nexus_auth_token' ? 'token-123' : key === 'nexus_tenant_slug' ? 'hour-timebank' : null
    ));
    mockDownloadAsync.mockResolvedValue({ uri: 'file:///cache/nexus-download-1-guide.pdf', status: 200 });
    mockDeleteAsync.mockResolvedValue(undefined);
    mockIsAvailableAsync.mockResolvedValue(true);
    mockShareAsync.mockResolvedValue(undefined);
  });

  it('sends the bearer token and tenant header, then opens the share sheet', async () => {
    await downloadAuthenticatedFile('/api/v2/groups/1/files/31/download', 'Planting guide.pdf');

    expect(mockDownloadAsync).toHaveBeenCalledWith(
      'https://api.example.test/api/v2/groups/1/files/31/download',
      expect.stringMatching(/^file:\/\/\/cache\/nexus-download-\d+-Planting_guide\.pdf$/),
      { headers: expect.objectContaining({ Authorization: 'Bearer token-123', 'X-Tenant-Slug': 'hour-timebank' }) },
    );
    expect(mockShareAsync).toHaveBeenCalledWith('file:///cache/nexus-download-1-guide.pdf');
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
