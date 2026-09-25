// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as DocumentPicker from 'expo-document-picker';

/** Keep these values in step with GroupFileService::MIME_EXTENSIONS. */
export const GROUP_FILE_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'txt', 'csv', 'md', 'markdown', 'zip', 'rar',
  'mp4', 'm4v', 'webm', 'mp3', 'wav', 'ogg', 'oga',
] as const;

export const GROUP_FILE_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'text/markdown',
  'application/zip', 'application/x-rar-compressed', 'application/vnd.rar',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg',
] as const;

export const GROUP_FILE_MAX_MB = 25;

export interface PickedGroupFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
}

export type PickGroupFileResult =
  | { status: 'cancelled' }
  | { status: 'picked'; file: PickedGroupFile }
  | { status: 'too_large'; maxMb: number }
  | { status: 'unsupported_type' };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export async function pickGroupFile(): Promise<PickGroupFileResult> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return { status: 'cancelled' };
  const asset = result.assets?.[0];
  if (!asset) return { status: 'cancelled' };

  const name = asset.name || 'group-file';
  if (!(GROUP_FILE_EXTENSIONS as readonly string[]).includes(extensionOf(name))) {
    return { status: 'unsupported_type' };
  }

  const mimeType = asset.mimeType ?? '';
  if (
    mimeType
    && mimeType !== 'application/octet-stream'
    && !(GROUP_FILE_MIME_TYPES as readonly string[]).includes(mimeType)
  ) {
    return { status: 'unsupported_type' };
  }

  const size = typeof asset.size === 'number' ? asset.size : null;
  if (size !== null && size > GROUP_FILE_MAX_MB * 1024 * 1024) {
    return { status: 'too_large', maxMb: GROUP_FILE_MAX_MB };
  }

  return { status: 'picked', file: { uri: asset.uri, name, mimeType, size } };
}
