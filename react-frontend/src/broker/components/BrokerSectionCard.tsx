// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BrokerSectionCard — a titled panel on the broker dashboard: an icon tile,
 * a title, an optional count beside it, an optional "View all" action in the
 * corner (a link or a button), and the body. Every dashboard panel (the
 * activity timeline, "My week", the inbox sections) uses it so the page reads
 * as one set of panels rather than three card styles.
 */

import type { ReactNode } from 'react';
import { isValidElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ArrowRight from 'lucide-react/icons/arrow-right';
import type { LucideIcon } from 'lucide-react';
import { Button, Card, CardBody } from '@/components/ui';
import type { BrokerStatColor } from './BrokerStatCard';

interface BrokerSectionCardProps {
  title: string;
  icon: LucideIcon | ReactNode;
  color?: BrokerStatColor;
  /** Shown beside the title, e.g. how many items the section holds. */
  count?: number | null;
  /** One line under the title. */
  description?: string;
  /** Where "View all" goes; mutually exclusive with `onViewAll`. */
  viewAllTo?: string;
  /** What "View all" does when it opens something in place (a drawer). */
  onViewAll?: () => void;
  /** Label for the corner action; defaults to "View all". */
  viewAllLabel?: string;
  /** Remove the body padding, for lists that draw their own dividers. */
  flush?: boolean;
  /** Fills the grid cell so panels in one row share a height. */
  className?: string;
  /** Id for the title, so a parent `aria-labelledby` can point at it. */
  titleId?: string;
  children: ReactNode;
}

const tileClass: Record<BrokerStatColor, string> = {
  accent: 'text-accent bg-accent/10',
  success: 'text-success bg-success/10',
  warning: 'text-warning bg-warning/10',
  danger: 'text-danger bg-danger/10',
  neutral: 'text-muted bg-surface-tertiary',
};

export function BrokerSectionCard({
  title,
  icon: Icon,
  color = 'accent',
  count,
  description,
  viewAllTo,
  onViewAll,
  viewAllLabel,
  flush = false,
  className = '',
  titleId,
  children,
}: BrokerSectionCardProps) {
  const { t } = useTranslation('broker');
  const IconAsComponent = Icon as LucideIcon;
  const iconNode = isValidElement(Icon) ? Icon : <IconAsComponent size={18} aria-hidden="true" />;
  const actionLabel = viewAllLabel ?? t('dashboard.view_all');

  return (
    <Card className={`flex h-full flex-col rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03] ${className}`}>
      <CardBody className="flex h-full flex-col p-0">
        <div className="flex items-center gap-3 border-b border-divider/70 px-4 py-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-current/10 ${tileClass[color]}`}>
            {iconNode}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="truncate">{title}</span>
              {typeof count === 'number' && (
                <span className="shrink-0 rounded-full bg-surface-tertiary px-2 py-0.5 text-xs font-semibold tabular-nums text-muted">
                  {count}
                </span>
              )}
            </h2>
            {description && <p className="truncate text-xs text-muted">{description}</p>}
          </div>
          {viewAllTo && (
            <Link
              to={viewAllTo}
              className="flex shrink-0 items-center gap-1 text-sm font-medium text-accent hover:underline"
            >
              {actionLabel}
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          )}
          {!viewAllTo && onViewAll && (
            <Button size="sm" variant="tertiary" className="shrink-0" onPress={onViewAll}>
              {actionLabel}
              <ArrowRight size={14} aria-hidden="true" />
            </Button>
          )}
        </div>
        <div className={flush ? 'flex-1' : 'flex-1 p-4'}>{children}</div>
      </CardBody>
    </Card>
  );
}

export default BrokerSectionCard;
