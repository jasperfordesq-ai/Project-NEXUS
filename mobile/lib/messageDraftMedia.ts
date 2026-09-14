// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as FileSystem from 'expo-file-system/legacy';

const DIRECTORY_NAME = 'message-drafts-v1';

function directory(): string | null {
  return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}${DIRECTORY_NAME}/` : null;
}

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(-100) || 'draft-media';
}

export function isManagedMessageDraftMedia(uri: string): boolean {
  const root = directory();
  return Boolean(root && uri.startsWith(root));
}

/** Copy picker/recorder output into app-owned storage that survives process death. */
export async function retainMessageDraftMedia(uri: string, filename: string): Promise<string | null> {
  const root = directory();
  if (!root || !uri) return null;
  if (isManagedMessageDraftMedia(uri)) {
    const existing = await FileSystem.getInfoAsync(uri).catch(() => null);
    return existing?.exists ? uri : null;
  }

  const target = `${root}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${safeFilename(filename)}`;
  try {
    await FileSystem.makeDirectoryAsync(root, { intermediates: true });
    await FileSystem.copyAsync({ from: uri, to: target });
    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists) {
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => null);
      return null;
    }
    return target;
  } catch {
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => null);
    return null;
  }
}

export async function existingMessageDraftMedia(uri: string): Promise<boolean> {
  if (!isManagedMessageDraftMedia(uri)) return false;
  const info = await FileSystem.getInfoAsync(uri).catch(() => null);
  return Boolean(info?.exists);
}

/** Delete only files created by this module; picker/provider files are never owned here. */
export async function removeMessageDraftMedia(uri: string): Promise<void> {
  if (!isManagedMessageDraftMedia(uri)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

/** Delete an Expo recorder/cache source only; content-provider and document URIs are never touched. */
export async function removeTransientMessageMedia(uri: string): Promise<void> {
  if (!FileSystem.cacheDirectory || !uri.startsWith(FileSystem.cacheDirectory)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

export async function removeMessageDraftMediaBatch(uris: readonly string[]): Promise<void> {
  await Promise.all(uris.map((uri) => removeMessageDraftMedia(uri).catch(() => undefined)));
}
