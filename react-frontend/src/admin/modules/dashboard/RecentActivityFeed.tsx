// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The latest admin and member actions, from the shared activity log.
 *
 * Structured rows (a code plus parameters) are put into words here through the
 * same helper the full Activity log page uses, so a row never shows a name
 * followed by nothing. Times are relative ("3 min ago") with the exact
 * timestamp on hover.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Activity from 'lucide-react/icons/activity';
import AlertCircle from 'lucide-react/icons/circle-alert';
import { Avatar, Button, Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { useTenant } from '@/contexts';
import { formatRelativeTime, getFormattingLocale } from '@/lib/helpers';
import { useActivityDescription } from '../system/activityDescription';
import type { ActivityLogEntry } from '../../api/types';

interface RecentActivityFeedProps {
  entries: ActivityLogEntry[];
  loading: boolean;
  failed?: boolean;
}

export function RecentActivityFeed({ entries, loading, failed = false }: RecentActivityFeedProps) {
  const { t } = useTranslation('admin_dashboard');
  const { tenantPath } = useTenant();
  const describe = useActivityDescription();
  const locale = getFormattingLocale();

  return (
    <Card className="h-full border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
      <CardHeader className="flex items-center justify-between gap-2 px-4 pt-4 pb-0 sm:px-5 sm:pt-5">
        <div className="flex min-w-0 items-center gap-2">
          <Activity size={18} className="shrink-0 text-accent" aria-hidden="true" />
          <h3 className="truncate font-semibold">{t('activity.card_title')}</h3>
        </div>
        <Button as={Link} to={tenantPath('/admin/activity-log')} size="sm" variant="tertiary" className="shrink-0">
          {t('activity.view_all')}
        </Button>
      </CardHeader>
      <CardBody className="px-4 pb-4 sm:px-5 sm:pb-5">
        {loading ? (
          <ul role="status" aria-busy="true" aria-label={t('loading')} className="space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="flex items-start gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full bg-surface-tertiary" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-full rounded bg-surface-tertiary" />
                  <Skeleton className="h-3 w-24 rounded bg-surface-tertiary" />
                </div>
              </li>
            ))}
          </ul>
        ) : failed ? (
          <div role="status" className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <AlertCircle size={28} className="text-warning" aria-hidden="true" />
            <p className="text-sm text-muted">{t('activity.could_not_load')}</p>
          </div>
        ) : entries.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">{t('activity.empty')}</p>
        ) : (
          <ol className="divide-y divide-divider">
            {entries.map((entry) => {
              const when = new Date(entry.created_at);
              const exact = Number.isNaN(when.getTime()) ? '' : when.toLocaleString(locale);
              return (
                <li key={entry.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <Avatar src={entry.user_avatar ?? undefined} name={entry.user_name} size="sm" className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-5">
                      <span className="font-medium text-foreground">{entry.user_name}</span>{' '}
                      <span className="text-muted">{describe(entry)}</span>
                    </p>
                    <time dateTime={entry.created_at} title={exact} className="text-xs text-muted">
                      {formatRelativeTime(entry.created_at)}
                    </time>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

export default RecentActivityFeed;
