// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as FileSystem from 'expo-file-system/legacy';
import {
  isManagedGroupMediaDraft,
  removeGroupMediaDraftAsset,
  retainGroupMediaDraftAsset,
  verifyGroupMediaDraftAsset,
} from './groupMediaDraftAsset';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  makeDirectoryAsync: jest.fn(),
  copyAsync: jest.fn(),
  getInfoAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(FileSystem.makeDirectoryAsync).mockResolvedValue(undefined);
  jest.mocked(FileSystem.copyAsync).mockResolvedValue(undefined);
  jest.mocked(FileSystem.getInfoAsync).mockResolvedValue({
    exists: true,
    isDirectory: false,
    uri: 'file:///documents/group-media-operations-v1/photo.jpg',
    size: 123,
    modificationTime: 1,
    md5: 'A'.repeat(32),
  });
  jest.mocked(FileSystem.deleteAsync).mockResolvedValue(undefined);
});

it('copies selected media into app-owned storage and binds its bytes', async () => {
  const asset = await retainGroupMediaDraftAsset({
    type: 'image', uri: 'content://picker/photo', fileName: 'My photo.jpg', mimeType: 'image/jpeg',
  });

  expect(asset).toEqual(expect.objectContaining({
    type: 'image', fileName: 'My_photo.jpg', mimeType: 'image/jpeg', size: 123, md5: 'a'.repeat(32),
  }));
  expect(asset.uri).toMatch(/^file:\/\/\/documents\/group-media-operations-v1\/.+-My_photo\.jpg$/);
  expect(FileSystem.copyAsync).toHaveBeenCalledWith({ from: 'content://picker/photo', to: asset.uri });
  expect(isManagedGroupMediaDraft(asset.uri)).toBe(true);
});

it('rejects a missing or changed snapshot instead of uploading different bytes', async () => {
  const asset = await retainGroupMediaDraftAsset({ type: 'video', uri: 'content://picker/video', fileName: null, mimeType: null });
  jest.mocked(FileSystem.getInfoAsync).mockResolvedValueOnce({
    exists: true, isDirectory: false, uri: asset.uri, size: 124, modificationTime: 2, md5: 'a'.repeat(32),
  });

  await expect(verifyGroupMediaDraftAsset(asset)).rejects.toThrow('unavailable');
});

it('cleans a partial copy and never deletes an unowned picker file', async () => {
  jest.mocked(FileSystem.copyAsync).mockRejectedValueOnce(new Error('disk full'));
  await expect(retainGroupMediaDraftAsset({ type: 'image', uri: 'content://picker/photo' })).rejects.toThrow('disk full');
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(expect.stringContaining('/group-media-operations-v1/'), { idempotent: true });

  jest.clearAllMocks();
  await removeGroupMediaDraftAsset('content://picker/not-owned');
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
});
