// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Security.
 *
 * Four things the platform already recorded, side by side for the first time:
 * senior accounts without two-step sign-in, failed sign-ins, senior access
 * given and removed, and admins signing in as another member.
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

interface CommunityFailures {
  community: { id: number; name: string | null } | null;
  failed: number;
  accounts_tried: number;
  most_on_one_account: number;
  last_at: string | null;
}

/** A section the server could not read carries `available: false` and nothing else. */
type Section<T> = ({ available: true } & T) | { available: false };

export interface SecurityOverview {
  generated_at: string;
  window_days: number;
  access_changes: Section<{ items: AccessChange[]; truncated: boolean }>;
  impersonations: Section<{ items: Impersonation[]; truncated: boolean }>;
  failed_sign_ins: Section<{
    last_hour: number;
    last_24h: number;
    addresses_24h: number;
    most_from_one_address_24h: number;
    by_community: CommunityFailures[];
  }>;
  two_step: Section<{ senior_total: number; without_two_step: number }>;
}

export function SecurityPage() {
  const { t, i18n } = useTranslation('platform_team');
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
      : date.toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  };

  const number = (value: number): string => value.toLocaleString(i18n.language);
  const person = (name: string | null): string => name ?? t('security.not_recorded');

  const unavailable = (
    <p className="flex items-start gap-2 text-sm text-warning" role="status">
      <CircleHelp size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
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
    <div className="flex gap-1">
      <dt>{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
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
                          total: overview.two_step.senior_total,
                        })
                      : t('security.two_step.all_on', { total: overview.two_step.senior_total })}
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
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      ['last_hour', overview.failed_sign_ins.last_hour],
                      ['last_24h', overview.failed_sign_ins.last_24h],
                      ['addresses', overview.failed_sign_ins.addresses_24h],
                      ['most_from_one', overview.failed_sign_ins.most_from_one_address_24h],
                    ] as const
                  ).map(([key, value]) => (
                    <Card key={key}>
                      <CardBody className="p-4" data-testid={`failed-${key}`}>
                        <dt className="text-sm text-muted">{t(`security.failed.${key}`)}</dt>
                        <dd className="mt-1 text-2xl font-semibold text-foreground">{number(value)}</dd>
                      </CardBody>
                    </Card>
                  ))}
                </dl>

                {overview.failed_sign_ins.by_community.length === 0 ? (
                  <p className="text-sm text-muted">{t('security.failed.empty')}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {overview.failed_sign_ins.by_community.map((row) => (
                      <li key={row.community?.id ?? 0} data-testid={`failed-community-${row.community?.id ?? 0}`}>
                        <Card>
                          <CardBody className="p-4">
                            <h3 className="text-base font-semibold text-foreground">
                              {row.community === null
                                ? t('senior_accounts.no_community')
                                : (row.community.name ??
                                  t('senior_accounts.unnamed_community', { id: row.community.id }))}
                            </h3>
                            <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                              {fact(t('security.failed.col_failed'), number(row.failed))}
                              {fact(t('security.failed.col_accounts'), number(row.accounts_tried))}
                              {fact(t('security.failed.col_most'), number(row.most_on_one_account))}
                              {fact(t('security.failed.col_last'), when(row.last_at))}
                            </dl>
                          </CardBody>
                        </Card>
                      </li>
                    ))}
                  </ul>
                )}
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
        </div>
      )}
    </section>
  );
}

export default SecurityPage;
