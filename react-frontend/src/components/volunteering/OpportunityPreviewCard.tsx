// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * OpportunityPreviewCard — how a volunteering opportunity will look on the
 * volunteering page, as it is typed (warmth phase 5, after the offer, group
 * and event forms).
 *
 * It follows the look of the real card (OpportunityCard in
 * pages/volunteering/VolunteeringPage): the organisation's logo (or a tile in
 * its own colour), the title, the organisation's name, two lines of
 * description, the place and the soft "Remote" chip. It is a picture of a
 * card, not a card: nothing in it is a link or a button.
 */

import { useTranslation } from 'react-i18next';
import Building2 from 'lucide-react/icons/building-2';
import Eye from 'lucide-react/icons/eye';
import Globe from 'lucide-react/icons/globe';
import MapPin from 'lucide-react/icons/map-pin';
import { Chip } from '@/components/ui/Chip';
import { CoverTile } from '@/components/ui/CoverTile';
import { GlassCard } from '@/components/ui/GlassCard';
import { coverSeed } from '@/lib/coverSeeds';

export interface OpportunityPreviewCardProps {
  title: string;
  description: string;
  location: string;
  isRemote: boolean;
  /** The organisation chosen in the form, if any. */
  organisationId?: number | null;
  organisationName?: string | null;
  /** The organisation's logo, if it has one: the real card shows it in the tile. */
  organisationLogoUrl?: string | null;
}

export function OpportunityPreviewCard({
  title, description, location, isRemote, organisationId, organisationName, organisationLogoUrl = null,
}: OpportunityPreviewCardProps) {
  const { t } = useTranslation('volunteering');
  const hasTitle = title.trim() !== '';
  const hasDescription = description.trim() !== '';
  const hasOrganisation = Boolean(organisationName && organisationName.trim() !== '');
  const shownOrganisation = hasOrganisation ? (organisationName as string) : t('opportunity_preview_org_placeholder');

  return (
    <section aria-labelledby="opportunity-preview-heading" data-testid="opportunity-preview">
      <h2 id="opportunity-preview-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold text-theme-secondary">
        <Eye className="h-4 w-4 text-accent" aria-hidden="true" />
        {t('opportunity_preview_heading')}
      </h2>
      <GlassCard className="p-5">
        <div className="mb-2 flex items-center gap-3">
          {/* The organisation's logo, or a tile in its own colour, as on its
              page and on the real card. */}
          <span aria-hidden="true">
            <CoverTile
              data-testid="opportunity-preview-organisation-tile"
              seed={coverSeed.organisation(organisationId ?? 0)}
              icon={Building2}
              imageUrl={organisationLogoUrl}
              name={shownOrganisation}
              className="h-9 w-9 rounded-xl"
            />
          </span>
          <div className="min-w-0">
            <p
              data-testid="opportunity-preview-title"
              className={`truncate text-lg font-semibold ${hasTitle ? 'text-theme-primary' : 'text-theme-subtle'}`}
            >
              {hasTitle ? title : t('opportunity_preview_title_placeholder')}
            </p>
            <p
              data-testid="opportunity-preview-organisation"
              className={`truncate text-sm ${hasOrganisation ? 'text-theme-muted' : 'text-theme-subtle'}`}
            >
              {shownOrganisation}
            </p>
          </div>
        </div>
        <p
          data-testid="opportunity-preview-description"
          className={`mb-3 line-clamp-2 text-sm ${hasDescription ? 'text-theme-muted' : 'text-theme-subtle'}`}
        >
          {hasDescription ? description : t('opportunity_preview_description_placeholder')}
        </p>
        {(location.trim() !== '' || isRemote) && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-theme-subtle">
            {location.trim() !== '' && (
              <span className="flex min-w-0 items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{location}</span>
              </span>
            )}
            {isRemote && (
              // The real card's own marker: a soft accent chip.
              <Chip
                data-testid="opportunity-preview-remote"
                size="sm"
                variant="soft"
                color="accent"
                startContent={<Globe className="h-3 w-3" aria-hidden="true" />}
              >
                {t('remote')}
              </Chip>
            )}
          </div>
        )}
      </GlassCard>
    </section>
  );
}

export default OpportunityPreviewCard;
