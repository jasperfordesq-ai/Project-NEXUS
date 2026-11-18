// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Card, CardBody, CardHeader, Input, Button, Spinner, Switch, Select, SelectItem, Tooltip, Chip, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Slider } from '@/components/ui';
import { Separator } from '@/components/ui';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Save from 'lucide-react/icons/save';
import Trash2 from 'lucide-react/icons/trash-2';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Lock from 'lucide-react/icons/lock';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminMatching } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import type {
  SmartMatchingConfig,
  MatchingGatesConfig,
  MatchingAiConfig,
  MatchingPillarWeights,
} from '../../api/types';
import { useTranslation } from 'react-i18next';
import { logError } from '@/lib/logger';
import { formatPercentValue } from '@/lib/helpers';
import { isSmartMatchingConfig } from './matchingResponseGuards';

/**
 * Matching Configuration Page
 *
 * What an admin can change about smart matching for their community: the
 * master switch, the score and distance limits, the scoring weights, the
 * hard gates, the AI layer and the five distance bands.
 *
 * Three things this page deliberately does NOT offer:
 *  - a "broker approval" switch. Whether a match waits for a coordinator is
 *    decided by members' safeguarding choices, not by a setting; the old
 *    switch here was never read by anything.
 *  - a "score" for each distance band. The scorer's band scores are fixed;
 *    the old editable column was thrown away by the server on every save.
 *  - a way to change the scoring method. It shows the weights of whichever
 *    method the community is on (three for the current one, six for the
 *    older one).
 */

/** Proximity band label mapping */
const BAND_LABEL_KEYS = ['matching.band_walking', 'matching.band_local', 'matching.band_city', 'matching.band_regional', 'matching.band_max'];

/**
 * Defaults for "Reset to defaults". They mirror the defaults block at the top
 * of SmartMatchingEngine::getConfig() — change both together.
 */
const DEFAULT_GATES: MatchingGatesConfig = {
  geo_hard_gate: true,
  missing_coords_mode: 'remote_only',
  dormancy_days: 90,
  owner_dismissal_threshold: 3,
};

const DEFAULT_PILLARS: MatchingPillarWeights = { relevance: 0.45, feasibility: 0.35, trust: 0.20 };

const DEFAULT_AI: Omit<MatchingAiConfig, 'available'> = {
  semantic_signal: true,
  llm_explanations: true,
  explanation_top_n: 5,
};

const DEFAULT_CONFIG: SmartMatchingConfig = {
  category_weight: 0.25,
  skill_weight: 0.20,
  proximity_weight: 0.25,
  freshness_weight: 0.10,
  reciprocity_weight: 0.15,
  quality_weight: 0.05,
  proximity_bands: [
    { distance_km: 5 },
    { distance_km: 15 },
    { distance_km: 30 },
    { distance_km: 50 },
    { distance_km: 100 },
  ],
  enabled: true,
  max_distance_km: 50,
  min_match_score: 40,
  hot_match_threshold: 80,
  gates: DEFAULT_GATES,
  engine_version: 2,
  pillars: DEFAULT_PILLARS,
  ai: { ...DEFAULT_AI, available: false },
};

const PILLARS: Array<{ key: keyof MatchingPillarWeights; label: string; description: string }> = [
  { key: 'relevance', label: 'matching.pillar_relevance', description: 'matching.pillar_relevance_desc' },
  { key: 'feasibility', label: 'matching.pillar_feasibility', description: 'matching.pillar_feasibility_desc' },
  { key: 'trust', label: 'matching.pillar_trust', description: 'matching.pillar_trust_desc' },
];

/** The limits the server enforces (AdminMatchingController::validateConfigInput). */
const MAX_DISTANCE_KM = 20000;

/**
 * If the server refuses a save anyway, it names the field. The page words the
 * refusal itself, in the admin's language, from that field name.
 */
