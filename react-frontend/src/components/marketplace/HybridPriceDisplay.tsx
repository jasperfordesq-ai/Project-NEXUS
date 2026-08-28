// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * HybridPriceDisplay — Prominent hybrid pricing display for marketplace.
 *
 * Shows currency price + time credits side by side with visual separation,
 * a time credit icon, and a tooltip explaining hybrid pricing.
 * This is a NEXUS differentiator: pay with a mix of cash and time credits.
 */


import Clock from 'lucide-react/icons/clock';
import HelpCircle from 'lucide-react/icons/circle-help';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useTenant } from '@/contexts';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Popover, PopoverTrigger, PopoverContent, PopoverHeading } from '@/components/ui/Popover';
import { getFormattingLocale } from '@/lib/helpers';

interface HybridPriceDisplayProps {
  /** Cash price amount */
  price: number;
  /** Currency code (e.g., 'EUR', 'USD') */
  currency: string;
  /** Time credit price amount */
  timeCreditPrice: number;
  /** Price type for context */
  priceType?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Format a price with Intl.NumberFormat for locale-aware display.
 */
function formatCurrency(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat(getFormattingLocale(), {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${currency} ${price}`;
  }
}

const sizeClasses = {
  sm: { price: 'text-base', tc: 'text-sm', icon: 'w-3.5 h-3.5', chip: 'text-xs' },
  md: { price: 'text-xl', tc: 'text-base', icon: 'w-4 h-4', chip: 'text-sm' },
  lg: { price: 'text-2xl', tc: 'text-lg', icon: 'w-5 h-5', chip: 'text-base' },
};

export function HybridPriceDisplay({
  price,
  currency,
  timeCreditPrice,
  priceType,
  size = 'md',
}: HybridPriceDisplayProps) {
  const { t } = useTranslation('marketplace');
  const { tenantPath } = useTenant();

  const classes = sizeClasses[size];

  return (
    <div className="flex flex-col gap-2">
      {/* Price row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Cash portion */}
        <span className={`${classes.price} font-bold text-theme-primary`}>
          {formatCurrency(price, currency)}
        </span>

        {/* Separator */}
        <span className={`${classes.tc} font-medium text-theme-muted`}>+</span>

        {/* Time credit portion — tap/click opens the explanation (reachable on touch) */}
        <Popover placement="bottom">
          <PopoverTrigger>
            <Button
              variant="light"
              size="sm"
              className="h-auto min-h-0 min-w-0 p-0 rounded-full"
              aria-label={t('hybrid_pricing.label')}
            >
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20">
                <Clock className={`${classes.icon} text-accent`} aria-hidden="true" />
                <span className={`${classes.tc} font-bold text-accent`}>
                  {t('community_delivery.time_credits_value', { count: timeCreditPrice })}
                </span>
              </div>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="max-w-[18rem] px-3 py-2 text-xs text-theme-muted">
            <PopoverHeading className="sr-only">{t('hybrid_pricing.label')}</PopoverHeading>
            {t('hybrid_pricing.tooltip')}
          </PopoverContent>
        </Popover>

        {/* Negotiable badge */}
        {priceType === 'negotiable' && (
          <Chip color="warning" variant="soft" size="sm">
            {t('price.negotiable')}
          </Chip>
        )}
      </div>

      {/* Explainer row */}
      <div className="flex items-center gap-1.5">
        <Popover placement="bottom-start">
          <PopoverTrigger>
            <Button
              variant="light"
              size="sm"
              className="h-auto min-h-0 min-w-0 p-0"
              aria-label={t('hybrid_pricing.label')}
            >
              <span className="inline-flex items-center gap-1 text-xs text-theme-muted">
                <HelpCircle className="w-3 h-3" aria-hidden="true" />
                {t('hybrid_pricing.label')}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="max-w-[18rem] px-3 py-2 text-xs text-theme-muted">
            <PopoverHeading className="sr-only">{t('hybrid_pricing.label')}</PopoverHeading>
            {t('hybrid_pricing.explanation')}
          </PopoverContent>
        </Popover>
        <span className="text-xs text-theme-muted" aria-hidden="true">|</span>
        <Link
          to={tenantPath('/help')}
          className="text-xs text-accent hover:underline"
        >
          {t('hybrid_pricing.learn_more')}
        </Link>
      </div>
    </div>
  );
}

export default HybridPriceDisplay;
