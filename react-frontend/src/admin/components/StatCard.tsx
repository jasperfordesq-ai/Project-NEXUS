// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Stat Card
 * Displays a key metric with label, value, and optional trend indicator.
 * When `to` is provided, the whole card becomes a clickable link that
 * drills into the relevant filtered view — a chevron hint is shown on hover.
 *
 * The layout is vertical (icon, then label, then value) so the label has the
 * card's full width. The previous single-row layout left ~110px for the label
 * in a five-up grid, which broke words in half ("Pendin/g Review") and put the
 * big numbers at different heights across one row.
 *
 * Inside an AdminEmbed (the broker panel) the card hands over to
 * BrokerStatCard, so an embedded admin module's tiles look like every other
 * broker tile (count-up, same palette). The admin panel is unaffected.
 */


import { getFormattingLocale } from '@/lib/helpers';
import { Link } from 'react-router-dom';
import { isValidElement } from 'react';
import { useTranslation } from 'react-i18next';
import ChevronRight from 'lucide-react/icons/chevron-right';
import TrendingUp from 'lucide-react/icons/trending-up';
import TrendingDown from 'lucide-react/icons/trending-down';
import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Skeleton } from '@/components/ui/Skeleton';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrokerStatCard, type BrokerStatColor } from '@/broker/components/BrokerStatCard';
import { useAdminEmbed } from './AdminEmbedContext';

interface StatCardProps {
  label?: string;
  title?: string;
  value: string | number;
  icon: LucideIcon | ReactNode;
  trend?: number | null;
  trendLabel?: string;
  description?: string;
  color?: 'primary' | 'success' | 'warning' | 'danger' | 'secondary' | 'default';
  loading?: boolean;
  /** When set, the card acts as a react-router Link to this path. */
  to?: string;
  /** Accessible hint shown to screen readers when the card is a link. */
  linkAriaLabel?: string;
  /**
   * The figure could not be computed (the API names it in `_failed_metrics`).
   * Shows a dash and `failedLabel` as a chip on the tile itself, so the warning
   * sits where the number is missing rather than only in a banner.
   */
  failed?: boolean;
  failedLabel?: string;
}

type StatColor = NonNullable<StatCardProps['color']>;

/** Admin colour → broker palette (BrokerStatCard has no primary/secondary/default). */
const brokerColor: Record<StatColor, BrokerStatColor> = {
  primary: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  secondary: 'neutral',
  default: 'neutral',
};

const colorMap = {
  primary: 'text-accent bg-accent/10',
  success: 'text-success bg-success/10',
  warning: 'text-warning bg-warning/10',
  danger: 'text-danger bg-danger/10',
  secondary: 'text-accent bg-accent-soft',
  default: 'text-muted bg-surface-tertiary',
};

export function StatCard({
  label,
  title,
  value,
  icon: Icon,
  trend,
  trendLabel,
  description,
  color = 'primary',
  loading = false,
  to,
  linkAriaLabel,
  failed = false,
  failedLabel,
}: StatCardProps) {
  const { t } = useTranslation('admin_nav');
  const { embedded } = useAdminEmbed();
  const resolvedLabel = label ?? title ?? '';

  if (embedded) {
    return (
      <BrokerStatCard
        label={resolvedLabel}
        value={value}
        icon={Icon}
        color={brokerColor[color]}
        loading={loading}
        to={to}
        linkAriaLabel={linkAriaLabel}
        description={description}
        delta={trend ?? undefined}
        deltaLabel={trendLabel}
        failed={failed}
      />
    );
  }

  // Lucide icons are React.forwardRef objects (typeof === 'object'), not functions.
  // Discriminate via isValidElement: pre-rendered JSX passes through; component
  // references get instantiated with size={24}.
  const IconAsComponent = Icon as LucideIcon;
  const iconNode = isValidElement(Icon) ? Icon : <IconAsComponent size={20} />;
  const body = (
    <CardBody className="flex h-full flex-col p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-current/10 ${colorMap[color]}`}>
          {iconNode}
        </div>
        {to && (
          <ChevronRight
            size={16}
            className="mt-2 shrink-0 text-muted/60 transition-transform group-hover:translate-x-0.5 group-hover:text-muted"
            aria-hidden="true"
          />
        )}
      </div>
      {/* Word-safe label: wraps between words only, never inside one, and
          reserves two lines so a row of cards keeps its values level. */}
      <p className="mt-3 line-clamp-2 min-h-10 text-sm font-medium leading-5 text-muted break-normal [overflow-wrap:normal] [hyphens:none]">{resolvedLabel}</p>
      {loading ? (
        <Skeleton role="status" aria-busy="true" aria-label={t('shared.loading')} className="mt-1.5 h-8 w-20 rounded bg-surface-tertiary" />
      ) : (
        <p className="mt-1 text-3xl font-semibold leading-none tracking-tight text-foreground tabular-nums">
          {failed ? '—' : typeof value === 'number' ? value.toLocaleString(getFormattingLocale()) : value}
        </p>
      )}
      {failed && !loading && (
        <Chip size="sm" variant="soft" color="warning" className="mt-2 w-fit">
          {failedLabel ?? '—'}
        </Chip>
      )}
      {description && (
        <p className="mt-2 line-clamp-2 text-xs leading-4 text-muted break-normal [overflow-wrap:normal]">{description}</p>
      )}
      {trend !== undefined && trend !== null && !failed && (
        <div className="mt-2 flex items-center gap-1">
          {trend >= 0 ? (
            <TrendingUp size={14} className="text-success" />
          ) : (
            <TrendingDown size={14} className="text-danger" />
          )}
          <span className={`text-xs font-medium ${trend >= 0 ? 'text-success' : 'text-danger'}`}>
            {trend > 0 ? '+' : ''}{trend}%
          </span>
          {trendLabel && (
            <span className="text-xs text-muted">{trendLabel}</span>
          )}
        </div>
      )}
    </CardBody>
  );

  if (to) {
    return (
      <Card
        isPressable
        as={Link}
        to={to}
        aria-label={linkAriaLabel ?? resolvedLabel}
        className="group h-full border border-divider/70 bg-surface text-left shadow-sm shadow-black/[0.03] transition-all hover:-translate-y-0.5 hover:shadow-md"
      >
        {body}
      </Card>
    );
  }

  return <Card className="h-full border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">{body}</Card>;
}

export default StatCard;
