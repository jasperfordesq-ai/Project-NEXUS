// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as DocumentPicker from 'expo-document-picker';

/**
 * Pick an episode audio file off the device, applying the same two checks the web
 * studio applies before it starts a multi-hundred-megabyte upload.
 *
 * The checks are deliberately a port of `PodcastStudioPage.handleAudioFileSelected`
 * rather than a new invention, because the limits are the tenant's own: they arrive in
 * the `meta` of `GET /v2/podcasts/mine` and the server enforces them again on receipt.
 * Checking here only saves the member from watching a long upload fail.
 *
 * 🔴 An unknown or empty MIME type is allowed through on purpose. Android content
 * providers routinely report `application/octet-stream` — or nothing at all — for a
 * perfectly ordinary .m4a picked out of a recorder app, and rejecting those locally
 * would block real files the server would have accepted. Only a type we positively
 * know is not on the allow-list is refused. The server content-check is the authority.
 */

export interface PickedAudioFile {
  uri: string;
  name: string;
  /** Empty string when the platform could not tell us. Never guessed. */
  mimeType: string;
  /** Null when the platform did not report a size. */
  size: number | null;
}

export type PickAudioFileResult =
  | { status: 'cancelled' }
  | { status: 'picked'; file: PickedAudioFile }
  | { status: 'too_large'; maxMb: number }
  | { status: 'unsupported_type' };

export interface PickAudioFileLimits {
  /** Ceiling in megabytes. Zero or negative means "no client-side ceiling". */
  maxMb: number;
  /** Allowed MIME types, as reported by `GET /v2/podcasts/mine` meta. */
  mimes: string[];
}

export async function pickAudioFile(limits: PickAudioFileLimits): Promise<PickAudioFileResult> {
  const result = await DocumentPicker.getDocumentAsync({
    // `audio/*` alone hides files whose provider reports a generic type, which on
    // Android is common enough to matter; the explicit list widens the net.
    type: ['audio/*', 'application/octet-stream'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return { status: 'cancelled' };

  const asset = result.assets?.[0];
  if (!asset) return { status: 'cancelled' };

  const size = typeof asset.size === 'number' ? asset.size : null;
  if (limits.maxMb > 0 && size !== null && size > limits.maxMb * 1024 * 1024) {
    return { status: 'too_large', maxMb: limits.maxMb };
  }

  const mimeType = asset.mimeType ?? '';
  if (mimeType && mimeType !== 'application/octet-stream' && !limits.mimes.includes(mimeType)) {
    return { status: 'unsupported_type' };
  }

  return {
    status: 'picked',
    file: {
      uri: asset.uri,
      name: asset.name || 'episode-audio',
      mimeType,
      size,
    },
  };
}
