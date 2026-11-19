import { getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Spinner, Chip, Switch } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';
import { Slider } from '@/components/ui';
import { Separator } from '@/components/ui';
import Settings from 'lucide-react/icons/settings';
import Save from 'lucide-react/icons/save';
import Activity from 'lucide-react/icons/activity';
import Database from 'lucide-react/icons/database';
import Cpu from 'lucide-react/icons/cpu';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Search from 'lucide-react/icons/search';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { PageHeader } from '../../components/PageHeader';
import { adminSettings } from '../../api/adminApi';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Algorithm Settings
 * Configure EdgeRank (feed), MatchRank (listings), CommunityRank (members), * and SmartMatch parameters. Shows algorithm health status.
 */


// ─── Types ────────────────────────────────────────────────────────────────────

interface AlgorithmWeights {
  [key: string]: number;
}

interface AlgorithmArea {
  area: string;
  labelKey: string;
  descriptionKey: string;
  enabled: boolean;
  weights: AlgorithmWeights;
  params: SliderParam[];
}

interface SliderParam {
  key: string;
  labelKey: string;
  descriptionKey: string;
  min: number;
  max: number;
  step: number;
}

interface HealthStatus {
  fulltext: {
    listings: boolean;
    users: boolean;
    feed_activity: boolean;
  };
  collaborative_filtering: {
    listing_interactions: number;
    member_interactions: number;
  };
  embeddings: {
    listing_count: number;
    user_count: number;
    total: number;
  };
  search?: {
    meilisearch_available: boolean;
    listing_index_count?: number;
  };
}

// ─── Algorithm Parameter Definitions ─────────────────────────────────────────

