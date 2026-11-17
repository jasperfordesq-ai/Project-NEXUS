// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Communities at a glance.
 *
 * Every community against every optional feature and every core part: on or
 * off. A wide screen gets a grid (features down, communities across); a
 * narrow one gets a list that names the communities each feature is off in.
 *
 * 🔴 Read-only, and it must stay so. A switch is changed in that community's
 * own admin panel: one place per setting.
 *
 * 🔴 Every cell says "On" or "Off" in words for a screen reader; colour and
 * icon are never the only signal. A feature that is on in a community but
 * held off by a platform-wide switch says exactly that, so "on" is not read
 * as "working".
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Chip, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { joinList } from '@/lib/listFormat';
import { logError } from '@/lib/logger';
import Check from 'lucide-react/icons/check';
import Eye from 'lucide-react/icons/eye';
import Lock from 'lucide-react/icons/lock';
import Minus from 'lucide-react/icons/minus';
import RefreshCw from 'lucide-react/icons/refresh-cw';

interface GridCommunity {
  id: number;
  name: string;
  slug: string | null;
  active: boolean;
  features: Record<string, boolean>;
  modules: Record<string, boolean>;
}

export interface CommunitiesGrid {
  features: string[];
  modules: string[];
  held_platform_wide: string[];
  communities: GridCommunity[];
}

/** Switches the admin panel's own wording does not name. */
const OWN_NAMES = ['fadp_compliance', 'local_advertising', 'maps'] as const;
type OwnName = (typeof OWN_NAMES)[number];

type Kind = 'features' | 'modules';

