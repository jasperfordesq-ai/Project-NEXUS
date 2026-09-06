// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockGetDocumentAsync = jest.fn();
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockGetDocumentAsync(...args) }));

import { pickAudioFile } from './pickAudioFile';

const LIMITS = { maxMb: 250, mimes: ['audio/mpeg', 'audio/x-m4a'] };

function asset(overrides: Record<string, unknown> = {}) {
  return {
    canceled: false,
    assets: [{ uri: 'file:///cache/ep.m4a', name: 'ep.m4a', size: 1024, mimeType: 'audio/x-m4a', lastModified: 0, ...overrides }],
  };
}

beforeEach(() => mockGetDocumentAsync.mockReset());

describe('pickAudioFile', () => {
  it('returns the chosen file', async () => {
    mockGetDocumentAsync.mockResolvedValue(asset());

    await expect(pickAudioFile(LIMITS)).resolves.toEqual({
      status: 'picked',
      file: { uri: 'file:///cache/ep.m4a', name: 'ep.m4a', mimeType: 'audio/x-m4a', size: 1024 },
    });
  });

  it('reports cancellation rather than an error', async () => {
    mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: null });

    await expect(pickAudioFile(LIMITS)).resolves.toEqual({ status: 'cancelled' });
  });

  it('refuses a file over the tenant ceiling before any upload starts', async () => {
    mockGetDocumentAsync.mockResolvedValue(asset({ size: 251 * 1024 * 1024 }));

    await expect(pickAudioFile(LIMITS)).resolves.toEqual({ status: 'too_large', maxMb: 250 });
  });

  it('refuses a type the tenant does not allow', async () => {
    mockGetDocumentAsync.mockResolvedValue(asset({ mimeType: 'video/mp4' }));

    await expect(pickAudioFile(LIMITS)).resolves.toEqual({ status: 'unsupported_type' });
  });

  /**
   * 🔴 The case that makes a local MIME check dangerous. Android content providers hand
   * back `application/octet-stream` — or nothing — for ordinary recordings, and the
   * server would have accepted them. Refusing locally would block real files.
   */
  it('lets an unknown or generic type through for the server to judge', async () => {
    mockGetDocumentAsync.mockResolvedValue(asset({ mimeType: 'application/octet-stream' }));
    await expect(pickAudioFile(LIMITS)).resolves.toMatchObject({ status: 'picked' });

    mockGetDocumentAsync.mockResolvedValue(asset({ mimeType: undefined }));
    await expect(pickAudioFile(LIMITS)).resolves.toMatchObject({ status: 'picked', file: { mimeType: '' } });
  });

  it('does not apply a ceiling the tenant has not set, or one it cannot measure', async () => {
    mockGetDocumentAsync.mockResolvedValue(asset({ size: 900 * 1024 * 1024 }));
    await expect(pickAudioFile({ maxMb: 0, mimes: LIMITS.mimes })).resolves.toMatchObject({ status: 'picked' });

    mockGetDocumentAsync.mockResolvedValue(asset({ size: undefined }));
    await expect(pickAudioFile(LIMITS)).resolves.toMatchObject({ status: 'picked', file: { size: null } });
  });
});
