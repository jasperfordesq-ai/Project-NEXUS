// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// ─────────────────────────────────────────────────────────────────────────────
// Member-supplied video embeds (F-195)
//
// A job's employer video and a course "embed" lesson are URLs typed by a
// member and shown inside a platform page. They used to be framed as typed, so
// any site — including a Google-hosted form made to look like our sign-in —
// could appear inside the page. Now only a recognised provider's link is
// accepted, and the player address is REBUILT from the parsed video id; the
// stored text never reaches an iframe `src`.
//
// Kept in step with app/Support/VideoEmbedUrl.php, which refuses anything else
// on save.
// ─────────────────────────────────────────────────────────────────────────────

export type VideoEmbedProvider = 'youtube' | 'vimeo';

export interface ParsedVideoEmbed {
  provider: VideoEmbedProvider;
  id: string;
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'youtu.be', 'www.youtu.be',
  'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,15}$/;

/**
 * The sandbox for a provider player we built ourselves. The frame is always a
 * cross-origin provider page (never our own origin), so scripts + its own
 * origin are what the player needs and cannot reach this page.
 */
export const VIDEO_EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-presentation';

/** Recognise a YouTube or Vimeo link; anything else returns null. */
export function parseVideoEmbedUrl(value?: string | null): ParsedVideoEmbed | null {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (YOUTUBE_HOSTS.has(host)) {
    let id: string | null | undefined = null;
    if (host === 'youtu.be' || host === 'www.youtu.be') {
      id = segments[0];
    } else if (segments[0] === 'watch') {
      id = url.searchParams.get('v');
    } else if (['embed', 'shorts', 'v', 'live'].includes(segments[0] ?? '')) {
      id = segments[1];
    }
    return id && YOUTUBE_ID.test(id) ? { provider: 'youtube', id } : null;
  }

  if (VIMEO_HOSTS.has(host)) {
    const id = host === 'player.vimeo.com'
      ? (segments[0] === 'video' ? segments[1] : undefined)
      : segments[0];
    return id && VIMEO_ID.test(id) ? { provider: 'vimeo', id } : null;
  }

  return null;
}

/**
 * The iframe `src` for a recognised video link, built only from the parsed id,
 * or null when the link is not an allowed provider (render nothing then).
 */
export function buildVideoEmbedSrc(value?: string | null): string | null {
  const parsed = parseVideoEmbedUrl(value);
  if (!parsed) return null;
  const id = encodeURIComponent(parsed.id);
  return parsed.provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${id}?cc_load_policy=1`
    : `https://player.vimeo.com/video/${id}`;
}
