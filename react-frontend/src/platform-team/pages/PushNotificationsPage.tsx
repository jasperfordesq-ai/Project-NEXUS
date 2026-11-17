// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Push notifications.
 *
 * Over the last 7, 14 or 30 days, per day and per community, how many recorded
 * pushes the push service accepted, partly accepted, failed, or had nobody to
 * send to (`GET /v2/platform-team/push-notifications`, platform team only).
 *
 * 🔴 "Accepted" means the push service took it, not that a phone showed it,
 * and some kinds of notification are sent without being recorded here: the
 * figures are a floor. The page says both at the top.
 *
 * 🔴 A record the server could not read says "Not available", never 0. Days
 * with nothing recorded are still listed, so a quiet day is seen.
 *
 * 🔴 Read-only. The only controls change the number of days or reload.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { FiguresRefresh, withRefresh } from '../components/FiguresRefresh';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { getFormattingLocale } from '@/lib/helpers';

interface CommunityCounts {
  accepted: number;
  partial: number;
  failed: number;
}

export interface PushDay extends CommunityCounts {
  /** YYYY-MM-DD, server time (UTC). */
  date: string;
  nobody_to_send_to: number;
}

export interface PushCommunity extends CommunityCounts {
  id: number;
  /** null when the community no longer exists but its records do. */
  name: string | null;
}

export interface PushReport {
  available: boolean;
  days: number;
  /** All null when the record could not be read. */
  by_day: PushDay[] | null;
  by_community: PushCommunity[] | null;
  no_community: CommunityCounts | null;
  /** When the server worked these figures out (absent from an older server). */
  generated_at?: string | null;
}

const DAY_CHOICES = [7, 14, 30] as const;
const DEFAULT_DAYS = 14;

const DAY_FIGURES = ['accepted', 'partial', 'failed', 'nobody_to_send_to'] as const;
const COMMUNITY_FIGURES = ['accepted', 'partial', 'failed'] as const;

export function PushNotificationsPage() {
  const { t } = useTranslation('platform_team');
  usePageTitle(t('push_notifications.title'));

  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [report, setReport] = useState<PushReport | null>(null);
  const [refused, setRefused] = useState(false);
  /** Figures are on screen: a refused "Check again" keeps them. */
  const shown = useRef(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (wanted: number, refresh = false) => {
    setRefused(false);
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<PushReport>(withRefresh(`/v2/platform-team/push-notifications?days=${wanted}`, refresh));
      if (res.success && res.data && typeof res.data.available === 'boolean') {
        setReport(res.data);
        shown.current = true;
      } else if (refresh && shown.current && res.code === 'RATE_LIMIT_EXCEEDED') {
        // Asked again too soon: keep what is on screen and say so.
        setRefused(true);
      } else {
        setReport(null);
        shown.current = false;
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load push notification figures', err);
      setReport(null);
      shown.current = false;
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [load, days]);

  const number = (n: number) => new Intl.NumberFormat(getFormattingLocale()).format(n);

  const dayLabel = (date: string) => {
    const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(getFormattingLocale(), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  };

  const figure = (label: string, value: number, testId: string) => (
    <div key={testId} className="min-w-0">
      <dt className="break-words text-xs text-muted">{label}</dt>
      <dd className="text-sm font-medium text-foreground" data-testid={testId}>
        {number(value)}
      </dd>
    </div>
  );

  const dayRows = report?.by_day ?? [];
  const communities = report?.by_community ?? [];
  const noCommunity = report?.no_community ?? null;

  return (
    <section className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('push_notifications.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('push_notifications.intro')}</p>
          <p className="mt-2 max-w-2xl text-sm text-muted">{t('push_notifications.timezone_note')}</p>
        </div>
        <FiguresRefresh
          onRefresh={() => void load(days, true)}
          loading={loading}
          generatedAt={report?.generated_at}
          refused={refused}
        />
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2" role="group" aria-label={t('push_notifications.days_picker')}>
        {DAY_CHOICES.map((choice) => (
          <Button
            key={choice}
            size="sm"
            variant={choice === days ? 'primary' : 'tertiary'}
            aria-pressed={choice === days}
            onPress={() => setDays(choice)}
            isDisabled={loading}
          >
            {t('push_notifications.days_option', { count: choice })}
          </Button>
        ))}
      </div>

      {loading && !report ? (
        <div role="status" aria-busy="true" aria-label={t('push_notifications.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !report ? (
        <LoadError title={t('push_notifications.load_error_title')} onRetry={() => void load(days)} />
      ) : !report.available ? (
        <p className="text-sm text-warning-soft-foreground" role="status">
          {t('push_notifications.not_available')}
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          <section aria-labelledby="push-days-heading">
            <h2 id="push-days-heading" className="mb-3 text-lg font-semibold text-foreground">
              {t('push_notifications.by_day_heading')}
            </h2>
            <ul className="flex flex-col gap-2">
              {dayRows.map((day) => (
                <li key={day.date} data-testid={`push-day-${day.date}`}>
                  <Card>
                    <CardBody className="grid gap-2 p-3 sm:grid-cols-[10rem_1fr] sm:items-center">
                      <h3 className="text-sm font-semibold text-foreground">{dayLabel(day.date)}</h3>
                      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {DAY_FIGURES.map((key) =>
                          figure(t(`push_notifications.figure.${key}`), day[key], `push-day-${day.date}-${key}`),
                        )}
                      </dl>
                    </CardBody>
                  </Card>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="push-communities-heading">
            <h2 id="push-communities-heading" className="mb-1 text-lg font-semibold text-foreground">
              {t('push_notifications.by_community_heading', { count: communities.length })}
            </h2>
            <p className="mb-3 max-w-2xl text-sm text-muted">{t('push_notifications.by_community_note')}</p>
            <ul className="flex flex-col gap-2">
              {communities.map((community) => (
                <li key={community.id} data-testid={`push-community-${community.id}`}>
                  <Card>
                    <CardBody className="grid gap-2 p-3 sm:grid-cols-[minmax(10rem,1fr)_2fr] sm:items-center">
                      <h3 className="min-w-0 break-words text-sm font-semibold text-foreground">
                        {community.name ?? t('push_notifications.removed_community', { id: community.id })}
                      </h3>
                      <dl className="grid grid-cols-3 gap-2">
                        {COMMUNITY_FIGURES.map((key) =>
                          figure(t(`push_notifications.figure.${key}`), community[key], `push-community-${community.id}-${key}`),
                        )}
                      </dl>
                    </CardBody>
                  </Card>
                </li>
              ))}
            </ul>
          </section>

          {noCommunity ? (
            <section aria-labelledby="push-no-community-heading" data-testid="push-no-community">
              <h2 id="push-no-community-heading" className="mb-1 text-lg font-semibold text-foreground">
                {t('push_notifications.no_community_heading')}
              </h2>
              <p className="mb-3 max-w-2xl text-sm text-muted">{t('push_notifications.no_community_note')}</p>
              <Card>
                <CardBody className="p-3">
                  <dl className="grid max-w-md grid-cols-3 gap-2">
                    {COMMUNITY_FIGURES.map((key) =>
                      figure(t(`push_notifications.figure.${key}`), noCommunity[key], `push-no-community-${key}`),
                    )}
                  </dl>
                </CardBody>
              </Card>
            </section>
          ) : null}
        </div>
      )}
    </section>
  );
}

export default PushNotificationsPage;
