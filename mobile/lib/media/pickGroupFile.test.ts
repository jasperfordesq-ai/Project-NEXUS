// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockGetDocumentAsync = jest.fn();
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockGetDocumentAsync(...args) }));

import { GROUP_FILE_MAX_MB, pickGroupFile } from './pickGroupFile';

function asset(overrides: Record<string, unknown> = {}) {
  return {
    canceled: false,
    assets: [{
      uri: 'file:///cache/group-notes.txt',
      name: 'group-notes.txt',
      size: 1024,
      mimeType: 'text/plain',
      lastModified: 0,
      ...overrides,
    }],
  };
}

beforeEach(() => mockGetDocumentAsync.mockReset());

describe('pickGroupFile', () => {
  it('returns a server-supported file', async () => {
    mockGetDocumentAsync.mockResolvedValue(asset());

    await expect(pickGroupFile()).resolves.toEqual({
      status: 'picked',
      file: {
        uri: 'file:///cache/group-notes.txt',
        name: 'group-notes.txt',
        mimeType: 'text/plain',
        size: 1024,
      },
    });
  });

  it('reports cancellation without inventing a file', async () => {
    mockGetDocumentAsync.mockResolvedValue({ canceled: true });
    await expect(pickGroupFile()).resolves.toEqual({ status: 'cancelled' });
  });

  it('refuses extensions the API excludes', async () => {
    mockGetDocumentAsync.mockResolvedValue(asset({ name: 'interactive.svg', mimeType: 'image/svg+xml' }));
    await expect(pickGroupFile()).resolves.toEqual({ status: 'unsupported_type' });
  });

  it('refuses a known MIME type that conflicts with the server allowlist', async () => {
    mockGetDocumentAsync.mockResolvedValue(asset({ name: 'group-notes.txt', mimeType: 'text/html' }));
    await expect(pickGroupFile()).resolves.toEqual({ status: 'unsupported_type' });
  });

  it.each([undefined, 'application/octet-stream'])(
    'lets the server inspect a supported extension when Android reports %s',
    async (mimeType) => {
      mockGetDocumentAsync.mockResolvedValue(asset({ mimeType }));
      await expect(pickGroupFile()).resolves.toMatchObject({ status: 'picked' });
    },
  );

  it('refuses a file over the API ceiling', async () => {
    mockGetDocumentAsync.mockResolvedValue(asset({ size: (GROUP_FILE_MAX_MB * 1024 * 1024) + 1 }));
    await expect(pickGroupFile()).resolves.toEqual({ status: 'too_large', maxMb: GROUP_FILE_MAX_MB });
  });
});
