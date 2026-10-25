// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { PodcastEpisode } from '@/lib/api/podcasts';

export interface EpisodeAvailability {
  /** Key in the `podcasts` namespace. */
  key: string;
  params?: Record<string, string>;
  color: 'warning' | 'danger' | 'default';
}

/**
 * Why listeners cannot hear an episode yet, or null when they can.
 *
 * The API returns not-yet-live episodes only to the show's owner and admins
 * (PodcastService::visibleEpisodeQuery / canViewEpisode), and the owner can play
 * them. 🔴 Until 2026-10-25 the show page listed them with no label and the
 * episode page labelled a draft with its MODERATION state ("Approved"), so an
 * owner reasonably believed an unpublished draft was live. Mirrors the rules of
 * canViewEpisode(); web-uk's episodeAvailability() applies the same ones.
 */
export function episodeAvailability(
  episode: Pick<PodcastEpisode, 'status' | 'moderation_status' | 'scheduled_for' | 'hosted_audio' | 'media_processing_status' | 'media_scan_status'>,
  formatDate: (value: string) => string,
  now: number = Date.now(),
): EpisodeAvailability | null {
  if (episode.status === 'archived') return { key: 'status.archived', color: 'default' };
  if (episode.status !== 'published') return { key: 'status.draft', color: 'warning' };

  if (episode.moderation_status === 'rejected' || episode.moderation_status === 'flagged') {
    return { key: `moderation.${episode.moderation_status}`, color: 'danger' };
  }
  if (episode.moderation_status !== 'approved') return { key: 'moderation.pending', color: 'warning' };

  if (episode.scheduled_for) {
    const at = new Date(episode.scheduled_for).getTime();
    if (Number.isFinite(at) && at > now) {
      return { key: 'studio.scheduled_for_chip', params: { date: formatDate(episode.scheduled_for) }, color: 'warning' };
    }
  }

  if (episode.hosted_audio) {
    const processing = episode.media_processing_status ?? '';
    const scan = episode.media_scan_status ?? '';
    if (processing !== 'complete' || !['clean', 'not_required'].includes(scan)) {
      const failed = ['failed', 'blocked', 'infected'].includes(scan) || processing === 'failed';
      const shown = processing !== 'complete' ? processing : scan;
      return {
        key: 'studio.media_processing_status',
        params: { status: shown || 'pending' },
        color: failed ? 'danger' : 'warning',
      };
    }
  }

  return null;
}
