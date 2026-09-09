// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as DocumentPicker from 'expo-document-picker';

/**
 * Pick a CV off the device for a job application.
 *
 * 🔴 Why the app needs this at all. `POST /v2/jobs/{id}/apply` has always accepted a `cv`
 * multipart part, and the phone never sent one — `applyToJob` posted a message and nothing
 * else. A member who had saved a CV to their jobs profile was not told that it is NOT
 * attached automatically (the server only stores a CV that arrives with that application),
 * so an application could go out looking complete and arrive with nothing to read.
 *
 * 🔴 These limits are the SERVER's, copied deliberately rather than invented:
 * `JobVacanciesController::apply` allows pdf / doc / docx, refuses anything over 5 MB, and
 * checks the detected MIME type against the extension. Checking here only saves the member
 * from filling in a covering message and then being refused; the server remains the
 * authority, and this must be kept in step with it.
 *
 * Unlike the podcast audio picker, an unknown MIME type is NOT waved through: the server
 * deliberately drops `application/octet-stream` for CVs, because it is the fallback for
 * any unrecognised file and would let a renamed executable reach an employer's download.
 * Letting it through here would only produce a refusal after the upload.
 */

/** Extensions the API accepts. Keep in step with `$allowed` in JobVacanciesController. */
export const CV_EXTENSIONS = ['pdf', 'doc', 'docx'] as const;
/** MIME types the API accepts, per extension. Keep in step with `$allowedMimes`. */
export const CV_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.ms-office',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
] as const;
/** The API's own ceiling, in megabytes. */
export const CV_MAX_MB = 5;

export interface PickedCvFile {
  uri: string;
  name: string;
  /** Empty string when the platform could not tell us. Never guessed. */
  mimeType: string;
  /** Null when the platform did not report a size. */
  size: number | null;
}

export type PickCvFileResult =
  | { status: 'cancelled' }
  | { status: 'picked'; file: PickedCvFile }
  | { status: 'too_large'; maxMb: number }
  | { status: 'unsupported_type' };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export async function pickCvFile(): Promise<PickCvFileResult> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [...CV_MIME_TYPES],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return { status: 'cancelled' };

  const asset = result.assets?.[0];
  if (!asset) return { status: 'cancelled' };

  const name = asset.name || 'cv.pdf';
  if (!(CV_EXTENSIONS as readonly string[]).includes(extensionOf(name))) {
    return { status: 'unsupported_type' };
  }

  const mimeType = asset.mimeType ?? '';
  if (mimeType && !(CV_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return { status: 'unsupported_type' };
  }

  const size = typeof asset.size === 'number' ? asset.size : null;
  if (size !== null && size > CV_MAX_MB * 1024 * 1024) {
    return { status: 'too_large', maxMb: CV_MAX_MB };
  }

  return { status: 'picked', file: { uri: asset.uri, name, mimeType, size } };
}
