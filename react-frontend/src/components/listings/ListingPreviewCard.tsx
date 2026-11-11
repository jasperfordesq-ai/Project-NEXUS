// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import Clock from 'lucide-react/icons/clock';
import MapPin from 'lucide-react/icons/map-pin';
import Monitor from 'lucide-react/icons/monitor';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import Gift from 'lucide-react/icons/gift';
import HandHelping from 'lucide-react/icons/hand-helping';
import ImagePlus from 'lucide-react/icons/image-plus';
import Eye from 'lucide-react/icons/eye';
import { Avatar } from '@/components/ui/Avatar';
import { GlassCard } from '@/components/ui/GlassCard';
import { ThemedCover } from '@/components/ui/ThemedCover';
import { colourForSeed } from '@/lib/categoryColours';
import { themeIconFor } from '@/lib/themeIcons';
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { getFormattingLocale } from '@/lib/helpers';

export interface ListingPreviewCardProps {
  title: string;
  description: string;
  type: 'offer' | 'request';
  serviceType?: string;
  hours?: string;
  location?: string;
  categoryName?: string | null;
  categorySlug?: string | null;
  categoryIcon?: string | null;
  /** The theme's colour name, as its tile on the offers page shows it. */
  categoryColour?: string | null;
  /** A local or stored photo, already checked as safe to show. */
  imageSrc?: string | null;
  /** The member's first name only (E-122: no surnames shown to members). */
  authorName: string;
  authorAvatar?: string | null;
}

const TYPE_TONE = {
  offer: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-400',
  request: 'bg-amber-500/20 text-amber-800 dark:text-amber-400',
} as const;

/**
 * "This is how your offer will look" (warmth plan B6): the offers-page card,
 * drawn live from what the member has typed so far.
 *
 * It mirrors the grid card in ListingsPage — the photo or a cover in the
 * theme's colour, the offer/request label, the title, the opening of the
 * description, the member's face and first name, hours and place — but nothing
 * in it is a link or a button: it is a picture of the card, not the card.
 * With no photo yet, a gentle line invites one.
 */
export function ListingPreviewCard({
  title,
  description,
  type,
  serviceType,
  hours,
  location,
  categoryName,
  categorySlug,
  categoryIcon,
  categoryColour,
  imageSrc,
  authorName,
  authorAvatar,
}: ListingPreviewCardProps) {
  const { t } = useTranslation('listings');
  const palette = useSitePalette();
  const hoursNumber = Number(hours);
  const hoursLabel = Number.isFinite(hoursNumber) && hoursNumber > 0
    ? t('hours_short', { hours: hoursNumber.toLocaleString(getFormattingLocale(), { maximumFractionDigits: 2 }) })
    : null;
  const serviceMode = serviceType === 'remote_only'
    ? { Icon: Monitor, label: t('service_type_remote') }
    : serviceType === 'hybrid'
      ? { Icon: ArrowRightLeft, label: t('service_type_hybrid_available') }
      : null;
  const shownTitle = title.trim() || t('form.preview_title_placeholder');
  const shownDescription = description.trim() || t('form.preview_description_placeholder');

  return (
    <section aria-labelledby="listing-preview-heading" data-testid="listing-preview">
      <h2 id="listing-preview-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold text-theme-secondary">
        <Eye className="h-4 w-4 text-accent" aria-hidden="true" />
        {type === 'offer' ? t('form.preview_heading_offer') : t('form.preview_heading_request')}
      </h2>
      <GlassCard className="flex flex-col overflow-hidden">
        <div className="relative aspect-video overflow-hidden bg-theme-elevated">
          {imageSrc ? (
            // Decorative here: the same photo, with the member's own
            // description, is already in the form beside it.
            <img src={imageSrc} alt="" className="h-full w-full object-cover" />
          ) : (
            <ThemedCover
              data-testid="listing-preview-cover"
              seed="listing-preview"
              colour={categoryColour || colourForSeed(type, palette)}
              icon={themeIconFor({ icon: categoryIcon, slug: categorySlug, name: categoryName }) ?? (type === 'offer' ? Gift : HandHelping)}
              label={categoryName}
            />
          )}
        </div>
        <div className="flex flex-col p-4">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TYPE_TONE[type]}`}>
              {type === 'offer' ? t('offering') : t('requesting')}
            </span>
          </div>
          <p className={`mb-2 line-clamp-2 text-lg font-semibold leading-6 ${title.trim() ? 'text-theme-primary' : 'text-theme-subtle'}`}>
            {shownTitle}
          </p>
          <p className={`mb-4 line-clamp-3 text-sm leading-6 ${description.trim() ? 'text-theme-muted' : 'text-theme-subtle'}`}>
            {shownDescription}
          </p>
          <div className="flex flex-col gap-2 border-t border-theme-default pt-3">
            <div className="flex min-w-0 items-center gap-2">
              <Avatar src={authorAvatar ?? undefined} name={authorName} size="sm" className="h-8 w-8 shrink-0" />
              <span className="truncate text-sm font-medium text-theme-secondary">{authorName}</span>
            </div>
            {(hoursLabel || serviceMode || location?.trim()) && (
              <div className="flex min-w-0 items-center gap-3 text-xs text-theme-subtle">
                {hoursLabel && (
                  <span className="flex shrink-0 items-center gap-1">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {hoursLabel}
                  </span>
                )}
                {serviceMode && (
                  <span className="flex shrink-0 items-center gap-1">
                    <serviceMode.Icon className="h-3 w-3" aria-hidden="true" />
                    {serviceMode.label}
                  </span>
                )}
                {location?.trim() && (
                  <span className="flex min-w-0 flex-1 items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{location}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </GlassCard>
      {!imageSrc && (
        <p data-testid="listing-preview-photo-nudge" className="mt-3 flex items-start gap-2 text-xs leading-5 text-theme-muted">
          <ImagePlus className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          {t('form.preview_photo_nudge')}
        </p>
      )}
    </section>
  );
}

export default ListingPreviewCard;
