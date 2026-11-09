// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SuggestedListingsWidget - Shows recommended listings in the sidebar
 */

import { Link } from 'react-router-dom';import Sparkles from 'lucide-react/icons/sparkles';
import Heart from 'lucide-react/icons/heart';
import HandHelping from 'lucide-react/icons/hand-helping';
import { useTranslation } from 'react-i18next';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { useTenant } from '@/contexts';

export interface SuggestedListing {
  id: number;
  title: string;
  type: 'offer' | 'request';
  owner_name: string;
}

interface SuggestedListingsWidgetProps {
  listings: SuggestedListing[];
}

export function SuggestedListingsWidget({ listings }: SuggestedListingsWidgetProps) {
  const { tenantPath } = useTenant();
  const { t } = useTranslation('feed');

  if (listings.length === 0) return null;

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" aria-hidden="true" />
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">
            {t('sidebar.suggested.title')}
          </h3>
        </div>
        <Link
          to={tenantPath('/listings')}
          className="text-xs text-accent hover:text-accent transition-colors duration-200"
        >
          {t('sidebar.suggested.see_all')}
        </Link>
      </div>

      <div className="space-y-2">
        {listings.map((listing) => (
          <Link
            key={listing.id}
            to={tenantPath(`/listings/${listing.id}`)}
            className="flex items-start gap-3 p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors duration-200 group"
          >
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
              listing.type === 'offer'
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                : 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300'
            }`}>
              {listing.type === 'offer' ? (
                <Heart className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <HandHelping className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate group-hover:text-accent transition-colors duration-200">
                {listing.title}
              </p>
              <p className="text-xs text-[var(--text-muted)] truncate">
                {t('sidebar.by_owner', { name: listing.owner_name })}
              </p>
            </div>
            <Chip
              size="sm"
              variant="flat"
              className={listing.type === 'offer'
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300 text-[10px]'
                : 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300 text-[10px]'
              }
            >
              {listing.type === 'offer'
                ? t('sidebar.offer')
                : t('sidebar.suggested.request')
              }
            </Chip>
          </Link>
        ))}
      </div>
    </GlassCard>
  );
}

export default SuggestedListingsWidget;