const REFUSED_FIELD_KEYS: Record<string, string> = {
  max_distance_km: 'matching.error_max_distance_range',
  min_match_score: 'matching.error_score_range',
  hot_match_threshold: 'matching.error_hot_below_min',
  proximity_bands: 'matching.error_band_ascending',
  pillars: 'matching.error_pillars_all_zero',
};

/** '' (a cleared field) is "not a number", never a silent default. */
function toNumber(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

function fieldValue(value: number | undefined): string {
  return value === undefined || Number.isNaN(value) ? '' : String(value);
}

function inRange(value: number | undefined, min: number, max: number): boolean {
  return value !== undefined && Number.isFinite(value) && value >= min && value <= max;
}

export function MatchingConfig() {
  const { t } = useTranslation('admin_matching');
  usePageTitle(t('matching.page_title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  const [config, setConfig] = useState<SmartMatchingConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [hasConfirmedConfig, setHasConfirmedConfig] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const requestIdRef = useRef(0);

  const loadConfig = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const res = await adminMatching.getConfig();
      if (requestId !== requestIdRef.current) return;
      if (res.success && isSmartMatchingConfig(res.data)) {
        setConfig(res.data);
        setDirty(false);
        setHasConfirmedConfig(true);
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      logError('Failed to load matching configuration', err);
      setLoadFailed(true);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);


  useEffect(() => {
    void loadConfig();
    return () => { requestIdRef.current += 1; };
  }, [loadConfig]);

  /** Update a top-level numeric setting */
  const updateNumber = useCallback(
    (key: keyof SmartMatchingConfig, value: number) => {
      setConfig((prev) => ({ ...prev, [key]: value }));
      setDirty(true);
    },
    []
  );

  /** Update one of the three scoring weights (current scoring method) */
  const updatePillar = useCallback(
    (key: keyof MatchingPillarWeights, value: number) => {
      setConfig((prev) => ({ ...prev, pillars: { ...DEFAULT_PILLARS, ...prev.pillars, [key]: value } }));
      setDirty(true);
    },
    []
  );

  /** Update a proximity band's distance */
  const updateBand = useCallback(
    (index: number, value: number) => {
      setConfig((prev) => {
        const bands = [...(prev.proximity_bands || [])];
        bands[index] = { distance_km: value };
        return { ...prev, proximity_bands: bands };
      });
      setDirty(true);
    },
    []
  );

  /** Update a field within gates config */
  const updateGate = useCallback(
    <K extends keyof MatchingGatesConfig>(key: K, value: MatchingGatesConfig[K]) => {
      setConfig((prev) => ({
        ...prev,
        gates: { ...DEFAULT_GATES, ...prev.gates, [key]: value },
      }));
      setDirty(true);
    },
    []
  );

  /** Update a field within AI config */
  const updateAi = useCallback(
    <K extends keyof MatchingAiConfig>(key: K, value: MatchingAiConfig[K]) => {
      setConfig((prev) => ({
        ...prev,
        ai: {
          ...DEFAULT_AI,
          available: prev.ai?.available ?? false,
          ...prev.ai,
          [key]: value,
        },
      }));
      setDirty(true);
    },
    []
  );

  // The older scoring method (1) is still supported as a rollback; anything
  // else, including a config that does not say, is the current one (2).
  const isLegacyScoring = config.engine_version === 1;
  const gates = config.gates ?? DEFAULT_GATES;
  const pillars = config.pillars ?? DEFAULT_PILLARS;

  /** Total of the six older weights */
  const totalWeight = useMemo(() => {
    return (
      config.category_weight +
      config.skill_weight +
      config.proximity_weight +
      config.freshness_weight +
      config.reciprocity_weight +
      config.quality_weight
    );
  }, [config]);

  const totalPct = Math.round(totalWeight * 100);
  const totalValid = totalPct >= 95 && totalPct <= 105;
  const pillarTotal = pillars.relevance + pillars.feasibility + pillars.trust;

  /**
   * Field errors, worked out before anything is sent. The server enforces the
   * same limits and refuses the save; this is so the admin sees which field.
   */
  const errors = useMemo(() => {
    const bands = config.proximity_bands || [];
    const bandErrors: Array<string | undefined> = [];
    let previous = 0;
    bands.forEach((band, index) => {
      const distance = band.distance_km;
      const ok = inRange(distance, 1, MAX_DISTANCE_KM) && distance > previous;
      bandErrors[index] = ok ? undefined : t('matching.error_band_ascending');
      if (Number.isFinite(distance)) previous = Math.max(previous, distance);
    });

    const minOk = inRange(config.min_match_score, 0, 100);
    const hotOk = inRange(config.hot_match_threshold, 0, 100);
    let hot: string | undefined;
    if (!hotOk) hot = t('matching.error_score_range');
    else if (minOk && (config.hot_match_threshold ?? 0) < (config.min_match_score ?? 0)) {
      hot = t('matching.error_hot_below_min');
    }

    return {
      maxDistance: inRange(config.max_distance_km, 1, MAX_DISTANCE_KM)
        ? undefined
        : t('matching.error_max_distance_range'),
      minScore: minOk ? undefined : t('matching.error_score_range'),
      hot,
      bands: bandErrors,
      pillars: !isLegacyScoring && !(pillarTotal > 0) ? t('matching.error_pillars_all_zero') : undefined,
      weights: isLegacyScoring && !totalValid ? t('matching.weights_must_sum_to_100') : undefined,
    };
  }, [config, isLegacyScoring, pillarTotal, totalValid, t]);

  const hasErrors = Boolean(
    errors.maxDistance || errors.minScore || errors.hot || errors.pillars || errors.weights
      || errors.bands.some(Boolean)
  );

  /** Save config to API */
  const handleSave = useCallback(async () => {
    if (!hasConfirmedConfig || loadFailed) {
      toast.error(t('matching.failed_to_load_matching_configuration'));
      return;
    }

    if (hasErrors) {
      toast.error(errors.weights ?? errors.pillars ?? t('matching.error_fix_fields'));
      return;
    }

    // Only what this page shows is sent. The weights of the scoring method
    // the community is NOT on stay as stored, so a hidden value can never
    // block a save.
    const payload: Partial<SmartMatchingConfig> = {
      enabled: config.enabled ?? true,
      max_distance_km: config.max_distance_km,
      min_match_score: config.min_match_score,
      hot_match_threshold: config.hot_match_threshold,
      proximity_bands: (config.proximity_bands || []).map((band) => ({ distance_km: band.distance_km })),
      gates,
      ...(config.ai ? { ai: config.ai } : {}),
      ...(isLegacyScoring
        ? {
          category_weight: config.category_weight,
          skill_weight: config.skill_weight,
          proximity_weight: config.proximity_weight,
          freshness_weight: config.freshness_weight,
          reciprocity_weight: config.reciprocity_weight,
          quality_weight: config.quality_weight,
        }
        : { pillars }),
    };

    setSaving(true);
    try {
      const res = await adminMatching.updateConfig(payload);
      if (res.success) {
        toast.success(t('matching.matching_configuration_saved_successfull'));
        setDirty(false);
      } else {
        const refusedKey = REFUSED_FIELD_KEYS[res.errors?.[0]?.field ?? ''];
        toast.error(refusedKey ? t(refusedKey) : t('matching.failed_to_save_configuration'));
      }
    } catch {
      toast.error(t('matching.failed_to_save_configuration'));
    } finally {
      setSaving(false);
    }
  }, [config, errors, gates, hasConfirmedConfig, hasErrors, isLegacyScoring, loadFailed, pillars, t, toast])


  /** Clear cache */
  const handleClearCache = useCallback(async () => {
    setClearing(true);
    try {
      const res = await adminMatching.clearCache();
      if (res.success) {
        const cleared = (res.data as { entries_cleared?: unknown } | undefined)?.entries_cleared;
        toast.success(
          typeof cleared === 'number' && Number.isFinite(cleared)
            ? t('matching.cache_cleared_count', { count: cleared })
            : t('matching.cache_cleared')
        );
        setClearModalOpen(false);
      } else {
        toast.error(t('matching.failed_to_clear_cache'));
      }
    } catch {
      toast.error(t('matching.failed_to_clear_cache'));
    } finally {
      setClearing(false);
    }
  }, [t, toast])


  /**
   * Reset every setting on the page — limits, weights, gates, AI and bands —
   * to its default. What is not a setting is kept: which scoring method the
   * community is on, and whether AI is available to it at all. Nothing is
   * saved until the admin presses Save.
   */
  const handleReset = useCallback(() => {
    setConfig((prev) => ({
      ...DEFAULT_CONFIG,
      engine_version: prev.engine_version ?? 2,
      ...(prev.adjustments ? { adjustments: prev.adjustments } : {}),
      ai: { ...DEFAULT_AI, available: prev.ai?.available ?? false },
    }));
    setDirty(true);
    setResetModalOpen(false);
    toast.info(t('matching.configuration_reset_to_defaults_save_to'));
  }, [t, toast])


  if (loading && !hasConfirmedConfig) {
    return (
      <div>
        <PageHeader
          title={t('matching.matching_config_title')}
          description={t('matching.matching_config_desc')}
        />
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex h-64 items-center justify-center">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (loadFailed && !hasConfirmedConfig) {
    return (
      <div>
        <PageHeader title={t('matching.matching_config_title')} description={t('matching.matching_config_desc')} />
        <div role="alert">
          <EmptyState icon={AlertTriangle} title={t('matching.failed_to_load_matching_configuration')} actionLabel={t('common.retry')} onAction={loadConfig} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('matching.matching_config_title')}
        description={t('matching.matching_config_desc')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="tertiary"
              startContent={<ArrowLeft size={16} />}
              onPress={() => navigate(tenantPath('/admin/smart-matching'))}
              size="sm"
            >
              {t('matching.back')}
            </Button>
            <Button
              variant="tertiary"
              startContent={<RefreshCw size={16} aria-hidden="true" />}
              onPress={loadConfig}
              isLoading={loading}
              size="sm"
            >
              {t('common.refresh')}
            </Button>
            <Button
              startContent={<Save size={16} />}
              onPress={handleSave}
              isLoading={saving}
              isDisabled={!dirty || loadFailed}
              size="sm"
            >
              {t('matching.save_changes')}
            </Button>
          </div>
        }
      />

      {loadFailed && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-danger sm:flex-row sm:items-center sm:justify-between" role="alert">
          <div className="flex items-center gap-2"><AlertTriangle size={18} aria-hidden="true" /><p className="text-sm">{t('matching.failed_to_load_matching_configuration')}</p></div>
          <Button variant="outline" onPress={loadConfig} isLoading={loading}>{t('common.retry')}</Button>
        </div>
      )}

      <div className="space-y-6">
        {/* Master switch and limits */}
        <Card >
          <CardHeader className="px-4 pt-4 pb-0">
            <h3 className="font-semibold">{t('matching.algorithm_settings')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{t('matching.smart_matching_enabled')}</p>
                  <p className="text-xs text-muted">
                    {t('matching.smart_matching_enabled_desc')}
                  </p>
                </div>
                <Switch
                  isSelected={config.enabled ?? true}
                  onValueChange={(val) => {
                    setConfig((prev) => ({ ...prev, enabled: val }));
                    setDirty(true);
                  }}
                  aria-label={t('matching.label_toggle_smart_matching')}
                />
              </div>
              <Separator />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Input
                  type="number"
                  label={t('matching.label_max_distance')}
                  value={fieldValue(config.max_distance_km)}
                  onValueChange={(val) => updateNumber('max_distance_km', toNumber(val))}
                  variant="secondary"
                  size="sm"
                  min={1}
                  max={MAX_DISTANCE_KM}
                  isInvalid={Boolean(errors.maxDistance)}
                  errorMessage={errors.maxDistance}
                />
                <Input
                  type="number"
                  label={t('matching.label_min_match_score')}
                  description={t('matching.min_match_score_desc')}
                  value={fieldValue(config.min_match_score)}
                  onValueChange={(val) => updateNumber('min_match_score', toNumber(val))}
                  variant="secondary"
                  size="sm"
                  min={0}
                  max={100}
                  isInvalid={Boolean(errors.minScore)}
                  errorMessage={errors.minScore}
                />
                <Input
                  type="number"
                  label={t('matching.label_hot_match_threshold')}
                  value={fieldValue(config.hot_match_threshold)}
                  onValueChange={(val) => updateNumber('hot_match_threshold', toNumber(val))}
                  variant="secondary"
                  size="sm"
                  min={0}
                  max={100}
                  isInvalid={Boolean(errors.hot)}
                  errorMessage={errors.hot}
                />
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Scoring weights — three for the current method, six for the older one */}
        <Card >
          <CardHeader className="flex items-center justify-between px-4 pt-4 pb-0">
            <h3 className="font-semibold">{t('matching.scoring_weights')}</h3>
            {isLegacyScoring && (
              <span
                className={`text-sm font-medium ${
                  totalValid ? 'text-success' : 'text-danger'
                }`}
              >
                {t('matching.total')}: {formatPercentValue(totalPct)}
                {!totalValid && ` (${t('matching.should_be_100')})`}
              </span>
            )}
          </CardHeader>
          <CardBody className="px-4 pb-4">
            <p className="mb-4 text-sm text-muted">
              {t(isLegacyScoring ? 'matching.scoring_method_v1_note' : 'matching.scoring_method_v2_note')}
            </p>
            {isLegacyScoring ? (
              <div className="space-y-6">
                <WeightSlider
                  label={t('matching.label_category_weight')}
                  description={t('matching.desc_weight_for_category_match_alignment')}
                  value={config.category_weight}
                  onChange={(v) => updateNumber('category_weight', v)}
                />
                <WeightSlider
                  label={t('matching.label_skill_weight')}
                  description={t('matching.desc_weight_for_skill_complementarity')}
                  value={config.skill_weight}
                  onChange={(v) => updateNumber('skill_weight', v)}
                />
                <WeightSlider
                  label={t('matching.label_proximity_weight')}
                  description={t('matching.desc_weight_for_geographic_proximity')}
                  value={config.proximity_weight}
                  onChange={(v) => updateNumber('proximity_weight', v)}
                />
                <WeightSlider
                  label={t('matching.label_freshness_weight')}
                  description={t('matching.desc_weight_for_listing_recency')}
                  value={config.freshness_weight}
                  onChange={(v) => updateNumber('freshness_weight', v)}
                />
                <WeightSlider
                  label={t('matching.label_reciprocity_weight')}
                  description={t('matching.desc_weight_for_mutual_exchange_potential')}
                  value={config.reciprocity_weight}
                  onChange={(v) => updateNumber('reciprocity_weight', v)}
                />
                <WeightSlider
                  label={t('matching.label_quality_weight')}
                  description={t('matching.desc_weight_for_profile_completeness_and_rati')}
                  value={config.quality_weight}
                  onChange={(v) => updateNumber('quality_weight', v)}
                />
              </div>
            ) : (
              <div className="space-y-6">
                {PILLARS.map(({ key, label, description }) => (
                  <WeightSlider
                    key={key}
                    label={t(label)}
                    description={t(description)}
                    value={pillars[key]}
                    onChange={(v) => updatePillar(key, v)}
                  />
                ))}
                {errors.pillars ? (
                  <p role="alert" className="text-sm text-danger">{errors.pillars}</p>
                ) : (
                  <p className="text-xs text-muted">{t('matching.pillars_scaled_note')}</p>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Gates & Intelligence */}
        <Card>
          <CardHeader className="px-4 pt-4 pb-0">
            <h3 className="font-semibold">{t('matching.gates_intelligence')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{t('matching.hard_distance_gate')}</p>
                  <p className="text-xs text-muted">
                    {t('matching.hard_distance_gate_desc')}
                  </p>
                </div>
                <Switch
                  isSelected={gates.geo_hard_gate}
                  onValueChange={(val) => updateGate('geo_hard_gate', val)}
                  aria-label={t('matching.hard_distance_gate')}
                />
              </div>
              <Separator />
              <div>
                <Select
                  label={t('matching.missing_coords_mode_label')}
                  description={t('matching.missing_coords_mode_desc')}
                  selectedKeys={[gates.missing_coords_mode]}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] as MatchingGatesConfig['missing_coords_mode'];
                    if (val) updateGate('missing_coords_mode', val);
                  }}
                  variant="secondary"
                >
                  <SelectItem key="remote_only" id="remote_only">
                    {t('matching.missing_coords_mode_remote_only')}
                  </SelectItem>
                  <SelectItem key="tenant_wide" id="tenant_wide">
                    {t('matching.missing_coords_mode_tenant_wide')}
                  </SelectItem>
                </Select>
              </div>
              <Separator />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  type="number"
                  label={t('matching.label_dormancy_days')}
                  description={t('matching.dormancy_days_desc')}
                  value={String(gates.dormancy_days)}
                  onValueChange={(val) => updateGate('dormancy_days', Math.max(0, parseInt(val) || 0))}
                  variant="secondary"
                  size="sm"
                  min={0}
                />
                <Input
                  type="number"
                  label={t('matching.label_owner_dismissal_threshold')}
                  description={t('matching.owner_dismissal_threshold_desc')}
                  value={String(gates.owner_dismissal_threshold)}
                  // The server's floor is 1; a 0 typed here used to be shown
                  // as 0 and stored as 1.
                  onValueChange={(val) => updateGate('owner_dismissal_threshold', Math.max(1, parseInt(val) || 1))}
                  variant="secondary"
                  size="sm"
                  min={1}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div>
                    <p className="text-sm font-medium">{t('matching.ai_semantic_matching')}</p>
                    <p className="text-xs text-muted">{t('matching.ai_semantic_matching_desc')}</p>
                  </div>
                  {config.ai?.available === false && (
                    <Tooltip content={t('matching.ai_configure_provider_first')}>
                      <Chip size="sm" color="warning" variant="soft" startContent={<Lock size={10} />}>
                        {t('matching.ai_unavailable')}
                      </Chip>
                    </Tooltip>
                  )}
                </div>
                <Switch
                  isSelected={config.ai?.semantic_signal ?? false}
                  onValueChange={(val) => updateAi('semantic_signal', val)}
                  isDisabled={config.ai?.available === false}
                  aria-label={t('matching.ai_semantic_matching')}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div>
                    <p className="text-sm font-medium">{t('matching.ai_match_explanations')}</p>
                    <p className="text-xs text-muted">{t('matching.ai_match_explanations_desc')}</p>
                  </div>
                  {config.ai?.available === false && (
                    <Tooltip content={t('matching.ai_configure_provider_first')}>
                      <Chip size="sm" color="warning" variant="soft" startContent={<Lock size={10} />}>
                        {t('matching.ai_unavailable')}
                      </Chip>
                    </Tooltip>
                  )}
                </div>
                <Switch
                  isSelected={config.ai?.llm_explanations ?? false}
                  onValueChange={(val) => updateAi('llm_explanations', val)}
                  isDisabled={config.ai?.available === false}
                  aria-label={t('matching.ai_match_explanations')}
                />
              </div>
              <Separator />
              <Input
                type="number"
                label={t('matching.label_explanation_top_n')}
                description={t('matching.explanation_top_n_desc')}
                value={String(config.ai?.explanation_top_n ?? DEFAULT_AI.explanation_top_n)}
                onValueChange={(val) => {
                  const parsed = parseInt(val) || 1;
                  updateAi('explanation_top_n', Math.min(10, Math.max(1, parsed)));
                }}
                variant="secondary"
                size="sm"
                min={1}
                max={10}
                isDisabled={config.ai?.available === false}
                className="sm:max-w-xs"
              />
            </div>
          </CardBody>
        </Card>

        {/* Proximity Bands — distances only */}
        <Card >
          <CardHeader className="px-4 pt-4 pb-0">
            <h3 className="font-semibold">{t('matching.proximity_bands')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            <p className="text-sm text-muted mb-4">
              {t('matching.proximity_bands_desc')}
            </p>
            <Table
              aria-label={t('matching.label_proximity_bands_configuration')}
              removeWrapper
              isCompact
            >
              <TableHeader>
                <TableColumn>{t('matching.col_band')}</TableColumn>
                <TableColumn>{t('matching.col_distance_km')}</TableColumn>
              </TableHeader>
              <TableBody>
                {(config.proximity_bands || []).map((band, i) => {
                  const bandLabel = BAND_LABEL_KEYS[i] ? t(BAND_LABEL_KEYS[i]) : t('matching.band_number', { number: i + 1 });
                  return (
                    <TableRow key={i}>
                      <TableCell>
                        <span className="text-sm font-medium">{bandLabel}</span>
                      </TableCell>
                      <TableCell>
                        {/* The error is a sibling, not the Input's own
                            errorMessage: an unlabelled Input changes its
                            wrapper when it becomes invalid, which remounts
                            the field and drops focus mid-typing. */}
                        <Input
                          type="number"
                          value={fieldValue(band.distance_km)}
                          onValueChange={(val) => updateBand(i, toNumber(val))}
                          variant="secondary"
                          size="sm"
                          className="w-28"
                          min={1}
                          max={MAX_DISTANCE_KM}
                          aria-label={t('matching.band_distance_aria', { band: bandLabel })}
                          aria-invalid={errors.bands[i] ? true : undefined}
                          aria-describedby={errors.bands[i] ? `band-error-${i}` : undefined}
                        />
                        {errors.bands[i] && (
                          <p id={`band-error-${i}`} role="alert" className="mt-1 text-xs text-danger">
                            {errors.bands[i]}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardBody>
        </Card>

        {/* Cache Management & Actions */}
        <Card >
          <CardHeader className="px-4 pt-4 pb-0">
            <h3 className="font-semibold">{t('matching.cache_management')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            <div className="flex flex-wrap gap-3">
              <Button
                variant="danger"
                startContent={<Trash2 size={16} />}
                onPress={() => setClearModalOpen(true)}
              >
                {t('matching.clear_match_cache')}
              </Button>
              <Button
                color="warning"
                variant="tertiary"
                startContent={<RotateCcw size={16} />}
                onPress={() => setResetModalOpen(true)}
              >
                {t('matching.reset_to_defaults')}
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Clear Cache Modal */}
      <ConfirmModal
        isOpen={clearModalOpen}
        onClose={() => setClearModalOpen(false)}
        onConfirm={handleClearCache}
        title={t('matching.clear_match_cache')}
        message={t('matching.clear_cache_confirm')}
        confirmLabel={t('matching.clear_cache_btn')}
        confirmColor="danger"
        isLoading={clearing}
      />

      {/* Reset Defaults Modal */}
      <ConfirmModal
        isOpen={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        onConfirm={handleReset}
        title={t('matching.reset_to_defaults')}
        message={t('matching.reset_defaults_confirm')}
        confirmLabel={t('matching.reset_btn')}
        confirmColor="warning"
      />
    </div>
  );
}

/** Reusable weight slider component */
function WeightSlider({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const pct = Math.round(value * 100);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted">{description}</p>
        </div>
        <span className="text-sm font-semibold tabular-nums w-12 text-right">
          {formatPercentValue(pct)}
        </span>
      </div>
      <Slider
        step={0.05}
        minValue={0}
        maxValue={1}
        value={value}
        onChange={(val) => onChange(val as number)}
        aria-label={label}
        size="sm"
        className="mt-1"
      />
    </div>
  );
}

export default MatchingConfig;
