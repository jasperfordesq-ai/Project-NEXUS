// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Normalise an author-supplied course media URL before it is handed to a player,
 * a document viewer or the system browser.
 *
 * Deliberately the same rule as the web client's `normalizeCourseMediaUrl`
 * (`react-frontend/src/lib/courseContentSecurity.ts`) and the same rule the API applies on
 * storage: http/https only. A lesson's `video_url` / `attachment_url` / `embed_url` are
 * typed by an instructor, so `javascript:`, `file:` and `data:` must never reach a player
 * or `Linking.openURL` — on a phone the last two can address the device's own filesystem.
 *
 * Returns `null` rather than throwing, because "the instructor has not supplied usable
 * media" is an ordinary state the lesson has to render honestly, not an error.
 */
export function normalizeCourseMediaUrl(value?: string | null): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A short, human label for a document link — the file name where the URL has one.
 *
 * A learner deciding whether to open something in another app is better served by
 * "handbook.pdf" than by a sixty-character signed URL, and a signed URL's query string is
 * noise rather than information.
 */
export function courseMediaFileName(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (!last) return null;
    const decoded = decodeURIComponent(last);
    return decoded.length > 0 && decoded.length <= 80 ? decoded : null;
  } catch {
    return null;
  }
}
