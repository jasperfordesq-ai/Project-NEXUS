// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Normalise per-episode feed-validation issues (episode_<id>_missing_*) to
 * stable translation keys.
 *
 * Ported verbatim from `react-frontend/src/lib/podcasts/feedIssues.ts` so the
 * studio's feed-check sheet renders the same sentences the web studio does —
 * the API returns the raw, id-bearing issue strings and no translation key can
 * contain an episode id.
 */
export function feedIssueKey(issue: string): string {
  if (/^episode_\d+_missing_audio_url$/.test(issue)) return 'episode_missing_audio_url';
  if (/^episode_\d+_missing_audio_length$/.test(issue)) return 'episode_missing_audio_length';
  if (/^episode_\d+_missing_audio_mime$/.test(issue)) return 'episode_missing_audio_mime';
  return issue;
}
