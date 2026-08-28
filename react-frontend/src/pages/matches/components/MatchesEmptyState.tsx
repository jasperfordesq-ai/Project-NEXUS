// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sparkles from 'lucide-react/icons/sparkles';
import MapPin from 'lucide-react/icons/map-pin';
import ListChecks from 'lucide-react/icons/list-checks';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/feedback';
import { useTenant } from '@/contexts';

export type MatchesEmptyVariant = 'no_coordinates' | 'no_listings' | 'safeguarding_unavailable' | 'none';

export interface MatchesEmptyStateProps {
  variant: MatchesEmptyVariant;
}

/**
 * Empty state for the matches page. Picks copy + CTA based on why there
 * are no matches to show: missing location, no active listings to match
 * against, or genuinely nothing found yet.
 */
export function MatchesEmptyState({ variant }: MatchesEmptyStateProps) {
  const { t } = useTranslation('matches');
  const { tenantPath } = useTenant();

  if (variant === 'no_coordinates') {
    return (
      <EmptyState
        icon={<MapPin className="w-12 h-12" />}
        title={t('empty.no_coordinates_title')}
        description={t('empty.no_coordinates_description')}
        action={
          <Button as={Link} to={tenantPath('/settings?tab=profile')} className="bg-gradient-to-r from-accent to-accent-gradient-end text-white">
            {t('empty.set_location_cta')}
          </Button>
        }
      />
    );
  }

  if (variant === 'safeguarding_unavailable') {
    // The member cannot fix this themselves — the community team has to
    // finish safeguarding setup — so there is deliberately no CTA button.
    return (
      <EmptyState
        icon={<ShieldAlert className="w-12 h-12" />}
        title={t('empty.safeguarding_unavailable_title')}
        description={t('empty.safeguarding_unavailable_description')}
      />
    );
  }

  if (variant === 'no_listings') {
    return (
      <EmptyState
        icon={<ListChecks className="w-12 h-12" />}
        title={t('empty.no_listings_title')}
        description={t('empty.no_listings_description')}
        action={
          <Button as={Link} to={tenantPath('/listings/create')} className="bg-gradient-to-r from-accent to-accent-gradient-end text-white">
            {t('empty.create_listing_cta')}
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={<Sparkles className="w-12 h-12" />}
      title={t('empty_title_all')}
      description={t('empty_description')}
      action={
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button as={Link} to={tenantPath('/listings')} className="bg-gradient-to-r from-accent to-accent-gradient-end text-white">
            {t('browse_listings')}
          </Button>
          <Button as={Link} to={tenantPath('/matches/preferences')} variant="secondary" className="bg-theme-elevated text-theme-primary">
            {t('empty.adjust_preferences_cta')}
          </Button>
        </div>
      }
    />
  );
}

export default MatchesEmptyState;
