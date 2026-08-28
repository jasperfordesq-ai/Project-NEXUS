// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import { Chip } from '@/components/ui/Chip';
import { getFormattingLocale } from '@/lib/helpers';

interface PriceBadgeProps {
  price: number | null;
  currency: string;
  priceType: string;
  timeCreditPrice?: number | null;
  isOverlay?: boolean;
}

/**
 * Formats a price value with the given currency symbol.
 * Uses Intl.NumberFormat for locale-aware formatting.
 */
function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat(getFormattingLocale(), {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    // Fallback for unrecognised currency codes
    return `${currency} ${price}`;
  }
}

export function PriceBadge({ price, currency, priceType, timeCreditPrice, isOverlay = false }: PriceBadgeProps) {
  const { t } = useTranslation('marketplace');
  const priceClassName = isOverlay
    ? 'inline-flex max-w-[calc(100vw-3rem)] items-center rounded-full bg-background/95 px-3 py-1 text-sm font-bold text-foreground shadow-lg ring-1 ring-black/10 backdrop-blur-md'
    : 'text-lg font-bold text-theme-primary';

  if (priceType === 'free') {
    return (
      <Chip
        color="success"
        variant="primary"
        size="sm"
        className={isOverlay ? 'font-semibold shadow-lg ring-1 ring-black/10' : 'font-semibold'}
      >
        {t('price.free')}
      </Chip>
    );
  }

  if (priceType === 'contact') {
    return (
      <Chip
        color="default"
        variant={isOverlay ? 'primary' : 'tertiary'}
        size="sm"
        className={isOverlay ? 'bg-background/95 text-foreground shadow-lg ring-1 ring-black/10 backdrop-blur-md' : undefined}
      >
        {t('price.contact')}
      </Chip>
    );
  }

  if (price == null) {
    return null;
  }

  const formattedPrice = formatPrice(price, currency);
  const timeCreditSuffix =
    timeCreditPrice != null && timeCreditPrice > 0
      ? ` + ${timeCreditPrice} TC`
      : '';

  if (priceType === 'negotiable') {
    return (
      <span className="inline-flex max-w-full items-center gap-1.5">
        <span className={priceClassName}>
          {formattedPrice}{timeCreditSuffix}
        </span>
        <Chip color="warning" variant="tertiary" size="sm">
          {t('price.negotiable')}
        </Chip>
      </span>
    );
  }

  // Fixed or auction pricing
  return (
    <span className={priceClassName}>
      {formattedPrice}{timeCreditSuffix}
    </span>
  );
}

export default PriceBadge;
