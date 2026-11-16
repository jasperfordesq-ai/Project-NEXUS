// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Community health.
 *
 * One row of counts per community: members, members active in the last 30
 * days, new members, exchanges this month and last month, hours exchanged,
 * new listings and the most recent sign-in, plus which communities have gone
 * quiet. A wide screen gets a table; a narrow one gets a card per community.
 *
 * 🔴 Counts only: no member is named on this page. Read-only.
 *
 * A figure the server could not read arrives as null and is shown as "Not
 * available", never as zero: "no exchanges" would be a comforting lie.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Chip, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { joinList } from '@/lib/listFormat';
import { logError } from '@/lib/logger';
import Eye from 'lucide-react/icons/eye';
import Moon from 'lucide-react/icons/moon';
import RefreshCw from 'lucide-react/icons/refresh-cw';

export interface CommunityHealthRow {
  id: number;
  name: string;
  slug: string | null;
  is_active: boolean;
  members: number | null;
  active_members: number | null;
  new_members_this_month: number | null;
  exchanges_this_month: number | null;
  exchanges_last_month: number | null;
  hours_this_month: number | null;
  new_listings_this_month: number | null;
  last_sign_in_at: string | null;
  quiet: boolean | null;
}

export interface CommunityHealthTotals {
  communities: number;
  quiet: number;
  members: number | null;
  active_members: number | null;
  new_members_this_month: number | null;
  exchanges_this_month: number | null;
  exchanges_last_month: number | null;
  hours_this_month: number | null;
  new_listings_this_month: number | null;
}

export interface CommunityHealth {
  active_window_days: number;
  unavailable: string[];
  totals: CommunityHealthTotals;
  communities: CommunityHealthRow[];
}

/** The figure columns, in the order the table shows them. */
const FIGURES = [
  'members',
  'active_members',
  'new_members_this_month',
  'exchanges_this_month',
  'exchanges_last_month',
  'hours_this_month',
  'new_listings_this_month',
] as const;
type Figure = (typeof FIGURES)[number];

