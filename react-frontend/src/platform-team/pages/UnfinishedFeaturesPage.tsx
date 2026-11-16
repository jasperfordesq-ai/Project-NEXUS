// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Unfinished features.
 *
 * Every feature the admin Features page marks as an early test (alpha) or a
 * late test (beta), plus every feature that stays off unless a community
 * switches it on, and which communities have each one on.
 *
 * 🔴 Read-only: no switch and no link. A feature is switched in that
 * community's own admin panel. Caring Community is listed so a community that
 * has it on is seen, marked "not for use", and nothing here leads to it.
 *
 * Names: the name the admin Features page uses (`admin_config`), so both
 * panels call a feature the same thing. A feature with no card on that page
 * shows its key and says so; whether it has a card is read from the same
 * registry that page draws, not from a copy.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Chip, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { joinList } from '@/lib/listFormat';
import { logError } from '@/lib/logger';
import { getFeatureModules } from '@/admin/modules/config/moduleRegistry';
import Eye from 'lucide-react/icons/eye';
import OctagonAlert from 'lucide-react/icons/octagon-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';

export interface UnfinishedFeatureRow {
  key: string;
  stage: 'alpha' | 'beta' | null;
  default_on: boolean;
  note: 'not_for_use' | null;
  communities_on: { id: number; name: string }[];
  count: number;
}

export interface UnfinishedFeatures {
  features: UnfinishedFeatureRow[];
}

/** The features that have a card on the admin Features page. */
const ON_ADMIN_PAGE = new Set(getFeatureModules().map((module) => module.id));

/** Switches the admin panel has no name for; this panel names them (see the glance page). */
const OWN_NAMES = ['fadp_compliance', 'local_advertising', 'maps'] as const;
type OwnName = (typeof OWN_NAMES)[number];

export function UnfinishedFeaturesPage() {
  const { t, i18n: teamI18n } = useTranslation('platform_team');
  const { t: tConfig, i18n } = useTranslation('admin_config');
  usePageTitle(t('unfinished_features.title'));

  const [result, setResult] = useState<UnfinishedFeatures | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<UnfinishedFeatures>('/v2/platform-team/unfinished-features');
      if (res.success && res.data && Array.isArray(res.data.features)) {
        setResult(res.data);
      } else {
        setResult(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load the unfinished features', err);
      setResult(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (key: string): string => {
    const adminKey = `config.module_name_${key}`;
    if (i18n.exists(adminKey, { ns: 'admin_config' })) return tConfig(adminKey as never);
    if ((OWN_NAMES as readonly string[]).includes(key)) return t(`glance.feature_name.${key as OwnName}`);
    return key;
  };

  const onSomewhere = result ? result.features.filter((feature) => feature.count > 0).length : 0;

  return (
    <section className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('unfinished_features.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('unfinished_features.intro')}</p>
          <p className="mt-2 flex max-w-2xl items-start gap-2 text-sm text-muted">
            <Eye size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t('unfinished_features.read_only')}
          </p>
        </div>
        <Button variant="tertiary" onPress={() => void load()} isDisabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('home.refresh')}
        </Button>
      </div>

      {loading && !result ? (
        <div role="status" aria-busy="true" aria-label={t('unfinished_features.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !result ? (
        <LoadError title={t('unfinished_features.load_error_title')} onRetry={() => void load()} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="text-sm text-muted">
            <p>{t('unfinished_features.summary', { count: result.features.length })}</p>
            <p>{t('unfinished_features.summary_on_somewhere', { count: onSomewhere })}</p>
          </div>

          <ul className="flex flex-col gap-3" data-testid="unfinished-features-list">
            {result.features.map((feature) => (
              <li key={feature.key} data-testid={`unfinished-feature-${feature.key}`}>
                <Card>
                  <CardBody className="flex flex-col gap-2 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="min-w-0 break-words text-base font-semibold text-foreground">{nameOf(feature.key)}</h2>
                      <code className="break-all text-xs text-muted">{feature.key}</code>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {feature.stage ? (
                        <Chip size="sm" variant="soft" color={feature.stage === 'alpha' ? 'warning' : 'accent'}>
                          {t(`unfinished_features.stage.${feature.stage}`)}
                        </Chip>
                      ) : null}
                      {!feature.default_on ? (
                        <Chip size="sm" variant="soft" color="default">
                          {t('unfinished_features.off_unless_switched_on')}
                        </Chip>
                      ) : null}
                      {!ON_ADMIN_PAGE.has(feature.key) ? (
                        <span className="text-xs text-muted">{t('unfinished_features.not_on_admin_page')}</span>
                      ) : null}
                    </div>

                    {feature.note === 'not_for_use' ? (
                      <p className="flex items-start gap-2 text-sm text-danger">
                        <OctagonAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                        {t('unfinished_features.note.not_for_use')}
                      </p>
                    ) : null}

                    {feature.communities_on.length > 0 ? (
                      <div className="text-sm">
                        <p className="font-medium text-foreground">{t('unfinished_features.on_in', { count: feature.count })}</p>
                        <p className="mt-1 break-words text-foreground">
                          {t('unfinished_features.on_names', {
                            names: joinList(feature.communities_on.map((community) => community.name), teamI18n.language),
                          })}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted">{t('unfinished_features.on_nowhere')}</p>
                    )}
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

export default UnfinishedFeaturesPage;
