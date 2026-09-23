// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
  F-121: exported wallet statements and downloaded message attachments are one member's
  private data, written to the app's cache directory. They stayed there after sign-out,
  where the next person to use the phone (or anything that can read the app's cache on a
  compromised device) could find them. Sign-out now removes them.
*/

const mockReadDirectoryAsync = jest.fn();
const mockDeleteAsync = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  readDirectoryAsync: (...args: unknown[]) => mockReadDirectoryAsync(...args),
  deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args),
}));

import { purgeSessionFileCaches } from './sessionFileCache';

describe('purgeSessionFileCaches (F-121)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteAsync.mockResolvedValue(undefined);
  });

  it('removes attachment downloads, file downloads and wallet exports, and nothing else', async () => {
    mockReadDirectoryAsync.mockResolvedValue([
      'nexus-message-1790000000000-photo.jpg',
      'nexus-download-1790000000000-1',
      'nexus-audited-export-1790000000000-11111111-1111-4111-8111-111111111111',
      'wallet-transactions-2026-09-01.csv',
      'ImagePicker',
      'message-drafts-v1',
      'http-cache',
    ]);

    await purgeSessionFileCaches();

    const deleted = mockDeleteAsync.mock.calls.map(([uri]) => uri).sort();
    expect(deleted).toEqual([
      'file:///cache/nexus-audited-export-1790000000000-11111111-1111-4111-8111-111111111111',
      'file:///cache/nexus-download-1790000000000-1',
      'file:///cache/nexus-message-1790000000000-photo.jpg',
      'file:///cache/wallet-transactions-2026-09-01.csv',
    ]);
    for (const [, options] of mockDeleteAsync.mock.calls) expect(options).toEqual({ idempotent: true });
  });

  it('never throws, so sign-out always completes', async () => {
    mockReadDirectoryAsync.mockRejectedValueOnce(new Error('unavailable'));
    await expect(purgeSessionFileCaches()).resolves.toBeUndefined();

    mockReadDirectoryAsync.mockResolvedValueOnce(['nexus-message-1-a.pdf', 'nexus-message-2-b.pdf']);
    mockDeleteAsync.mockRejectedValueOnce(new Error('busy'));
    await expect(purgeSessionFileCaches()).resolves.toBeUndefined();
    expect(mockDeleteAsync).toHaveBeenCalledTimes(2);
  });
});
