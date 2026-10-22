// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Links that open a web page rather than an audio file, so they can never play
 * in the episode player or be listed in a podcast feed. Creators paste them
 * because that is the link a service's "Share" button gives — on 21 Oct 2026 an
 * `open.spotify.com/episode/…` link was saved and the episode would not play.
 *
 * Deliberately a short list of hosts that ONLY serve pages. Hosts that serve
 * both (a podcast host's episode page and its `.mp3`) are not listed: refusing
 * a working link is worse than letting the player say it could not load one.
 * Mirrors `PodcastService::webPageAudioService()` on the server, which is the
 * check that actually holds; this one only explains it before the round trip.
 */
const PAGE_ONLY_HOSTS: Record<string, string> = {
  'open.spotify.com': 'Spotify',
  'spotify.link': 'Spotify',
  'creators.spotify.com': 'Spotify',
  'podcasters.spotify.com': 'Spotify',
  'podcasts.apple.com': 'Apple Podcasts',
  'soundcloud.com': 'SoundCloud',
  'on.soundcloud.com': 'SoundCloud',
  'm.soundcloud.com': 'SoundCloud',
  'youtube.com': 'YouTube',
  'm.youtube.com': 'YouTube',
  'music.youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  'drive.google.com': 'Google Drive',
  'docs.google.com': 'Google Drive',
  'onedrive.live.com': 'OneDrive',
  '1drv.ms': 'OneDrive',
};

/**
 * The service whose web page this link opens, or null when it may be an audio
 * file. Dropbox share links are pages unless they ask for the raw file
 * (`raw=1` / `dl=1`); Internet Archive `/details/` links are pages, its
 * `/download/` links are files.
 */
export function webPageAudioService(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (PAGE_ONLY_HOSTS[host]) return PAGE_ONLY_HOSTS[host];
  if (host === 'dropbox.com') {
    const raw = url.searchParams.get('raw') === '1' || url.searchParams.get('dl') === '1';
    return raw ? null : 'Dropbox';
  }
  if (host === 'archive.org' && url.pathname.startsWith('/details/')) return 'Internet Archive';
  return null;
}
