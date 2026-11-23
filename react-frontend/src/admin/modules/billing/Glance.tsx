// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One figure of a summary row: an icon, a number and what it counts.
 *
 * Slim on purpose (one line of text high) so a row of them sits above a list
 * without pushing the list off the screen: the shared StatCard is three times
 * the height. Given `to`, the whole tile is a link to the list it counts.
 */

import { Link } from 'react-router-dom';
import ChevronRight from 'lucide-react/icons/chevron-right';
import type { LucideIcon } from 'lucide-react';
import { Card, CardBody } from '@/components/ui';

export type GlanceTone = 'accent' | 'success' | 'warning' | 'danger' | 'quiet';

const GLANCE_TONE: Record<GlanceTone, string> = {
  accent: 'text-accent-soft-foreground bg-accent/10',
  success: 'text-success bg-success/10',
  warning: 'text-warning bg-warning/10',
  danger: 'text-danger bg-danger/10',
  quiet: 'text-muted bg-surface-tertiary',
};

interface GlanceProps {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: GlanceTone;
  /** Where the figure can be looked at one by one. */
  to?: string;
}

export function Glance({ icon: Icon, label, value, tone, to }: GlanceProps) {
  const tile = (
    <Card className={to ? 'h-full transition-colors hover:bg-surface-secondary' : 'h-full'}>
      <CardBody className="flex flex-row items-center gap-3 px-4 py-3">
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${GLANCE_TONE[tone]}`}>
          <Icon size={18} aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-xl font-semibold leading-tight tabular-nums">{value}</span>
          <span className="break-normal text-xs text-muted">{label}</span>
        </span>
        {to ? <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden="true" /> : null}
      </CardBody>
    </Card>
  );

  if (!to) return tile;

  return (
    <Link to={to} className="block rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
      {tile}
    </Link>
  );
}
