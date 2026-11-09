// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MarketplaceListingCard - Grid card for marketplace listing display
 *
 * Shows an image with overlaid price and condition badges, listing title, * location, seller info, and a toggleable save/heart button.
 */

import { useState, useCallback, useEffect } from 'react';

import Heart from 'lucide-react/icons/heart';
import MapPin from 'lucide-react/icons/map-pin';
import Megaphone from 'lucide-react/icons/megaphone';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { useTenant } from '@/contexts/TenantContext';
import { responsiveThumbnailProps } from '@/lib/helpers';
import { PriceBadge } from './PriceBadge';
import { ConditionBadge } from './ConditionBadge';
import type { MarketplaceListingItem } from '@/types/marketplace';

interface MarketplaceListingCardProps {
  listing: MarketplaceListingItem;
  onSave?: (id: number) => void;
  onUnsave?: (id: number) => void;
}

export function MarketplaceListingCard({ listing, onSave, onUnsave }: MarketplaceListingCardProps) {
  const { t } = useTranslation('marketplace');
  const { tenantPath } = useTenant();
  const [isSaved, setIsSaved] = useState(listing.is_saved);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setIsSaved(listing.is_saved);
  }, [listing.is_saved]);

  const handleToggleSave = useCallback(
    async () => {
      const action = isSaved ? onUnsave : onSave;
      if (!action || isSaving) return;

      setIsSaving(true);
      try {
        await action(listing.id);
      } finally {
        // The parent owns the authoritative API-backed state. The effect above
        // updates the heart only after that state actually changes.
        setIsSaving(false);
      }
    },
    [isSaved, isSaving, listing.id, onSave, onUnsave],
  );

  const sourceImageUrl = listing.image?.thumbnail_url || listing.image?.url;
  const imageProps = sourceImageUrl
    ? responsiveThumbnailProps(sourceImageUrl, {
        width: 640,
        height: 360,
        widths: [320, 480, 640],
        sizes: '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw',
      })
    : null;

  return (
    <Card
      className="group relative overflow-hidden border border-border bg-surface transition-shadow duration-200 hover:shadow-lg focus-within:ring-2 focus-within:ring-accent/45"
    >
      <Link
        to={tenantPath(`/marketplace/${listing.id}`)}
        className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-base)] rounded-[inherit]"
      >
        {/* Image container */}
        <div className="relative aspect-video overflow-hidden">
          {imageProps ? (
            <img
              {...imageProps}
              alt={listing.image?.alt_text || listing.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
              decoding="async"
              fetchPriority="low"
            />
          ) : (
            <ImagePlaceholder className="w-full h-full" seed={listing.id} />
          )}

          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/55 via-black/20 to-transparent" />

          {/* Price badge - bottom-left */}
          <div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)]">
            <PriceBadge
              price={listing.price}
              currency={listing.price_currency}
              priceType={listing.price_type}
              timeCreditPrice={listing.time_credit_price}
              isOverlay
            />
          </div>

          {/* Condition badge - top-left */}
          {listing.condition && (
            <div className="absolute top-2 left-2">
              <ConditionBadge condition={listing.condition} />
            </div>
          )}

          {/* Promoted badge */}
          {listing.is_promoted && (
            <div className="absolute bottom-2 right-2">
              <Chip
                size="sm"
                variant="primary"
                color="accent"
                startContent={<Megaphone className="w-3 h-3" aria-hidden="true" />}
              >
                {t('listing.promoted')}
              </Chip>
            </div>
          )}
        </div>

        {/* Content */}
        <CardBody className="p-3 gap-1.5">
          <h3 className="text-sm font-semibold text-theme-primary line-clamp-2 leading-tight">
            {listing.title}
          </h3>

          {listing.location && (
            <div className="flex items-center gap-1 text-xs text-theme-muted">
              <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{listing.location}</span>
            </div>
          )}

          {listing.user && (
            <p className="text-xs text-theme-subtle truncate">
              {listing.user.name}
            </p>
          )}
        </CardBody>
      </Link>

      {/* Save/Heart button - separate from the listing link */}
      <Button
        isIconOnly
        variant="secondary"
        size="sm"
        onPress={handleToggleSave}
        isDisabled={isSaving}
        className="absolute top-2 right-2 z-20 bg-background/90 text-foreground shadow-lg ring-1 ring-black/10 backdrop-blur-md transition-colors hover:bg-background"
        aria-label={
          isSaved
            ? t('listing.unsave')
            : t('listing.save')
        }
      >
        <Heart
          className={`w-4 h-4 ${isSaved ? 'fill-rose-500 text-rose-500' : 'text-foreground'}`}
          aria-hidden="true"
        />
      </Button>
    </Card>
  );
}

export default MarketplaceListingCard;
