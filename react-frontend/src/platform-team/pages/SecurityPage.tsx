// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Security.
 *
 * Five things the platform records, side by side: senior accounts without
 * two-step sign-in, failed sign-ins, senior access given and removed, admins
 * signing in as another member, and accounts the platform team signed out
 * everywhere.
 *
 * Failed sign-ins: the hour and 24-hour totals and the per-community list come
 * from an hourly count (`sign_in_failure_hours`) that started on the day it
 * was switched on, so the page says since when it has counted, and says
 * "nothing counted yet" rather than showing zeros as if they covered a day.
 * The two address figures come from the lock-out record, which keeps only
 * about 20 minutes, so they are labelled "in the last 15 minutes".
 *
 * 🔴 Read-only. People are shown by name and communities by name; email
 * addresses, IP addresses and browser details never reach this page (the
 * server does not send them).
 *
 * 🔴 A section the server could not read says "could not be checked". It is
 * never drawn as an empty list: "nothing happened" would be a comforting lie.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Chip, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import ArrowRight from 'lucide-react/icons/arrow-right';
import CircleHelp from 'lucide-react/icons/circle-help';
import Info from 'lucide-react/icons/info';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import ShieldCheck from 'lucide-react/icons/shield-check';
import { getFormattingLocale } from '@/lib/helpers';

const ACCESS_CHANGES = [
  'tenant_super_admin_granted',
  'tenant_super_admin_removed',
  'global_super_admin_granted',
  'global_super_admin_removed',
] as const;
type AccessChangeKind = (typeof ACCESS_CHANGES)[number];

interface AccessChange {
  at: string;
  change: AccessChangeKind;
  by: string | null;
  account: string | null;
  community: string | null;
}

interface Impersonation {
  at: string;
  by: string | null;
  member: string | null;
  community: string | null;
}

/** An account the platform team signed out everywhere (Find an account page). The reason is not sent. */
interface SignOut {
  at: string;
  by: string | null;
  account: string | null;
  community: string | null;
}

/**
 * Sign-ins in the last 24 hours for one community (`community: null` = not known):
 * failed password checks, and attempts the lock-out refused before any check.
 */
interface CommunityFailures {
  community: { id: number; name: string | null } | null;
  failed: number;
  /** Optional: a server that has not been updated yet does not send it. */
  refused?: number;
}

/** A section the server could not read carries `available: false` and nothing else. */
type Section<T> = ({ available: true } & T) | { available: false };

export interface SecurityOverview {
  generated_at: string;
  window_days: number;
  access_changes: Section<{ items: AccessChange[]; truncated: boolean }>;
  impersonations: Section<{ items: Impersonation[]; truncated: boolean }>;
  failed_sign_ins: Section<{
    /** Null when nothing has been counted yet (`counted_since` null). */
    last_hour: number | null;
    last_24h: number | null;
    /** Refused by the lock-out; optional (an older server does not send it). */
    refused_last_hour?: number | null;
    refused_last_24h?: number | null;
    /** The oldest hour counted; null when nothing has been counted yet. */
    counted_since: string | null;
    addresses_15m: number;
    most_from_one_address_15m: number;
    by_community: CommunityFailures[];
  }>;
  two_step: Section<{ senior_total: number; without_two_step: number }>;
  /** Optional: a server that has not been updated yet does not send it, and that is "could not be checked". */
  sign_outs?: Section<{ items: SignOut[]; truncated: boolean }>;
}

