// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * OfferCard - Offer display card for marketplace offer lists
 *
 * Shows offer amount, status badge, message, listing thumbnail,
 * buyer/seller info, and context-dependent action buttons.
 */


import Check from 'lucide-react/icons/check';
import X from 'lucide-react/icons/x';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Undo2 from 'lucide-react/icons/undo-2';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { getFormattingLocale, resolveAvatarUrl, resolveThumbnailUrl } from '@/lib/helpers';
import type { MarketplaceOffer, MarketplaceShippingOption } from '@/types/marketplace';
import { BuyNowButton } from './BuyNowButton';
import { ShippingSelector } from './ShippingSelector';

interface OfferCardProps {
  offer: MarketplaceOffer;
  /** 'buyer' or 'seller' — determines which action buttons are shown */
  perspective?: 'buyer' | 'seller';
  onAccept?: (offerId: number) => void;
  onDecline?: (offerId: number) => void;
  onCounter?: (offerId: number) => void;
  onWithdraw?: (offerId: number) => void;
  onAcceptCounter?: (offerId: number) => void;
  onCheckoutSuccess?: (offerId: number) => void;
}

const STATUS_CONFIG: Record<string, { color: 'warning' | 'success' | 'danger' | 'secondary' | 'default'; labelKey: string }> = {
  pending: { color: 'warning', labelKey: 'offer.status.pending' },
  accepted: { color: 'success', labelKey: 'offer.status.accepted' },
  declined: { color: 'danger', labelKey: 'offer.status.declined' },
  countered: { color: 'secondary', labelKey: 'offer.status.countered' },
  expired: { color: 'default', labelKey: 'offer.status.expired' },
  withdrawn: { color: 'default', labelKey: 'offer.status.withdrawn' },
};

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(getFormattingLocale(), {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

const timestampFormatter = () =>
  new Intl.DateTimeFormat(getFormattingLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

function formatTimestamp(dateStr: string): string {
  try {
    return timestampFormatter().format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

export function OfferCard({
  offer,
  perspective = 'buyer',
  onAccept,
  onDecline,
  onCounter,
  onWithdraw,
  onAcceptCounter,
  onCheckoutSuccess,
}: OfferCardProps) {
  const { t } = useTranslation('marketplace');
  const statusConfig = STATUS_CONFIG[offer.status] ?? { color: 'default' as const, labelKey: 'offer.status.unknown' };
  const counterparty = perspective === 'buyer' ? offer.seller : offer.buyer;
  const [acceptedShippingOption, setAcceptedShippingOption] = useState<MarketplaceShippingOption | null | undefined>(undefined);
  const acceptedFulfilmentRequired = Boolean(
    offer.listing?.shipping_available || offer.listing?.local_pickup,
  );

  return (
    <GlassCard className="p-4">
      <div className="flex gap-3">
        {/* Listing thumbnail */}
        {offer.listing?.image?.url && (
          <div className="shrink-0 w-16 h-16 rounded-md overflow-hidden">
            <img
              src={resolveThumbnailUrl(offer.listing.image.thumbnail_url || offer.listing.image.url, { width: 160, height: 160 })}
              alt={offer.listing.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Listing title + status */}
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="min-w-0">
              {offer.listing && (
                <p className="text-sm font-semibold text-theme-primary truncate">
                  {offer.listing.title}
                </p>
              )}
            </div>
            <Chip
              color={statusConfig.color}
              variant="soft"
              size="sm"
              className="shrink-0"
            >
              {t(statusConfig.labelKey)}
            </Chip>
          </div>

          {/* Amount */}
          <p className="text-lg font-bold text-theme-primary">
            {formatCurrency(offer.amount, offer.currency)}
          </p>

          {/* Counter offer amount */}
          {offer.status === 'countered' && offer.counter_amount != null && (
            <p className="text-sm text-theme-muted mt-0.5">
              {t('offer.counter_amount', {
                amount: formatCurrency(offer.counter_amount, offer.currency),
              })}
            </p>
          )}

          {/* Message */}
          {offer.message && (
            <p className="text-xs text-theme-muted mt-1.5 line-clamp-2">
              {offer.message}
            </p>
          )}

          {/* Counter message */}
          {offer.counter_message && (
            <p className="text-xs text-theme-subtle mt-1 italic line-clamp-2">
              {offer.counter_message}
            </p>
          )}

          {/* Counterparty + timestamp */}
          <div className="flex items-center justify-between mt-2.5">
            {counterparty && (
              <div className="flex items-center gap-1.5">
                <Avatar
                  src={resolveAvatarUrl(counterparty.avatar_url)}
                  name={counterparty.name}
                  size="sm"
                  className="w-5 h-5"
                />
                <span className="text-xs text-theme-muted">{counterparty.name}</span>
              </div>
            )}
            <span className="text-xs text-theme-subtle">
              {formatTimestamp(offer.created_at)}
            </span>
          </div>

          {/* Action buttons */}
          {offer.status === 'pending' && (
            <div className="flex gap-2 mt-3">
              {perspective === 'seller' && (
                <>
                  <Button
                    size="sm"

                    variant="secondary"
                    startContent={<Check className="w-3.5 h-3.5" aria-hidden="true" />}
                    onPress={() => onAccept?.(offer.id)}
                  >
                    {t('offer.accept')}
                  </Button>
                  <Button
                    size="sm"

                    variant="danger-soft"
                    startContent={<X className="w-3.5 h-3.5" aria-hidden="true" />}
                    onPress={() => onDecline?.(offer.id)}
                  >
                    {t('offer.decline')}
                  </Button>
                  <Button
                    size="sm"

                    variant="secondary"
                    startContent={<RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />}
                    onPress={() => onCounter?.(offer.id)}
                  >
                    {t('offer.counter')}
                  </Button>
                </>
              )}
              {perspective === 'buyer' && (
                <Button
                  size="sm"

                  variant="danger-soft"
                  startContent={<Undo2 className="w-3.5 h-3.5" aria-hidden="true" />}
                  onPress={() => onWithdraw?.(offer.id)}
                >
                  {t('offer.withdraw')}
                </Button>
              )}
            </div>
          )}

          {/* Accept counter button for buyer */}
          {offer.status === 'countered' && perspective === 'buyer' && (
            <div className="flex gap-2 mt-3">
              <Button
                size="sm"

                variant="secondary"
                startContent={<Check className="w-3.5 h-3.5" aria-hidden="true" />}
                onPress={() => onAcceptCounter?.(offer.id)}
              >
                {t('offer.accept_counter')}
              </Button>
              <Button
                size="sm"

                variant="danger-soft"
                startContent={<X className="w-3.5 h-3.5" aria-hidden="true" />}
                onPress={() => onDecline?.(offer.id)}
              >
                {t('offer.decline')}
              </Button>
            </div>
          )}

          {offer.status === 'accepted' && perspective === 'buyer' && offer.listing && offer.seller && (
            <div className="mt-3 space-y-3">
              {acceptedFulfilmentRequired && (
                <ShippingSelector
                  sellerId={offer.seller.id}
                  localPickup={Boolean(offer.listing.local_pickup)}
                  autoSelect={false}
                  onSelect={setAcceptedShippingOption}
                />
              )}
              <BuyNowButton
                listingId={offer.listing.id}
                offerId={offer.id}
                listingTitle={offer.listing.title}
                price={offer.amount}
                currency={offer.currency}
                sellerId={offer.seller.id}
                selectedShippingOption={acceptedShippingOption}
                shippingRequired={acceptedFulfilmentRequired}
                shippingMethod={offer.listing.delivery_method === 'community_delivery'
                  ? 'community_delivery'
                  : 'pickup'}
                allowCoupons={false}
                buttonLabelKey="offer.pay_accepted"
                onSuccess={() => onCheckoutSuccess?.(offer.id)}
              />
            </div>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

export default OfferCard;
