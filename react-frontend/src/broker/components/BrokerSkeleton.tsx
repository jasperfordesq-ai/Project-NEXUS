// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BrokerSkeleton — shaped loading placeholders so pages settle without
 * layout shift. Variants mirror the layouts broker pages actually use:
 *   stats    — a row of stat-card silhouettes, vertical like BrokerStatCard
 *              (icon tile, two-line label, number) so the grid does not jump
 *              when the real tiles arrive
 *   table    — header bar + n rows
 *   cards    — n content-card silhouettes
 *   detail   — header + two-column detail silhouette
 *   timeline — a panel of n dot-and-rail activity rows
 *   chart    — a panel with a row of bars
 */

import { useTranslation } from 'react-i18next';
import { Card, Skeleton } from '@/components/ui';

interface BrokerSkeletonProps {
  variant?: 'stats' | 'table' | 'cards' | 'detail' | 'timeline' | 'chart';
  /** stats: tile count · table: row count · cards: card count · timeline: row count. */
  count?: number;
  className?: string;
}

function Bone({ className = '', ...rest }: { className?: string } & Record<`data-${string}`, string | boolean>) {
  return <Skeleton className={`rounded-md bg-surface-tertiary ${className}`} {...rest} />;
}

const statGridCols = 'grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3';
const panelClass = 'rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]';

export function BrokerSkeleton({ variant = 'table', count, className = '' }: BrokerSkeletonProps) {
  const { t } = useTranslation('broker');
  const wrapperProps = {
    role: 'status' as const,
    'aria-busy': true,
    'aria-label': t('common.loading'),
  };

  if (variant === 'stats') {
    const tiles = count ?? 4;
    return (
      <div {...wrapperProps} className={`${statGridCols} ${className}`}>
        {Array.from({ length: tiles }, (_, i) => (
          <Card key={i} className={panelClass}>
            <div data-skeleton-tile="" className="flex flex-col p-3.5 sm:p-5">
              <Bone className="h-10 w-10 rounded-xl" />
              <Bone className="mt-3 h-3.5 w-28 max-w-full" />
              <Bone className="mt-1.5 h-3.5 w-16" />
              <Bone className="mt-2 h-8 w-14" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (variant === 'cards') {
    const cards = count ?? 3;
    return (
      <div {...wrapperProps} className={`space-y-4 ${className}`}>
        {Array.from({ length: cards }, (_, i) => (
          <Card key={i} className={panelClass}>
            <div className="space-y-3 p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <Bone className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Bone className="h-4 w-40" />
                  <Bone className="h-3 w-24" />
                </div>
              </div>
              <Bone className="h-3.5 w-full" />
              <Bone className="h-3.5 w-2/3" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (variant === 'detail') {
    return (
      <div {...wrapperProps} className={`space-y-4 ${className}`}>
        <Card className={panelClass}>
          <div className="flex items-center gap-4 p-4 sm:p-5">
            <Bone className="h-12 w-12 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Bone className="h-5 w-56" />
              <Bone className="h-3.5 w-80 max-w-full" />
            </div>
          </div>
        </Card>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Card key={i} className={panelClass}>
              <div className="space-y-3 p-4 sm:p-5">
                <Bone className="h-4 w-32" />
                <Bone className="h-3.5 w-full" />
                <Bone className="h-3.5 w-3/4" />
                <Bone className="h-3.5 w-1/2" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'timeline') {
    const rows = count ?? 5;
    return (
      <Card {...wrapperProps} className={`${panelClass} ${className}`}>
        <div className="flex items-center gap-3 border-b border-divider/70 px-4 py-3">
          <Bone className="h-9 w-9 rounded-xl" />
          <Bone className="h-4 w-36" />
        </div>
        <ul className="px-4 py-2">
          {Array.from({ length: rows }, (_, i) => (
            <li key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <Bone className="mt-4 h-2.5 w-2.5 rounded-full" />
                {i < rows - 1 && <span aria-hidden="true" className="w-px flex-1 bg-divider" />}
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-3 py-3">
                <Bone className="h-6 w-20 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Bone className="h-3.5 w-2/3" />
                  <Bone className="h-3 w-1/3" />
                </div>
                <Bone className="h-3 w-12" />
              </div>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  if (variant === 'chart') {
    // Tallest bars in the middle, as a chart placeholder reads best; the
    // heights are fixed classes so Tailwind can see them.
    const bars = ['h-6', 'h-10', 'h-8', 'h-14', 'h-12', 'h-16', 'h-9', 'h-11', 'h-7', 'h-12', 'h-10', 'h-5'];
    return (
      <Card {...wrapperProps} className={`${panelClass} ${className}`}>
        <div className="flex items-center gap-3 border-b border-divider/70 px-4 py-3">
          <Bone className="h-9 w-9 rounded-xl" />
          <Bone className="h-4 w-32" />
        </div>
        <div className="flex h-32 items-end gap-2 p-4">
          {bars.map((height, i) => (
            <Bone key={i} data-skeleton-bar="" className={`flex-1 rounded-t-md ${height}`} />
          ))}
        </div>
      </Card>
    );
  }

  // table (default)
  const rows = count ?? 6;
  return (
    <Card {...wrapperProps} className={`${panelClass} ${className}`}>
      <div className="p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <Bone className="h-4 w-40" />
          <Bone className="h-8 w-28 rounded-lg" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Bone className="h-9 w-9 rounded-full" />
              <Bone className="h-4 flex-1" />
              <Bone className="hidden h-4 w-24 sm:block" />
              <Bone className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export default BrokerSkeleton;
