// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MarketplacePreviewCard — how a marketplace item will look on the
 * marketplace page, as it is typed (warmth phase 5, after the offer, group,
 * event and volunteering forms).
 *
 * It follows the look of the real card (MarketplaceListingCard) and uses the
 * same pieces for the parts that carry meaning — PriceBadge, ConditionBadge
 * and the picture placeholder — so the price and condition read exactly as
 * they will. It is a picture of a card, not a card: nothing in it is a link
 * or a button.
 */

import { useTranslation } from 'react-i18next';
import Eye from 'lucide-react/icons/eye';
import ImagePlus from 'lucide-react/icons/image-plus';
import MapPin from 'lucide-react/icons/map-pin';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { ConditionBadge } from './ConditionBadge';
import { PriceBadge } from './PriceBadge';

export interface MarketplacePreviewCardProps {
  title: string;
  /** The price as typed; empty or not a number shows as no price. */
  price: string;
  currency: string;
  priceType: string;
  condition: string;
  location: string;
  /** The first photo chosen in the form, if any. */
  imageSrc: string | null;
  /** The seller's first name. */
  sellerName?: string | null;
  /**
   * The item's id when editing. With no photo, the real card colours its
   * placeholder by the id, so the preview does too; a new item has none yet.
   */
  id?: number | string | null;
}

export function MarketplacePreviewCard({
  title, price, currency, priceType, condition, location, imageSrc, sellerName, id = null,
}: MarketplacePreviewCardProps) {
  const { t } = useTranslation('marketplace');
  const hasTitle = title.trim() !== '';
  const priceNumber = price.trim() === '' ? null : Number(price);
  const shownPrice = priceNumber !== null && Number.isFinite(priceNumber) && priceNumber >= 0 ? priceNumber : null;

  return (
    <section aria-labelledby="marketplace-preview-heading" data-testid="marketplace-preview">
      <h2 id="marketplace-preview-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold text-theme-secondary">
        <Eye className="h-4 w-4 text-accent" aria-hidden="true" />
        {t('create.preview_heading')}
      </h2>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <div className="relative aspect-video overflow-hidden">
          {imageSrc ? (
            // Decorative here: the same photo, with its description, is in the form.
            <img src={imageSrc} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImagePlaceholder className="h-full w-full" seed={id ?? 'marketplace-preview'} />
          )}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/55 via-black/20 to-transparent" aria-hidden="true" />
          <div data-testid="marketplace-preview-price" className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)]">
            <PriceBadge price={shownPrice} currency={currency} priceType={priceType} isOverlay />
          </div>
          {condition && (
            <div data-testid="marketplace-preview-condition" className="absolute left-2 top-2">
              <ConditionBadge condition={condition} />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5 p-3">
          <p
            data-testid="marketplace-preview-title"
            className={`line-clamp-2 text-sm font-semibold leading-tight ${hasTitle ? 'text-theme-primary' : 'text-theme-subtle'}`}
          >
            {hasTitle ? title : t('create.preview_title_placeholder')}
          </p>
          {location.trim() !== '' && (
            <span className="flex items-center gap-1 text-xs text-theme-muted">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{location}</span>
            </span>
          )}
          {sellerName && <span className="truncate text-xs text-theme-subtle">{sellerName}</span>}
        </div>
      </div>
      {!imageSrc && (
        <p data-testid="marketplace-preview-photo-nudge" className="mt-3 flex items-start gap-2 text-xs leading-5 text-theme-muted">
          <ImagePlus className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          {t('create.preview_photo_nudge')}
        </p>
      )}
    </section>
  );
}

export default MarketplacePreviewCard;