const ALGORITHM_AREAS: Omit<AlgorithmArea, 'enabled' | 'weights'>[] = [
  {
    area: 'feed',
    labelKey: 'area_feed_ranking',
    descriptionKey: 'area_feed_ranking_desc',
    params: [
      { key: 'affinity_weight',     labelKey: 'param_affinity_weight',      descriptionKey: 'param_affinity_weight_desc',      min: 0, max: 1,    step: 0.05 },
      { key: 'content_type_weight', labelKey: 'param_content_type_weight',  descriptionKey: 'param_content_type_weight_desc',  min: 0, max: 1,    step: 0.05 },
      { key: 'time_decay_weight',   labelKey: 'param_time_decay_weight',    descriptionKey: 'param_time_decay_weight_desc',    min: 0, max: 1,    step: 0.05 },
      { key: 'engagement_weight',   labelKey: 'param_engagement_weight',    descriptionKey: 'param_engagement_weight_desc',    min: 0, max: 1,    step: 0.05 },
      { key: 'freshness_minimum',   labelKey: 'param_freshness_minimum',    descriptionKey: 'param_freshness_minimum_desc',    min: 0, max: 0.5,  step: 0.05 },
      { key: 'half_life_hours',     labelKey: 'param_half_life_hours',      descriptionKey: 'param_half_life_hours_desc',      min: 1, max: 168,  step: 1    },
    ],
  },
  {
    area: 'listings',
    labelKey: 'area_listings_ranking',
    descriptionKey: 'area_listings_ranking_desc',
    params: [
      { key: 'skill_match_weight',  labelKey: 'param_skill_match_weight',   descriptionKey: 'param_skill_match_weight_desc',   min: 0, max: 1, step: 0.05 },
      { key: 'location_weight',     labelKey: 'param_location_weight',      descriptionKey: 'param_location_weight_desc',      min: 0, max: 1, step: 0.05 },
      { key: 'quality_weight',      labelKey: 'param_quality_weight',       descriptionKey: 'param_quality_weight_desc',       min: 0, max: 1, step: 0.05 },
      { key: 'freshness_weight',    labelKey: 'param_freshness_weight',     descriptionKey: 'param_freshness_weight_desc',     min: 0, max: 1, step: 0.05 },
      { key: 'engagement_weight',   labelKey: 'param_listing_engagement_weight', descriptionKey: 'param_listing_engagement_weight_desc', min: 0, max: 1, step: 0.05 },
      { key: 'reputation_weight',   labelKey: 'param_reputation_weight',    descriptionKey: 'param_reputation_weight_desc',    min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    area: 'members',
    labelKey: 'area_member_ranking',
    descriptionKey: 'area_member_ranking_desc',
    params: [
      { key: 'reputation_weight',   labelKey: 'param_member_reputation_weight',    descriptionKey: 'param_member_reputation_weight_desc',    min: 0, max: 1, step: 0.05 },
      { key: 'contribution_weight', labelKey: 'param_contribution_weight',         descriptionKey: 'param_contribution_weight_desc',         min: 0, max: 1, step: 0.05 },
      { key: 'activity_weight',     labelKey: 'param_activity_weight',             descriptionKey: 'param_activity_weight_desc',             min: 0, max: 1, step: 0.05 },
      { key: 'connectivity_weight', labelKey: 'param_connectivity_weight',         descriptionKey: 'param_connectivity_weight_desc',         min: 0, max: 1, step: 0.05 },
      { key: 'proximity_weight',    labelKey: 'param_proximity_weight',            descriptionKey: 'param_proximity_weight_desc',            min: 0, max: 1, step: 0.05 },
    ],
  },
  // No 'matching' area. One sat here until 19 Nov 2026 with four sliders the
  // matching engine has never had; the server neither sent it values nor
  // accepted a save for it (AdminConfigController knows feed, listings and
  // members only). Smart matching is set on its own page, Admin > Smart Matching.
];

// ─── Component ────────────────────────────────────────────────────────────────

export function AlgorithmSettings() {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced' });
  const { t: tNav } = useTranslation('admin_nav');
  usePageTitle(tNav('advanced'));
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const [areas, setAreas] = useState<AlgorithmArea[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const res = await adminSettings.getAlgorithmConfig();
      const data = (res.data ?? {}) as Record<string, unknown>;

      setAreas(ALGORITHM_AREAS.map(def => {
        const areaData = (data[def.area] ?? {}) as Record<string, unknown>;
        const weights: AlgorithmWeights = {};
        def.params.forEach(p => {
          weights[p.key] = typeof areaData[p.key] === 'number'
            ? (areaData[p.key] as number)
            : getDefaultWeight(def.area, p.key);
        });
        return {
          ...def,
          enabled: areaData.enabled !== false,
          weights,
        };
      }));
    } catch {
      toast.error(t('failed_to_load_algorithm_settings'));
      // Initialise with defaults
      setAreas(ALGORITHM_AREAS.map(def => ({
        ...def,
        enabled: true,
        weights: Object.fromEntries(def.params.map(p => [p.key, getDefaultWeight(def.area, p.key)])),
      })));
    } finally {
      setLoading(false);
    }
  }, [t, toast])


  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const res = await adminSettings.getAlgorithmHealth();
      const raw = (res.data ?? null) as Record<string, unknown> | null;
      if (!raw) { setHealth(null); return; }

      // Normalise backend keys to match frontend HealthStatus shape
      const ft = (raw.fulltext ?? raw.fulltext_indexes ?? {}) as HealthStatus['fulltext'];
      const cf = (raw.collaborative_filtering ?? raw.collaborative_filter ?? {}) as Record<string, number>;
      const emb = (raw.embeddings ?? {}) as Record<string, number>;

      setHealth({
        fulltext: {
          listings: ft?.listings ?? false,
          users: ft?.users ?? false,
          feed_activity: ft?.feed_activity ?? false,
        },
        collaborative_filtering: {
          listing_interactions: cf?.listing_interactions ?? 0,
          member_interactions: cf?.member_interactions ?? cf?.member_pairs ?? 0,
        },
        embeddings: {
          listing_count: emb?.listing_count ?? 0,
          user_count: emb?.user_count ?? 0,
          total: emb?.total ?? ((emb?.listing_count ?? 0) + (emb?.user_count ?? 0)),
        },
        search: raw.search as HealthStatus['search'],
      });
    } catch {
      // Health is optional — don't toast
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadHealth();
  }, [loadConfig, loadHealth]);

  const updateWeight = (area: string, key: string, value: number) => {
    setAreas(prev => prev.map(a =>
      a.area === area
        ? { ...a, weights: { ...a.weights, [key]: value } }
        : a
    ));
  };

  const toggleEnabled = (area: string, enabled: boolean) => {
    setAreas(prev => prev.map(a => a.area === area ? { ...a, enabled } : a));
  };

  const handleSave = async (areaData: AlgorithmArea) => {
    setSaving(areaData.area);
    try {
      const payload = { enabled: areaData.enabled, ...areaData.weights };
      const res = await adminSettings.updateAlgorithmConfig(areaData.area, payload);
      if ((res as { success?: boolean }).success) {
        toast.success(t('area_settings_saved'));
      } else {
        toast.error(t('save_failed'));
      }
    } catch {
      toast.error(t('failed_to_save_area'));
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center" role="status" aria-label={t('loading')} aria-busy="true">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('algorithm_settings_title')}
        description={t('algorithm_settings_desc')}
      />

      <div className="space-y-6">

        {/* ── Algorithm Cards ── */}
        {areas.map(areaData => (
          <Card key={areaData.area} >
            <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row">
              <div className="flex items-center gap-3">
                <Cpu size={20} className="text-accent shrink-0" aria-hidden="true" />
                <div>
                  <h3 className="text-base font-semibold">{t(areaData.labelKey)}</h3>
                  <p className="text-sm text-theme-muted">{t(areaData.descriptionKey)}</p>
                </div>
              </div>
              <Switch
                isSelected={areaData.enabled}
                onValueChange={v => toggleEnabled(areaData.area, v)}
                size="sm"
                aria-label={t('enable_area', { area: t(areaData.labelKey) })}
              >
                {areaData.enabled ? t('enabled') : t('disabled')}
              </Switch>
            </CardHeader>

            {areaData.enabled && (
              <CardBody className="gap-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                  {areaData.params.map(param => (
                    <div key={param.key}>
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">{t(param.labelKey)}</p>
                        <Chip size="sm" variant="soft">
                          {(areaData.weights[param.key] ?? param.min).toFixed(param.step < 1 ? 2 : 0)}
                        </Chip>
                      </div>
                      <p className="text-xs text-theme-muted mb-2">{t(param.descriptionKey)}</p>
                      <Slider
                        minValue={param.min}
                        maxValue={param.max}
                        step={param.step}
                        value={areaData.weights[param.key] ?? param.min}
                        onChange={v => updateWeight(areaData.area, param.key, v as number)}
                        className="max-w-sm"
                        aria-label={t(param.labelKey)}
                        showTooltip
                      />
                    </div>
                  ))}
                </div>

                <Separator />

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    startContent={<Save size={14} aria-hidden="true" />}
                    onPress={() => handleSave(areaData)}
                    isLoading={saving === areaData.area}
                    isDisabled={saving === areaData.area}
                  >
                    {t('save_area')}
                  </Button>
                </div>
              </CardBody>
            )}

            {!areaData.enabled && (
              <CardBody>
                <p className="text-sm text-theme-subtle italic">
                  {t('algorithm_disabled_msg')}
                </p>
                <div className="flex justify-end mt-3">
                  <Button
                    size="sm"
                    startContent={<Save size={14} aria-hidden="true" />}
                    onPress={() => handleSave(areaData)}
                    isLoading={saving === areaData.area}
                    isDisabled={saving === areaData.area}
                  >
                    {t('save_area')}
                  </Button>
                </div>
              </CardBody>
            )}
          </Card>
        ))}

        {/* ── Health Dashboard ── */}
        <Card >
          <CardHeader className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity size={20} className="text-accent" aria-hidden="true" />
              <div>
                <h3 className="text-base font-semibold">{t('algorithm_health_title')}</h3>
                <p className="text-sm text-theme-muted">
                  {t('algorithm_health_desc')}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="tertiary"
              startContent={<RefreshCw size={14} className={healthLoading ? 'animate-spin' : ''} aria-hidden="true" />}
              onPress={loadHealth}
              isDisabled={healthLoading}
            >
              {t('btn_refresh')}
            </Button>
          </CardHeader>

          <CardBody className="gap-4">
            {healthLoading && !health && (
              <div className="flex justify-center py-4" role="status" aria-label={t('health_loading')} aria-busy="true"><Spinner size="sm" /></div>
            )}

            {health && (
              <>
                {/* FULLTEXT */}
                <div>
                  <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <Database size={14} aria-hidden="true" /> {t('fulltext_indexes_title')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {([
                      ['listings', health.fulltext.listings],
                      ['users',    health.fulltext.users],
                      ['feed_activity', health.fulltext.feed_activity],
                    ] as [string, boolean][]).map(([table, ok]) => (
                      <Chip
                        key={table}
                        size="sm"
                        color={ok ? 'success' : 'danger'}
                        variant="soft"
                        startContent={ok ? <CheckCircle size={12} aria-hidden="true" /> : <XCircle size={12} aria-hidden="true" />}
                      >
                        {table}
                      </Chip>
                    ))}
                  </div>
                  {(!health.fulltext.listings || !health.fulltext.users || !health.fulltext.feed_activity) && (
                    <p className="text-xs text-warning mt-2">
                      {t('missing_indexes_hint_prefix')}{' '}
                      {/* eslint-disable-next-line i18next/no-literal-string -- CLI command must remain verbatim. */}
                      <code className="bg-surface-secondary px-1 rounded">php scripts/safe_migrate.php</code>{' '}
                      {t('missing_indexes_hint_suffix')}
                    </p>
                  )}
                </div>

                <Separator />

                {/* Collaborative Filtering */}
                <div>
                  <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <Settings size={14} aria-hidden="true" /> {t('collaborative_filtering_title')}
                  </p>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <span>
                      <span className="font-medium">{health.collaborative_filtering.listing_interactions.toLocaleString(getFormattingLocale())}</span>
                      <span className="text-theme-muted ml-1">{t('listing_saves')}</span>
                    </span>
                    <span>
                      <span className="font-medium">{health.collaborative_filtering.member_interactions.toLocaleString(getFormattingLocale())}</span>
                      <span className="text-theme-muted ml-1">{t('member_transactions')}</span>
                    </span>
                  </div>
                  {health.collaborative_filtering.listing_interactions < 10 && (
                    <p className="text-xs text-theme-subtle mt-1">
                      {t('cf_min_hint')}
                    </p>
                  )}
                </div>

                <Separator />

                {/* Embeddings */}
                <div>
                  <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <Cpu size={14} aria-hidden="true" /> {t('semantic_embeddings_title')}
                  </p>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <span>
                      <span className="font-medium">{health.embeddings.listing_count.toLocaleString(getFormattingLocale())}</span>
                      <span className="text-theme-muted ml-1">{t('label_listings')}</span>
                    </span>
                    <span>
                      <span className="font-medium">{health.embeddings.user_count.toLocaleString(getFormattingLocale())}</span>
                      <span className="text-theme-muted ml-1">{t('label_users')}</span>
                    </span>
                    <Chip
                      size="sm"
                      color={health.embeddings.total > 0 ? 'success' : 'default'}
                      variant="tertiary"
                    >
                      {t('total_count', { count: health.embeddings.total })}
                    </Chip>
                  </div>
                  {health.embeddings.total === 0 && (
                    <p className="text-xs text-theme-subtle mt-2">
                      {t('generate_embeddings_hint_prefix')}{' '}
                      {/* eslint-disable-next-line i18next/no-literal-string -- CLI command must remain verbatim. */}
                      <code className="bg-surface-secondary px-1 rounded">php scripts/backfill_embeddings.php --tenant=&lt;id&gt;</code>{' '}
                      {t('generate_embeddings_hint_suffix')}
                    </p>
                  )}
                </div>

                {health.search && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                        <Search size={14} aria-hidden="true" /> {t('search_engine_title')}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Chip
                          size="sm"
                          color={health.search.meilisearch_available ? 'success' : 'warning'}
                          variant="soft"
                          startContent={health.search.meilisearch_available ? <CheckCircle size={12} aria-hidden="true" /> : <XCircle size={12} aria-hidden="true" />}
                        >
                          {health.search.meilisearch_available ? t('meilisearch_online') : t('meilisearch_offline')}
                        </Chip>
                      </div>
                      {!health.search.meilisearch_available && (
                        <p className="text-xs text-theme-subtle mt-2">
                          {t('sync_search_hint_prefix')}{' '}
                          {/* eslint-disable-next-line i18next/no-literal-string -- CLI command must remain verbatim. */}
                          <code className="bg-surface-secondary px-1 rounded">php scripts/sync_search_index.php --all-tenants</code>{' '}
                          {t('sync_search_hint_suffix')}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {!health && !healthLoading && (
              <p className="text-sm text-theme-subtle">{t('health_unavailable')}</p>
            )}
          </CardBody>
        </Card>

      </div>
    </div>
  );
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

function getDefaultWeight(area: string, key: string): number {
  const defaults: Record<string, Record<string, number>> = {
    feed: {
      affinity_weight: 0.3,
      content_type_weight: 0.25,
      time_decay_weight: 0.25,
      engagement_weight: 0.2,
      freshness_minimum: 0.1,
      half_life_hours: 24,
    },
    listings: {
      skill_match_weight: 0.3,
      location_weight: 0.2,
      quality_weight: 0.2,
      freshness_weight: 0.15,
      engagement_weight: 0.1,
      reputation_weight: 0.05,
    },
    members: {
      reputation_weight: 0.2,
      contribution_weight: 0.25,
      activity_weight: 0.25,
      connectivity_weight: 0.2,
      proximity_weight: 0.1,
    },
  };
  return defaults[area]?.[key] ?? 0.2;
}

export default AlgorithmSettings;
