// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as FileSystem from 'expo-file-system/legacy';

const DIRECTORY_NAME = 'group-media-operations-v1';

export interface GroupMediaDraftAsset {
  type: 'image' | 'video';
  uri: string;
  fileName: string;
  mimeType: string | null;
  size: number;
  md5: string | null;
}

function directory(): string | null {
  return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}${DIRECTORY_NAME}/` : null;
}

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120) || 'group-media';
}

export function isManagedGroupMediaDraft(uri: string): boolean {
  const root = directory();
  return Boolean(root && uri.startsWith(root));
}

/** Copy picker/cache output into app-owned storage before reserving the upload request. */
export async function retainGroupMediaDraftAsset(input: {
  type: 'image' | 'video';
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}): Promise<GroupMediaDraftAsset> {
  const root = directory();
  if (!root || !input.uri) throw new Error('Group media recovery storage unavailable');
  const fallbackName = input.type === 'video' ? 'group-video.mp4' : 'group-media.jpg';
  const fileName = safeFilename(input.fileName ?? fallbackName);
  const target = `${root}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${fileName}`;
  try {
    await FileSystem.makeDirectoryAsync(root, { intermediates: true });
    await FileSystem.copyAsync({ from: input.uri, to: target });
    const info = await FileSystem.getInfoAsync(target, { md5: true });
    if (!info.exists || typeof info.size !== 'number') throw new Error('Group media recovery copy unavailable');
    return {
      type: input.type,
      uri: target,
      fileName,
      mimeType: input.mimeType?.trim() || null,
      size: info.size,
      md5: info.md5?.toLowerCase() ?? null,
    };
  } catch (error) {
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
    throw error;
  }
}

/** A restored request is usable only while its exact app-owned byte snapshot still exists. */
export async function verifyGroupMediaDraftAsset(asset: GroupMediaDraftAsset): Promise<void> {
  if (!isManagedGroupMediaDraft(asset.uri)) throw new Error('Group media recovery record is unreadable');
  const info = await FileSystem.getInfoAsync(asset.uri, { md5: true });
  if (!info.exists || info.size !== asset.size
    || (asset.md5 !== null && info.md5?.toLowerCase() !== asset.md5)) {
    throw new Error('Group media recovery file is unavailable');
  }
}

/** Delete only the app-owned snapshot; picker and provider files never belong to this module. */
export async function removeGroupMediaDraftAsset(uri: string): Promise<void> {
  if (!isManagedGroupMediaDraft(uri)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true });
}
