// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { buildVideoEmbedSrc } from '@/lib/videoEmbed';

export { VIDEO_EMBED_SANDBOX as COURSE_EMBED_SANDBOX } from '@/lib/videoEmbed';

/**
 * Normalise author-supplied course media URLs before rendering them in media
 * elements or iframes. The backend applies the same scheme rule on storage.
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
 * F-195: the iframe `src` for an "embed" lesson. Only a YouTube or Vimeo link
 * is framed, and the player address is rebuilt from the parsed video id — the
 * author's text never reaches the iframe. Anything else returns null and the
 * lesson shows no frame (the server now refuses such links on save).
 */
export function courseEmbedSrc(value?: string | null): string | null {
  return buildVideoEmbedSrc(value);
}
