// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * JobPreviewCard — how a job vacancy will look on the jobs page, as it is
 * typed (warmth phase 5, after the offer, group, event, volunteering,
 * marketplace and profile forms).
 *
 * It follows the look of the real card (JobCard in pages/jobs/JobsPage): the
 * tile in the colour of the job's type (the same seed as the real card), the
 * title, the type and commitment labels, two lines of description and the
 * place. It is a picture of a card, not a card: nothing in it is a link or a
 * button. The tile's picture is a plain briefcase here; the real card draws
 * a different picture per type.
 */

import { useTranslation } from 'react-i18next';
import Briefcase from 'lucide-react/icons/briefcase';
import Eye from 'lucide-react/icons/eye';
import MapPin from 'lucide-react/icons/map-pin';
import Wifi from 'lucide-react/icons/wifi';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { MemberPlainText, memberPlainText } from '@/components/ui/MemberPlainText';
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { categoryColour, colourForSeed } from '@/lib/categoryColours';
import { coverSeed } from '@/lib/coverSeeds';
import { JOB_TYPE_CHIP_COLOURS } from './jobTypeLook';

const TYPES = ['paid', 'volunteer', 'timebank'] as const;
const COMMITMENTS = ['full_time', 'part_time', 'flexible', 'one_off'] as const;

export interface JobPreviewCardProps {
  title: string;
  description: string;
  type: string;
  commitment: string;
  location: string;
  isRemote: boolean;
}

export function JobPreviewCard({ title, description, type, commitment, location, isRemote }: JobPreviewCardProps) {
  const { t } = useTranslation('jobs');
  const palette = useSitePalette();
  const typeColour = colourForSeed(coverSeed.jobType(type || 'paid'), palette);
  const hasTitle = title.trim() !== '';
  const hasDescription = Boolean(memberPlainText(description));
  const knownType = (TYPES as readonly string[]).includes(type);
  const knownCommitment = (COMMITMENTS as readonly string[]).includes(commitment);

  return (
    <section aria-labelledby="job-preview-heading" data-testid="job-preview">
      <h2 id="job-preview-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold text-theme-secondary">
        <Eye className="h-4 w-4 text-accent" aria-hidden="true" />
        {t('form.preview_heading')}
      </h2>
      <GlassCard className="p-5">
        <div className="flex gap-3">
          <div
            data-testid="job-preview-type-tile"
            data-colour={typeColour}
            aria-hidden="true"
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${categoryColour(typeColour).band}`}
          >
            <Briefcase className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p
              data-testid="job-preview-title"
              className={`text-lg font-semibold ${hasTitle ? 'text-theme-primary' : 'text-theme-subtle'}`}
            >
              {hasTitle ? title : t('form.preview_title_placeholder')}
            </p>
            {(knownType || knownCommitment) && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {knownType && (
                  // The list's own label: fixed meaning colours (jobTypeLook).
                  <Chip data-testid="job-preview-type" size="sm" variant="tertiary" color={JOB_TYPE_CHIP_COLOURS[type] ?? 'default'} className="text-xs">
                    {t(`type.${type}`)}
                  </Chip>
                )}
                {knownCommitment && (
                  <span data-testid="job-preview-commitment" className="rounded-full bg-theme-elevated px-2.5 py-0.5 text-xs font-medium text-theme-secondary">
                    {t(`commitment.${commitment}`)}
                  </span>
                )}
              </div>
            )}
            {hasDescription ? (
              <MemberPlainText content={description} as="p" className="mt-2 line-clamp-2 text-sm text-theme-muted" />
            ) : (
              <p data-testid="job-preview-description-placeholder" className="mt-2 text-sm text-theme-subtle">
                {t('form.preview_description_placeholder')}
              </p>
            )}
            {/* As the real card: "Remote" OR the place, never both. The place
                box keeps its text when Remote is switched on. */}
            {(location.trim() !== '' || isRemote) && (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-theme-subtle">
                {isRemote ? (
                  <span data-testid="job-preview-remote" className="flex items-center gap-1">
                    <Wifi className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {t('remote')}
                  </span>
                ) : (
                  <span className="flex min-w-0 items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{location}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </GlassCard>
    </section>
  );
}

export default JobPreviewCard;
