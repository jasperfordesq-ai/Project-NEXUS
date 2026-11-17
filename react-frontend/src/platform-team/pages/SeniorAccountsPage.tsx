// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Senior accounts.
 *
 * Every account that can administer more than one community (the platform
 * team, global super admins, tenant super admins), with when each last signed
 * in and whether two-step sign-in is on.
 *
 * 🔴 This page only shows. It has no button that gives or takes away access,
 * and it must never get one: platform team membership is set in the database
 * on purpose, so the way to the top tier is not a web button.
 *
 * A reply that cannot be loaded shows the error card, never an empty list:
 * "nobody holds senior access" would be a comforting lie.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Chip, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import Eye from 'lucide-react/icons/eye';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import ShieldCheck from 'lucide-react/icons/shield-check';
import { getFormattingLocale } from '@/lib/helpers';

export const SENIOR_LEVELS = ['platform_team', 'global_super_admin', 'tenant_super_admin', 'platform_flag_only'] as const;
export type SeniorLevel = (typeof SENIOR_LEVELS)[number];

/** Account states the server can send besides `active`. Anything else is shown as "Not active". */
const KNOWN_STATUSES = ['inactive', 'suspended', 'banned', 'pending', 'rejected'] as const;
type KnownStatus = (typeof KNOWN_STATUSES)[number];

/**
 * The wording key for an account that is not active (also used by the access
 * review). An unknown state is "Not active", never left blank.
 */
export function accountStatusKey(status: string): `senior_accounts.status.${KnownStatus | 'other'}` {
  return (KNOWN_STATUSES as readonly string[]).includes(status)
    ? `senior_accounts.status.${status as KnownStatus}`
    : 'senior_accounts.status.other';
}

export interface SeniorAccount {
  id: number;
  name: string | null;
  email: string;
  level: SeniorLevel;
  incomplete_platform_team: boolean;
  community: { id: number; name: string | null } | null;
  status: string;
  last_sign_in_at: string | null;
  two_step_on: boolean;
  has_passkey: boolean;
}

export interface SeniorAccountsList {
  total: number;
  truncated: boolean;
  counts: Record<SeniorLevel, number>;
  accounts: SeniorAccount[];
}

export function SeniorAccountsPage() {
  const { t } = useTranslation('platform_team');
  usePageTitle(t('senior_accounts.title'));

  const [list, setList] = useState<SeniorAccountsList | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<SeniorAccountsList>('/v2/platform-team/senior-accounts');
      if (res.success && res.data && Array.isArray(res.data.accounts)) {
        setList(res.data);
      } else {
        setList(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load the senior accounts list', err);
      setList(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const day = (iso: string | null): string => {
    if (!iso) return t('senior_accounts.never');
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? t('senior_accounts.never')
      : date.toLocaleDateString(getFormattingLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const statusLabel = (status: string): string => t(accountStatusKey(status));

  const withoutTwoStep = list ? list.accounts.filter((a) => !a.two_step_on).length : 0;

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('senior_accounts.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('senior_accounts.intro')}</p>
          <p className="mt-2 flex max-w-2xl items-start gap-2 text-sm text-muted">
            <Eye size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t('senior_accounts.read_only_note')}
          </p>
        </div>
        <Button variant="tertiary" onPress={() => void load()} isDisabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('home.refresh')}
        </Button>
      </div>

      {loading && !list ? (
        <div role="status" aria-busy="true" aria-label={t('senior_accounts.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !list ? (
        <LoadError title={t('senior_accounts.load_error_title')} onRetry={() => void load()} />
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <CardBody className="flex flex-row items-start gap-3 p-4" data-testid="two-step-summary">
              {withoutTwoStep > 0 ? (
                <ShieldAlert size={22} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
              ) : (
                <ShieldCheck size={22} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              )}
              <p className="text-sm text-foreground">
                {withoutTwoStep > 0
                  ? t('senior_accounts.without_two_step', { count: withoutTwoStep, total: new Intl.NumberFormat(getFormattingLocale()).format(list.total) })
                  : t('senior_accounts.all_have_two_step', { total: new Intl.NumberFormat(getFormattingLocale()).format(list.total) })}
              </p>
            </CardBody>
          </Card>

          {list.truncated ? (
            <p className="text-sm text-warning-soft-foreground" role="status">
              {t('senior_accounts.truncated', { count: list.accounts.length })}
            </p>
          ) : null}

          {SENIOR_LEVELS.map((level) => {
            const accounts = list.accounts.filter((a) => a.level === level);
            // The half-set flag is an oddity: say nothing about it unless it exists.
            if (level === 'platform_flag_only' && accounts.length === 0) return null;
            const headingId = `senior-level-${level}`;

            return (
              <section key={level} aria-labelledby={headingId} data-testid={`senior-level-${level}`}>
                <h2 id={headingId} className="text-lg font-semibold text-foreground">
                  {t(`senior_accounts.level.${level}`)}{' '}
                  <span className="font-normal text-muted">({accounts.length})</span>
                </h2>
                <p className="mb-3 mt-1 max-w-2xl text-sm text-muted">{t(`senior_accounts.level_note.${level}`)}</p>

                {accounts.length === 0 ? (
                  <p className="text-sm text-muted">{t('senior_accounts.none_at_level')}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {accounts.map((account) => (
                      <li key={account.id} data-testid={`senior-account-${account.id}`}>
                        <Card>
                          <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <h3 className="break-words text-base font-semibold text-foreground">
                                {account.name ?? t('senior_accounts.unnamed')}
                              </h3>
                              <p className="break-all text-sm text-muted">{account.email}</p>
                              <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                                <div className="flex min-w-0 gap-1">
                                  <dt className="shrink-0">{t('senior_accounts.community')}</dt>
                                  <dd className="min-w-0 break-words font-medium text-foreground">
                                    {account.community === null
                                      ? t('senior_accounts.no_community')
                                      : (account.community.name ??
                                        t('senior_accounts.unnamed_community', { id: account.community.id }))}
                                  </dd>
                                </div>
                                <div className="flex gap-1">
                                  <dt>{t('senior_accounts.last_sign_in')}</dt>
                                  <dd className="font-medium text-foreground">{day(account.last_sign_in_at)}</dd>
                                </div>
                              </dl>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2 sm:max-w-xs sm:justify-end">
                              <Chip size="sm" variant="soft" color={account.two_step_on ? 'success' : 'danger'}>
                                {account.two_step_on
                                  ? t('senior_accounts.two_step_on')
                                  : t('senior_accounts.two_step_off')}
                              </Chip>
                              {account.has_passkey ? (
                                <Chip size="sm" variant="soft" color="default">
                                  {t('senior_accounts.passkey')}
                                </Chip>
                              ) : null}
                              {account.status !== 'active' ? (
                                <Chip size="sm" variant="soft" color="warning">
                                  {statusLabel(account.status)}
                                </Chip>
                              ) : null}
                              {account.incomplete_platform_team && level !== 'platform_flag_only' ? (
                                <Chip size="sm" variant="soft" color="warning">
                                  {t('senior_accounts.incomplete')}
                                </Chip>
                              ) : null}
                            </div>
                          </CardBody>
                        </Card>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default SeniorAccountsPage;
