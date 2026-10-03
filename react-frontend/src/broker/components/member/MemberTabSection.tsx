// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The frame every record tab in the member window shares: skeleton while
 * loading, an honest error with Retry, the tab's own empty state, the rows,
 * a note when the page cap was hit, and a "See all" link to the broker page.
 */

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AlertCircle from 'lucide-react/icons/circle-alert';
import ArrowRight from 'lucide-react/icons/arrow-right';
import { Button } from '@/components/ui';
import { useTenant } from '@/contexts';
import { BrokerEmptyState } from '../BrokerEmptyState';
import { BrokerSkeleton } from '../BrokerSkeleton';
import type { BrokerStatColor } from '../BrokerStatCard';

interface MemberTabSectionProps {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  isEmpty: boolean;
  empty: { icon: LucideIcon; title: string; hint?: string; color?: BrokerStatColor };
  /** Broker-panel path (without the tenant prefix) the "See all" link opens. */
  seeAllPath?: string;
  /** Older records may be missing because the page cap was hit. */
  truncated?: boolean;
  /** Rendered above the rows whatever the state (e.g. an action button). */
  header?: ReactNode;
  children: ReactNode;
}

export function MemberTabSection({
  loading,
  error,
  onRetry,
  isEmpty,
  empty,
  seeAllPath,
  truncated = false,
  header,
  children,
}: MemberTabSectionProps) {
  const { t } = useTranslation('broker');
  const { tenantPath } = useTenant();

  let body: ReactNode;
  if (loading) {
    body = <BrokerSkeleton variant="table" count={3} />;
  } else if (error) {
    body = (
      <BrokerEmptyState
        bare
        icon={AlertCircle}
        color="danger"
        title={t('member_detail.section_load_failed')}
        action={
          <Button size="sm" variant="secondary" onPress={onRetry}>
            {t('member_detail.retry')}
          </Button>
        }
      />
    );
  } else if (isEmpty) {
    body = <BrokerEmptyState bare icon={empty.icon} color={empty.color ?? 'neutral'} title={empty.title} hint={empty.hint} />;
  } else {
    body = <div className="space-y-2">{children}</div>;
  }

  return (
    <div className="space-y-3 pt-3">
      {header}
      {body}
      {!loading && !error && truncated && (
        <p className="text-xs text-muted">{t('member_detail.partial_results', { count: 500 })}</p>
      )}
      {seeAllPath && !loading && (
        <div className="flex justify-end">
          <RouterLink
            to={tenantPath(seeAllPath)}
            className="inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {t('member_detail.see_all')}
            <ArrowRight size={14} aria-hidden="true" />
          </RouterLink>
        </div>
      )}
    </div>
  );
}

/** One record row: a title line, a muted detail line and something on the right. */
export function MemberTabRow({ title, detail, aside }: { title: ReactNode; detail?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
        {detail && <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">{detail}</div>}
      </div>
      {aside && <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">{aside}</div>}
    </div>
  );
}

export default MemberTabSection;