export function CommunityHealthPage() {
  const { t, i18n } = useTranslation('platform_team');
  usePageTitle(t('community_health.title'));

  const [health, setHealth] = useState<CommunityHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<CommunityHealth>('/v2/platform-team/community-health');
      if (res.success && res.data && Array.isArray(res.data.communities) && res.data.totals) {
        setHealth(res.data);
      } else {
        setHealth(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load community health', err);
      setHealth(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const days = health?.active_window_days ?? 30;

  const number = (value: number | null): string =>
    value === null
      ? t('community_health.not_available')
      : value.toLocaleString(i18n.language, { maximumFractionDigits: 1 });

  const signInUnreadable = health?.unavailable.includes('last_sign_in_at') ?? false;

  const day = (iso: string | null): string => {
    if (signInUnreadable) return t('community_health.not_available');
    if (!iso) return t('community_health.never_signed_in');
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? t('community_health.never_signed_in')
      : date.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const label = (figure: Figure): string =>
    figure === 'active_members'
      ? t('community_health.column.active_members', { days })
      : t(`community_health.column.${figure}`);

  const status = (community: CommunityHealthRow) => {
    if (!community.is_active) {
      return (
        <Chip size="sm" variant="soft" color="default">
          {t('community_health.not_active')}
        </Chip>
      );
    }
    if (community.quiet === true) {
      return (
        <Chip size="sm" variant="soft" color="warning">
          <Moon size={12} aria-hidden="true" />
          {t('community_health.quiet')}
        </Chip>
      );
    }
    if (community.quiet === null) {
      return <span className="text-xs text-muted">{t('community_health.quiet_unknown')}</span>;
    }
    return null;
  };

  const quietOnes = health ? health.communities.filter((c) => c.quiet === true) : [];
  // An active community the server could not judge: the card must never say "none quiet".
  const quietUnknown = health ? health.communities.some((c) => c.is_active && c.quiet === null) : false;

  return (
    <section className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('community_health.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('community_health.intro')}</p>
          <p className="mt-2 max-w-2xl text-sm text-muted">{t('community_health.same_as_dashboard')}</p>
          <p className="mt-2 flex max-w-2xl items-start gap-2 text-sm text-muted">
            <Eye size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t('community_health.counts_only')}
          </p>
        </div>
        <Button variant="tertiary" onPress={() => void load()} isDisabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('home.refresh')}
        </Button>
      </div>

      {loading && !health ? (
        <div role="status" aria-busy="true" aria-label={t('community_health.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !health ? (
        <LoadError title={t('community_health.load_error_title')} onRetry={() => void load()} />
      ) : health.communities.length === 0 ? (
        <p className="text-sm text-muted">{t('community_health.empty')}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {health.unavailable.length > 0 ? (
            <p className="max-w-2xl text-sm text-warning-soft-foreground" role="status">
              {t('community_health.unavailable_note')}
            </p>
          ) : null}

          <Card>
            <CardBody className="flex flex-row items-start gap-3 p-4" data-testid="community-health-quiet">
              <Moon size={20} className={`mt-0.5 shrink-0 ${quietOnes.length > 0 ? 'text-warning' : 'text-muted'}`} aria-hidden="true" />
              <div className="min-w-0 text-sm">
                {quietOnes.length > 0 ? (
                  <>
                    <p className="font-medium text-foreground">{t('community_health.quiet_count', { count: quietOnes.length })}</p>
                    <p className="mt-1 break-words text-foreground">
                      {t('community_health.quiet_names', { names: joinList(quietOnes.map((c) => c.name), i18n.language) })}
                    </p>
                  </>
                ) : quietUnknown ? null : (
                  <p className="font-medium text-foreground">{t('community_health.none_quiet')}</p>
                )}
                {quietUnknown ? (
                  <p className={`${quietOnes.length > 0 ? 'mt-1 ' : ''}font-medium text-foreground`}>
                    {t('community_health.quiet_unknown_summary')}
                  </p>
                ) : null}
                <p className="mt-2 text-muted">{t('community_health.quiet_rule', { days })}</p>
              </div>
            </CardBody>
          </Card>

          <p className="text-sm text-muted">{t('community_health.community_count', { count: health.totals.communities })}</p>

          <div className="hidden overflow-x-auto rounded-xl border border-divider md:block">
            <table className="w-full border-collapse text-sm" data-testid="community-health-table">
              <caption className="sr-only">{t('community_health.title')}</caption>
              <thead>
                <tr className="bg-surface-secondary text-start text-xs text-muted">
                  <th scope="col" className="sticky start-0 z-10 min-w-48 bg-surface-secondary px-3 py-2 font-medium">
                    {t('community_health.column.community')}
                  </th>
                  {FIGURES.map((figure) => (
                    <th key={figure} scope="col" className="min-w-24 px-3 py-2 text-end align-bottom font-medium">
                      {label(figure)}
                    </th>
                  ))}
                  <th scope="col" className="min-w-28 px-3 py-2 align-bottom font-medium">
                    {t('community_health.column.last_sign_in')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {health.communities.map((community) => (
                  <tr key={community.id} className="border-t border-divider">
                    <th scope="row" className="sticky start-0 z-10 bg-background px-3 py-2 text-start font-medium text-foreground">
                      <span className="block break-words">{community.name}</span>
                      <span className="mt-1 flex">{status(community)}</span>
                    </th>
                    {FIGURES.map((figure) => (
                      <td key={figure} className="px-3 py-2 text-end tabular-nums text-foreground">
                        {number(community[figure])}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-muted">{day(community.last_sign_in_at)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-divider bg-surface-secondary">
                  <th scope="row" className="sticky start-0 z-10 bg-surface-secondary px-3 py-2 text-start font-semibold text-foreground">
                    {t('community_health.totals_row')}
                  </th>
                  {FIGURES.map((figure) => (
                    <td key={figure} className="px-3 py-2 text-end font-semibold tabular-nums text-foreground">
                      {number(health.totals[figure])}
                    </td>
                  ))}
                  <td className="px-3 py-2" />
                </tr>
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-3 md:hidden" data-testid="community-health-list">
            {health.communities.map((community) => (
              <li key={community.id}>
                <Card>
                  <CardBody className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="min-w-0 break-words text-base font-semibold text-foreground">{community.name}</h2>
                      {status(community)}
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      {FIGURES.map((figure) => (
                        <div key={figure} className="min-w-0">
                          <dt className="text-xs text-muted">{label(figure)}</dt>
                          <dd className="tabular-nums text-foreground">{number(community[figure])}</dd>
                        </div>
                      ))}
                      <div className="col-span-2 min-w-0">
                        <dt className="text-xs text-muted">{t('community_health.column.last_sign_in')}</dt>
                        <dd className="text-foreground">{day(community.last_sign_in_at)}</dd>
                      </div>
                    </dl>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default CommunityHealthPage;
