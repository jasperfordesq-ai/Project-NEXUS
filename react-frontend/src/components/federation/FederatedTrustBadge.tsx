// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * FederatedTrustBadge
 *
 * Displays a reputation / trust chip for a user whose rating score is
 * aggregated across the federation network. Used on federated member
 * profile/list pages and on regular member profiles when the user has a
 * federated partner link.
 */


import Shield from 'lucide-react/icons/shield';
import { useTranslation } from 'react-i18next';
import { Chip, Tooltip } from '@/components/ui';

export interface FederatedTrustBadgeProps {
  /** Average rating score, 0–5. */
  score: number;
  /** Total number of reviews aggregated across partners. */
  reviewCount: number;
  /** If true, shows a globe accent to indicate cross-platform reputation. */
  isFederated?: boolean;
  /** Chip size. Defaults to 'md'. */
  size?: 'sm' | 'md' | 'lg';
}

type Tier = 'success' | 'primary' | 'warning' | 'default';

function getTier(score: number): Tier {
  if (score >= 4.5) return 'success';
  if (score >= 3.5) return 'primary';
  if (score >= 2.5) return 'warning';
  return 'default';
}

const TIER_CLASSES: Record<Tier, string> = {
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
  primary: 'bg-accent/10 text-accent-soft-foreground border border-accent/20',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20',
  default: 'bg-theme-elevated text-theme-muted border border-theme-default',
};

const ICON_SIZE: Record<NonNullable<FederatedTrustBadgeProps['size']>, string> = {
  sm: 'w-3 h-3',
  md: 'w-3.5 h-3.5',
  lg: 'w-4 h-4',
};

export function FederatedTrustBadge({
  score,
  reviewCount,
  isFederated = true,
  size = 'md',
}: FederatedTrustBadgeProps) {
  const { t } = useTranslation('federation');
  const tier = getTier(score);

  const safeScore = Number.isFinite(score) ? score : 0;
  const safeCount = Number.isFinite(reviewCount) ? reviewCount : 0;

  const tooltipContent = isFederated
    ? t('reputation.tooltip_federated', {
        count: safeCount,
      })
    : t('reputation.tooltip_local', {
        count: safeCount,
      });

  const label = t('reputation.chip_label', {
    score: safeScore.toFixed(1),
    count: safeCount,
  });

  return (
    <Tooltip content={tooltipContent} placement="top">
      <Chip
        size={size}
        variant="flat"
        aria-label={t('reputation.aria_label', {
          score: safeScore.toFixed(1),
          count: safeCount,
        })}
        className={`${TIER_CLASSES[tier]} font-medium`}
        startContent={<Shield className={ICON_SIZE[size]} aria-hidden="true" />}
      >
        {label}
      </Chip>
    </Tooltip>
  );
}

export default FederatedTrustBadge;
