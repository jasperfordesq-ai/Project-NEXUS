// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BrokerEmptyState — on-brand empty state: soft icon medallion, reassuring
 * title + hint, optional CTA. "Empty" in a broker queue usually means "all
 * caught up", so the default tone is positive (success ring) — pass a color
 * for domains where empty is neutral (e.g. search results).
 */

import type { ReactNode } from 'react';
import { isValidElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardBody } from '@/components/ui';
import type { BrokerStatColor } from './BrokerStatCard';

interface BrokerEmptyStateProps {
  icon: LucideIcon | ReactNode;
  title: string;
  hint?: string;
  color?: BrokerStatColor;
  /** Optional call-to-action (Button / Link). */
  action?: ReactNode;
  /** Render without the surrounding Card (for use inside tables/cards). */
  bare?: boolean;
  className?: string;
}

const medallionClass: Record<BrokerStatColor, string> = {
  accent: 'text-accent-soft-foreground bg-accent/10',
  success: 'text-success bg-success/10',
  warning: 'text-warning bg-warning/10',
  danger: 'text-danger bg-danger/10',
  neutral: 'text-muted bg-surface-tertiary',
};

export function BrokerEmptyState({
  icon: Icon,
  title,
  hint,
  color = 'neutral',
  action,
  bare = false,
  className = '',
}: BrokerEmptyStateProps) {
  const IconAsComponent = Icon as LucideIcon;
  const iconNode = isValidElement(Icon) ? Icon : <IconAsComponent size={26} />;

  const content = (
    <div className={`flex flex-col items-center justify-center px-6 py-10 text-center ${className}`}>
      <div
        className={`mb-3 flex h-14 w-14 items-center justify-center rounded-2xl ring-1 ring-inset ring-current/10 ${medallionClass[color]}`}
        aria-hidden="true"
      >
        {iconNode}
      </div>
      <p className="font-medium text-foreground">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-muted">{hint}</p>}
      {/* admin-i18n-ignore: action is a caller-supplied ReactNode, not a raw status/action enum */}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );

  if (bare) return content;

  return (
    <Card className="rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
      <CardBody className="p-0">{content}</CardBody>
    </Card>
  );
}

export default BrokerEmptyState;
