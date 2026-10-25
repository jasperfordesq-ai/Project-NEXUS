// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import { Chip } from '@/components/ui';
import type { PodcastEpisode } from '@/lib/api/podcasts';
import { getFormattingLocale } from '@/lib/helpers';
import { episodeAvailability } from '@/lib/podcasts/availability';

interface EpisodeAvailabilityChipProps {
  episode: PodcastEpisode;
}

function formatScheduledDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(getFormattingLocale());
}

/** The reason listeners cannot hear this episode yet; renders nothing when they can. */
export function EpisodeAvailabilityChip({ episode }: EpisodeAvailabilityChipProps) {
  const { t } = useTranslation('podcasts');
  const availability = episodeAvailability(episode, formatScheduledDate);
  if (!availability) return null;

  const params = availability.params?.status
    ? { ...availability.params, status: t(`studio.media_status.${availability.params.status}`, { defaultValue: availability.params.status }) }
    : availability.params;

  return (
    <Chip size="sm" variant="soft" color={availability.color}>
      {t(availability.key, params)}
    </Chip>
  );
}

export default EpisodeAvailabilityChip;