export function SecurityPage() {
  const { t } = useTranslation('platform_team');
  const { tenantPath } = useTenant();
  usePageTitle(t('security.title'));

  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<SecurityOverview>('/v2/platform-team/security');
      if (res.success && res.data && typeof res.data.two_step === 'object' && res.data.two_step !== null) {
        setOverview(res.data);
      } else {
        setOverview(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load the platform security page', err);
      setOverview(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const when = (iso: string | null): string => {
    if (!iso) return t('security.not_recorded');
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? t('security.not_recorded')
      : date.toLocaleString(getFormattingLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  };

  // Not sent (an older server) is "could not be checked", never "nobody was signed out".
  const signOuts: Section<{ items: SignOut[]; truncated: boolean }> = overview?.sign_outs ?? { available: false };

  const number = (value: number): string => value.toLocaleString(getFormattingLocale());
  const day = (iso: string): string => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? t('security.not_recorded')
      : date.toLocaleDateString(getFormattingLocale(), { dateStyle: 'medium' });
  };

  // One figure: a <dt>/<dd> pair in a <div> directly inside the <dl> (valid list
  // structure), styled as a card. Null or not sent shows "not recorded", never 0.
  const figure = (key: string, label: string, value: number | null | undefined) => (
    <div
      key={key}
      className="rounded-2xl border border-border bg-surface p-4 shadow-sm"
      data-testid={`failed-${key}`}
    >
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-foreground">
        {typeof value === 'number' ? number(value) : t('security.not_recorded')}
      </dd>
    </div>
  );
  const person = (name: string | null): string => name ?? t('security.not_recorded');

  const unavailable = (
    <p className="flex items-start gap-2 text-sm text-warning-soft-foreground" role="status">
      <CircleHelp size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
      {t('security.unavailable')}
    </p>
  );

  const block = (id: string, title: string, note: string | null, body: ReactNode) => (
    <section aria-labelledby={`security-${id}`} data-testid={`security-${id}`}>
      <h2 id={`security-${id}`} className="text-lg font-semibold text-foreground">
        {title}
      </h2>
      {note ? <p className="mb-3 mt-1 max-w-2xl text-sm text-muted">{note}</p> : <div className="mb-3" />}
      {body}
    </section>
  );

  const fact = (label: string, value: string) => (
    <div className="flex min-w-0 flex-wrap gap-x-1">
      <dt>{label}</dt>
      <dd className="min-w-0 break-words font-medium text-foreground">{value}</dd>
    </div>
  );

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('security.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('security.intro')}</p>
          <p className="mt-2 flex max-w-2xl items-start gap-2 text-sm text-muted">
            <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t('security.privacy_note')}
          </p>
        </div>
        <Button variant="tertiary" onPress={() => void load()} isDisabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('home.refresh')}
        </Button>
      </div>

      {loading && !overview ? (
        <div role="status" aria-busy="true" aria-label={t('security.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !overview ? (
        <LoadError title={t('security.load_error_title')} onRetry={() => void load()} />
      ) : (
        <div className="flex flex-col gap-8">
          {block(
            'two-step',
            t('security.two_step.title'),
            null,
            !overview.two_step.available ? (
              unavailable
            ) : (
              <Card>
                <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-start gap-3 text-sm text-foreground">
                    {overview.two_step.without_two_step > 0 ? (
                      <ShieldAlert size={22} className="shrink-0 text-warning" aria-hidden="true" />
                    ) : (
                      <ShieldCheck size={22} className="shrink-0 text-success" aria-hidden="true" />
                    )}
                    {overview.two_step.without_two_step > 0
                      ? t('security.two_step.off', {
                          count: overview.two_step.without_two_step,
                          total: number(overview.two_step.senior_total),
                        })
                      : t('security.two_step.all_on', { total: number(overview.two_step.senior_total) })}
                  </p>
                  <Link
                    to={tenantPath('/platform-team/senior-accounts')}
                    className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-accent hover:underline"
                  >
                    {t('security.two_step.link')}
                    <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </CardBody>
              </Card>
            ),
          )}

          {block(
            'failed',
            t('security.failed.title'),
            t('security.failed.note'),
            !overview.failed_sign_ins.available ? (
              unavailable
            ) : (
              <div className="flex flex-col gap-3">
                {overview.failed_sign_ins.counted_since === null ? (
                  <p className="flex items-start gap-2 text-sm text-muted" role="status">
                    <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    {t('security.failed.nothing_counted')}
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted">
                      {t('security.failed.counted_since', { date: day(overview.failed_sign_ins.counted_since) })}
                    </p>
                    <h3 className="text-base font-semibold text-foreground">{t('security.failed.checks_title')}</h3>
                    <dl className="grid grid-cols-2 gap-3">
                      {figure('last_hour', t('security.failed.last_hour'), overview.failed_sign_ins.last_hour)}
                      {figure('last_24h', t('security.failed.last_24h'), overview.failed_sign_ins.last_24h)}
                    </dl>
                    <h3 className="text-base font-semibold text-foreground">{t('security.failed.refused_title')}</h3>
                    <dl className="grid grid-cols-2 gap-3">
                      {figure(
                        'refused_last_hour',
                        t('security.failed.last_hour'),
                        overview.failed_sign_ins.refused_last_hour,
                      )}
                      {figure(
                        'refused_last_24h',
                        t('security.failed.last_24h'),
                        overview.failed_sign_ins.refused_last_24h,
                      )}
                    </dl>

                    {overview.failed_sign_ins.by_community.length === 0 ? (
                      <p className="text-sm text-muted">{t('security.failed.empty')}</p>
                    ) : (
                      <>
                      <h3 className="text-base font-semibold text-foreground">
                        {t('security.failed.by_community_title')}
                      </h3>
                      <ul className="flex flex-col gap-2">
                        {overview.failed_sign_ins.by_community.map((row) => (
                          <li key={row.community?.id ?? 0} data-testid={`failed-community-${row.community?.id ?? 0}`}>
                            <Card>
                              <CardBody className="flex flex-wrap items-baseline justify-between gap-2 p-4">
                                <h4 className="min-w-0 break-words text-base font-semibold text-foreground">
                                  {row.community === null
                                    ? t('security.failed.no_community')
                                    : (row.community.name ??
                                      t('senior_accounts.unnamed_community', { id: row.community.id }))}
                                </h4>
                                <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                                  {fact(t('security.failed.col_failed'), number(row.failed))}
                                  {fact(
                                    t('security.failed.col_refused'),
                                    typeof row.refused === 'number' ? number(row.refused) : t('security.not_recorded'),
                                  )}
                                </dl>
                              </CardBody>
                            </Card>
                          </li>
                        ))}
                      </ul>
                      </>
                    )}
                  </>
                )}

                <h3 className="mt-2 text-base font-semibold text-foreground">{t('security.failed.recent_title')}</h3>
                <p className="max-w-2xl text-sm text-muted">{t('security.failed.recent_note')}</p>
                <dl className="grid grid-cols-2 gap-3">
                  {figure('addresses_15m', t('security.failed.addresses_15m'), overview.failed_sign_ins.addresses_15m)}
                  {figure(
                    'most_from_one_15m',
                    t('security.failed.most_from_one_15m'),
                    overview.failed_sign_ins.most_from_one_address_15m,
                  )}
                </dl>
              </div>
            ),
          )}

          {block(
            'access',
            t('security.access.title'),
            t('security.access.note'),
            !overview.access_changes.available ? (
              unavailable
            ) : overview.access_changes.items.length === 0 ? (
              <p className="text-sm text-muted">{t('security.access.empty', { days: overview.window_days })}</p>
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {overview.access_changes.items.map((item, index) => (
                    <li key={`${item.at}-${index}`}>
                      <Card>
                        <CardBody className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <h3 className="break-words text-base font-semibold text-foreground">
                              {person(item.account)}
                            </h3>
                            <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                              {fact(t('security.by'), person(item.by))}
                              {fact(t('senior_accounts.community'), item.community ?? t('senior_accounts.no_community'))}
                              {fact(t('security.when'), when(item.at))}
                            </dl>
                          </div>
                          <Chip
                            size="sm"
                            variant="soft"
                            color={item.change.endsWith('_granted') ? 'warning' : 'default'}
                            className="shrink-0 self-start"
                          >
                            {(ACCESS_CHANGES as readonly string[]).includes(item.change)
                              ? t(`security.access.change.${item.change}`)
                              : t('security.not_recorded')}
                          </Chip>
                        </CardBody>
                      </Card>
                    </li>
                  ))}
                </ul>
                {overview.access_changes.truncated ? (
                  <p className="mt-2 text-sm text-muted">
                    {t('security.truncated', { count: overview.access_changes.items.length })}
                  </p>
                ) : null}
              </>
            ),
          )}

          {block(
            'impersonation',
            t('security.impersonation.title'),
            t('security.impersonation.note'),
            !overview.impersonations.available ? (
              unavailable
            ) : overview.impersonations.items.length === 0 ? (
              <p className="text-sm text-muted">{t('security.impersonation.empty', { days: overview.window_days })}</p>
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {overview.impersonations.items.map((item, index) => (
                    <li key={`${item.at}-${index}`}>
                      <Card>
                        <CardBody className="p-4">
                          <h3 className="break-words text-base font-semibold text-foreground">{person(item.by)}</h3>
                          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                            {fact(t('security.impersonation.member'), person(item.member))}
                            {fact(t('senior_accounts.community'), item.community ?? t('senior_accounts.no_community'))}
                            {fact(t('security.when'), when(item.at))}
                          </dl>
                        </CardBody>
                      </Card>
                    </li>
                  ))}
                </ul>
                {overview.impersonations.truncated ? (
                  <p className="mt-2 text-sm text-muted">
                    {t('security.truncated', { count: overview.impersonations.items.length })}
                  </p>
                ) : null}
              </>
            ),
          )}

          {block(
            'sign-outs',
            t('security.sign_outs.title'),
            t('security.sign_outs.note'),
            !signOuts.available ? (
              unavailable
            ) : signOuts.items.length === 0 ? (
              <p className="text-sm text-muted">{t('security.sign_outs.empty', { days: overview.window_days })}</p>
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {signOuts.items.map((item, index) => (
                    <li key={`${item.at}-${index}`}>
                      <Card>
                        <CardBody className="p-4">
                          <h3 className="break-words text-base font-semibold text-foreground">
                            {person(item.account)}
                          </h3>
                          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                            {fact(t('security.by'), person(item.by))}
                            {fact(t('senior_accounts.community'), item.community ?? t('senior_accounts.no_community'))}
                            {fact(t('security.when'), when(item.at))}
                          </dl>
                        </CardBody>
                      </Card>
                    </li>
                  ))}
                </ul>
                {signOuts.truncated ? (
                  <p className="mt-2 text-sm text-muted">
                    {t('security.truncated', { count: signOuts.items.length })}
                  </p>
                ) : null}
              </>
            ),
          )}
        </div>
      )}
    </section>
  );
}

export default SecurityPage;