export function CommunitiesAtAGlancePage() {
  const { t, i18n: teamI18n } = useTranslation('platform_team');
  // The names admins already see for each switch, in every language.
  const { t: tConfig, i18n } = useTranslation('admin_config');
  usePageTitle(t('glance.title'));

  const [grid, setGrid] = useState<CommunitiesGrid | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<CommunitiesGrid>('/v2/platform-team/communities');
      if (res.success && res.data && Array.isArray(res.data.communities) && Array.isArray(res.data.features)) {
        setGrid(res.data);
      } else {
        setGrid(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load the communities at a glance grid', err);
      setGrid(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (key: string): string => {
    if ((OWN_NAMES as readonly string[]).includes(key)) return t(`glance.feature_name.${key as OwnName}`);
    const adminKey = `config.module_name_${key}`;
    // A switch added on the server before it has a name still gets a row.
    return i18n.exists(adminKey, { ns: 'admin_config' }) ? tConfig(adminKey as never) : key;
  };

  const held = new Set(grid?.held_platform_wide ?? []);

  const isOn = (community: GridCommunity, kind: Kind, key: string): boolean =>
    kind === 'features' ? community.features[key] === true : community.modules[key] === true;

  const countOn = (kind: Kind, key: string): number =>
    grid ? grid.communities.filter((c) => isOn(c, kind, key)).length : 0;

  const state = (on: boolean, isHeld: boolean) => {
    if (on && isHeld) {
      return (
        <span className="inline-flex items-center justify-center text-warning" title={t('glance.held')}>
          <Lock size={16} aria-hidden="true" />
          <span className="sr-only">{t('glance.held')}</span>
        </span>
      );
    }
    return on ? (
      <span className="inline-flex items-center justify-center text-success" title={t('glance.on')}>
        <Check size={16} aria-hidden="true" />
        <span className="sr-only">{t('glance.on')}</span>
      </span>
    ) : (
      <span className="inline-flex items-center justify-center text-muted" title={t('glance.off')}>
        <Minus size={16} aria-hidden="true" />
        <span className="sr-only">{t('glance.off')}</span>
      </span>
    );
  };

  const table = (kind: Kind, keys: string[], caption: string, all: GridCommunity[]) => (
    <div className="overflow-x-auto rounded-xl border border-divider">
      <table className="w-full border-collapse text-sm" data-testid={`glance-${kind}`}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-surface-secondary text-start text-xs text-muted">
            <th scope="col" className="sticky start-0 z-10 min-w-48 bg-surface-secondary px-3 py-2 text-start align-bottom font-medium">
              {t('glance.switch_column')}
            </th>
            <th scope="col" className="min-w-28 px-3 py-2 text-start align-bottom font-medium">
              {t('glance.count_column')}
            </th>
            {all.map((community) => (
              <th key={community.id} scope="col" className="min-w-24 max-w-32 px-2 py-2 text-center align-bottom font-medium">
                <span className="block break-words text-foreground">{community.name}</span>
                {!community.active ? (
                  <span className="mt-1 block text-[11px] font-normal text-warning-soft-foreground">{t('glance.not_active')}</span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const isHeld = kind === 'features' && held.has(key);
            return (
              <tr key={key} className="border-t border-divider">
                <th scope="row" className="sticky start-0 z-10 bg-background px-3 py-2 text-start font-medium text-foreground">
                  {nameOf(key)}
                </th>
                <td className="px-3 py-2 text-muted">
                  {t('glance.on_in', { count: countOn(kind, key), total: all.length })}
                </td>
                {all.map((community) => (
                  <td key={community.id} className="px-2 py-2 text-center">
                    {state(isOn(community, kind, key), isHeld)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const list = (kind: Kind, keys: string[], all: GridCommunity[]) => (
    <ul className="flex flex-col gap-2">
      {keys.map((key) => {
        const on = countOn(kind, key);
        const off = all.filter((c) => !isOn(c, kind, key));
        return (
          <li key={key} data-testid={`glance-item-${key}`}>
            <Card>
              <CardBody className="p-4">
                <h3 className="text-base font-semibold text-foreground">{nameOf(key)}</h3>
                <p className="mt-1 text-sm text-muted">{t('glance.on_in', { count: on, total: all.length })}</p>
                {kind === 'features' && held.has(key) && on > 0 ? (
                  <p className="mt-1 flex items-start gap-1 text-sm text-warning-soft-foreground">
                    <Lock size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                    {t('glance.held')}
                  </p>
                ) : null}
                <p className="mt-1 text-sm text-foreground">
                  {off.length === 0
                    ? t('glance.on_everywhere')
                    : on === 0
                      ? t('glance.off_everywhere')
                      : t('glance.off_in', { names: joinList(off.map((c) => c.name), teamI18n.language) })}
                </p>
              </CardBody>
            </Card>
          </li>
        );
      })}
    </ul>
  );

  return (
    <section className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('glance.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('glance.intro')}</p>
          <p className="mt-2 flex max-w-2xl items-start gap-2 text-sm text-muted">
            <Eye size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t('glance.read_only_note')}
          </p>
        </div>
        <Button variant="tertiary" onPress={() => void load()} isDisabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('home.refresh')}
        </Button>
      </div>

      {loading && !grid ? (
        <div role="status" aria-busy="true" aria-label={t('glance.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !grid ? (
        <LoadError title={t('glance.load_error_title')} onRetry={() => void load()} />
      ) : grid.communities.length === 0 ? (
        <p className="text-sm text-muted">{t('glance.empty')}</p>
      ) : (
        <div className="flex flex-col gap-8">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            <Chip size="sm" variant="soft" color="default">
              {t('glance.community_count', { count: grid.communities.length })}
            </Chip>
            <span className="inline-flex items-center gap-1">
              <Check size={14} className="text-success" aria-hidden="true" />
              {t('glance.on')}
            </span>
            <span className="inline-flex items-center gap-1">
              <Minus size={14} aria-hidden="true" />
              {t('glance.off')}
            </span>
            {held.size > 0 ? (
              <span className="inline-flex items-center gap-1 text-warning-soft-foreground">
                <Lock size={14} className="text-warning" aria-hidden="true" />
                {t('glance.held')}
              </span>
            ) : null}
          </div>

          {held.size > 0 ? (
            <p className="max-w-2xl text-sm text-warning-soft-foreground" role="status">
              {t('glance.held_note')}
            </p>
          ) : null}

          <section aria-labelledby="glance-features-heading">
            <h2 id="glance-features-heading" className="mb-3 text-lg font-semibold text-foreground">
              {t('glance.features_heading')}
            </h2>
            <div className="hidden md:block">
              {table('features', grid.features, t('glance.features_heading'), grid.communities)}
            </div>
            <div className="md:hidden" data-testid="glance-list">
              {list('features', grid.features, grid.communities)}
            </div>
          </section>

          <section aria-labelledby="glance-modules-heading">
            <h2 id="glance-modules-heading" className="mb-1 text-lg font-semibold text-foreground">
              {t('glance.modules_heading')}
            </h2>
            <p className="mb-3 max-w-2xl text-sm text-muted">{t('glance.modules_note')}</p>
            <div className="hidden md:block">
              {table('modules', grid.modules, t('glance.modules_heading'), grid.communities)}
            </div>
            <div className="md:hidden">{list('modules', grid.modules, grid.communities)}</div>
          </section>
        </div>
      )}
    </section>
  );
}

export default CommunitiesAtAGlancePage;
