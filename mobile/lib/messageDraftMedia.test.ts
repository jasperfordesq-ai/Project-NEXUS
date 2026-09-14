// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as FileSystem from 'expo-file-system/legacy';
import {
  existingMessageDraftMedia,
  isManagedMessageDraftMedia,
  removeMessageDraftMedia,
  removeTransientMessageMedia,
  retainMessageDraftMedia,
} from './messageDraftMedia';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: jest.fn(),
  copyAsync: jest.fn(),
  getInfoAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(FileSystem.makeDirectoryAsync).mockResolvedValue(undefined);
  jest.mocked(FileSystem.copyAsync).mockResolvedValue(undefined);
  jest.mocked(FileSystem.getInfoAsync).mockResolvedValue({ exists: true, isDirectory: false, uri: 'file:///documents/message-drafts-v1/file.jpg', size: 10, modificationTime: 1, md5: undefined });
  jest.mocked(FileSystem.deleteAsync).mockResolvedValue(undefined);
});

it('copies provider media into an app-owned process-durable directory', async () => {
  const retained = await retainMessageDraftMedia('content://picker/photo', 'My photo.jpg');

  expect(retained).toMatch(/^file:\/\/\/documents\/message-drafts-v1\/.+-My_photo\.jpg$/);
  expect(FileSystem.copyAsync).toHaveBeenCalledWith({ from: 'content://picker/photo', to: retained });
  expect(isManagedMessageDraftMedia(retained!)).toBe(true);
});

it('returns null and cleans a partial copy when durable storage fails', async () => {
  jest.mocked(FileSystem.copyAsync).mockRejectedValueOnce(new Error('disk full'));

  await expect(retainMessageDraftMedia('file:///cache/photo.jpg', 'photo.jpg')).resolves.toBeNull();
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(expect.stringContaining('/message-drafts-v1/'), { idempotent: true });
});

it('restores only existing managed files and never deletes an unowned picker file', async () => {
  const managed = 'file:///documents/message-drafts-v1/owned.jpg';
  await expect(existingMessageDraftMedia(managed)).resolves.toBe(true);
  await removeMessageDraftMedia('content://picker/not-owned');
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  await removeMessageDraftMedia(managed);
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(managed, { idempotent: true });
});

it('deletes only transient app-cache sources', async () => {
  await removeTransientMessageMedia('content://picker/not-owned');
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  await removeTransientMessageMedia('file:///cache/Audio/voice.m4a');
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/Audio/voice.m4a', { idempotent: true });
});
