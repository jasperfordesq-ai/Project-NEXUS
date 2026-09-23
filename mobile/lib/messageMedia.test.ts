// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
  F-121: a message attachment download handed whatever came back to the share sheet —
  `downloadAsync` resolves for ANY HTTP status, so a 401/404 JSON body was offered as
  the attachment — and it never checked that the member who asked was still the one
  signed in when the transfer finished.
*/

const mockDownloadAsync = jest.fn();
const mockDeleteAsync = jest.fn();
const mockIsAvailableAsync = jest.fn();
const mockShareAsync = jest.fn();
const mockAssertCurrent = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  downloadAsync: (...args: unknown[]) => mockDownloadAsync(...args),
  deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: (...args: unknown[]) => mockIsAvailableAsync(...args),
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
}));
jest.mock('i18next', () => ({ t: (key: string) => key }));
jest.mock('@/lib/api/client', () => {
  class ApiResponseError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiResponseError,
    authenticatedApiIdentity: jest.fn(async () => ({ token: 't', tenantSlug: 'hour-timebank', assertCurrent: mockAssertCurrent })),
    authenticatedMediaRequest: jest.fn(async (path: string) => ({
      uri: `https://api.example.test${path}`,
      headers: { Authorization: 'Bearer t', 'X-Tenant-Slug': 'hour-timebank' },
    })),
  };
});

import { openAuthenticatedMessageMedia } from './messageMedia';

describe('openAuthenticatedMessageMedia (F-121)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteAsync.mockResolvedValue(undefined);
    mockIsAvailableAsync.mockResolvedValue(true);
    mockShareAsync.mockResolvedValue(undefined);
    mockAssertCurrent.mockResolvedValue(undefined);
  });

  it('shares a successful download', async () => {
    mockDownloadAsync.mockImplementation(async (_uri: string, target: string) => ({ uri: target, status: 200 }));

    await openAuthenticatedMessageMedia('/api/v2/messages/1/attachments/2', 'photo.jpg');

    expect(mockShareAsync).toHaveBeenCalledTimes(1);
    expect(String(mockShareAsync.mock.calls[0][0])).toMatch(/^file:\/\/\/cache\/nexus-message-.*photo\.jpg$/);
  });

  it.each([401, 403, 404, 500])('does not share an HTTP %s response as the attachment, and deletes it', async (status) => {
    mockDownloadAsync.mockImplementation(async (_uri: string, target: string) => ({ uri: target, status }));

    await expect(openAuthenticatedMessageMedia('/api/v2/messages/1/attachments/2', 'photo.jpg'))
      .rejects.toMatchObject({ status });

    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(mockDeleteAsync).toHaveBeenCalledWith(expect.stringMatching(/nexus-message-.*photo\.jpg$/), { idempotent: true });
  });

  it('does not share a file that finished downloading after the member signed out', async () => {
    mockDownloadAsync.mockImplementation(async (_uri: string, target: string) => ({ uri: target, status: 200 }));
    mockAssertCurrent.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));

    await expect(openAuthenticatedMessageMedia('/api/v2/messages/1/attachments/2', 'photo.jpg'))
      .rejects.toMatchObject({ status: 401 });

    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(mockDeleteAsync).toHaveBeenCalledWith(expect.stringMatching(/nexus-message-.*photo\.jpg$/), { idempotent: true });
  });

  it('removes a partial file when the transfer itself fails', async () => {
    mockDownloadAsync.mockRejectedValue(new Error('network'));

    await expect(openAuthenticatedMessageMedia('/api/v2/messages/1/attachments/2', 'photo.jpg')).rejects.toThrow('network');

    expect(mockDeleteAsync).toHaveBeenCalledWith(expect.stringMatching(/nexus-message-.*photo\.jpg$/), { idempotent: true });
  });
});
