// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Match Preferences Page — member-facing controls for Smart Matching:
 * pause/resume, distance & quality thresholds, category interests,
 * notification frequency, and hot/mutual match alerts.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import Save from 'lucide-react/icons/save';
import MapPin from 'lucide-react/icons/map-pin';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import PauseCircle from 'lucide-react/icons/pause-circle';
import Target from 'lucide-react/icons/target';
import Tags from 'lucide-react/icons/tags';
import Bell from 'lucide-react/icons/bell';
import Flame from 'lucide-react/icons/flame';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import SlidersHorizontal from 'lucide-react/icons/sliders-horizontal';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CheckboxGroup, Checkbox } from '@/components/ui/Checkbox';
import { GlassCard } from '@/components/ui/GlassCard';
import { RadioGroup, Radio } from '@/components/ui/Radio';
import { Slider } from '@/components/ui/Slider';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { Breadcrumbs } from '@/components/navigation';
import { useAuth, useToast } from '@/contexts';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import type { MatchPreferences } from './types';

interface Category {
  id: number;
  name: string;
}

const DEFAULT_PREFERENCES: MatchPreferences = {
  max_distance_km: 25,
  min_match_score: 50,
  notification_frequency: 'monthly',
  notify_hot_matches: true,
  notify_mutual_matches: true,
  matching_paused: false,
  categories: [],
  availability: [],
};

export function MatchPreferencesPage() {
  const { t } = useTranslation('matches');
  usePageTitle(t('preferences.page_title'));
  const { user } = useAuth();
  const toast = useToast();

  const [preferences, setPreferences] = useState<MatchPreferences>(DEFAULT_PREFERENCES);
  const [initialPreferences, setInitialPreferences] = useState<MatchPreferences>(DEFAULT_PREFERENCES);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCoordinates = user?.latitude != null && user?.longitude != null;

  const isDirty = useMemo(
    () => JSON.stringify(preferences) !== JSON.stringify(initialPreferences),
    [preferences, initialPreferences],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prefsRes, categoriesRes] = await Promise.all([
        api.get<Partial<MatchPreferences>>('/v2/users/me/match-preferences'),
        api.get<Category[]>('/v2/categories').catch(() => null),
      ]);

      // api.get resolves { success:false } on a 4xx WITHOUT throwing. If the
      // saved preferences fail to load, the form must NOT stay editable with
      // defaults — saving would silently overwrite the user's real preferences.
      if (prefsRes.success && prefsRes.data) {
        const merged: MatchPreferences = { ...DEFAULT_PREFERENCES, ...prefsRes.data };
        setPreferences(merged);
        setInitialPreferences(merged);
      } else {
        setError(t('preferences.load_failed'));
      }

      if (categoriesRes?.success && Array.isArray(categoriesRes.data)) {
        setCategories(categoriesRes.data);
      }
    } catch (err) {
      logError('MatchPreferencesPage.load', err);
      setError(t('preferences.load_failed'));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const handleSave = useCallback(async () => {
    // Defence in depth: never save while the last load failed — the form would
    // contain defaults, not the user's stored preferences.
    if (error) return;
    setIsSaving(true);
    try {
      const res = await api.put('/v2/users/me/match-preferences', preferences);
      if (res.success) {
        setInitialPreferences(preferences);
        toast.success(t('preferences.save_success'));
      } else {
        toast.error(res.error || t('preferences.save_failed'));
      }
    } catch (err) {
      logError('MatchPreferencesPage.save', err);
      toast.error(t('preferences.save_failed'));
    }
    setIsSaving(false);
  }, [preferences, toast, t, error]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  // DATA-INTEGRITY: if the saved preferences failed to load, do NOT render the
  // editable form — it would hold defaults, and saving would overwrite the
  // user's real preferences. Show an error with retry instead; the save path
  // stays unreachable until a successful load has populated the form.
  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <PageMeta title={t('preferences.page_meta_title')} noIndex />
        <Breadcrumbs
          items={[
            { label: t('breadcrumb_dashboard'), href: '/dashboard' },
            { label: t('breadcrumb_matches'), href: '/matches' },
            { label: t('preferences.breadcrumb') },
          ]}
        />

        {/* The same soft panel in the community colour that opens the offers,
            events and groups pages (AWID: warmer, more inviting). */}
        <PublicPageHero
          size="compact"
          title={t('preferences.heading')}
          description={t('preferences.subtitle')}
          icon={<SlidersHorizontal className="h-6 w-6" aria-hidden="true" />}
          accent="indigo"
        />

        <GlassCard role="alert" className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{error}</h2>
          <p className="text-theme-muted mb-4">{t('preferences.load_error_desc')}</p>
          <Button
            className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => load()}
          >
            {t('preferences.retry')}
          </Button>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6 pb-28">
      <PageMeta title={t('preferences.page_meta_title')} noIndex />
      <Breadcrumbs
        items={[
          { label: t('breadcrumb_dashboard'), href: '/dashboard' },
          { label: t('breadcrumb_matches'), href: '/matches' },
          { label: t('preferences.breadcrumb') },
        ]}
      />

      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <PublicPageHero
        size="compact"
        title={t('preferences.heading')}
        description={t('preferences.subtitle')}
        icon={<SlidersHorizontal className="h-6 w-6" aria-hidden="true" />}
        accent="indigo"
      />

      {/* Pause matching */}
      <GlassCard className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <PauseCircle className="w-5 h-5 text-theme-subtle mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="font-semibold text-theme-primary">{t('preferences.pause.title')}</h2>
              <p className={`text-sm mt-1 ${preferences.matching_paused ? 'text-danger' : 'text-theme-subtle'}`}>
                {preferences.matching_paused ? t('preferences.pause.active_description') : t('preferences.pause.description')}
              </p>
            </div>
          </div>
          <Switch
            aria-label={t('preferences.pause.title')}
            isSelected={preferences.matching_paused}
            onValueChange={(checked) => setPreferences((prev) => ({ ...prev, matching_paused: checked }))}
            color="danger"
          />
        </div>
      </GlassCard>

      {/* Distance & quality */}
      <GlassCard className="p-6 space-y-6">
        <h2 className="font-semibold text-theme-primary flex items-center gap-2">
          <Target className="w-5 h-5 text-theme-subtle" aria-hidden="true" />
          {t('preferences.thresholds.title')}
        </h2>

        {!hasCoordinates && (
          <Alert
            color="warning"
            icon={<MapPin className="w-5 h-5" aria-hidden="true" />}
            title={t('preferences.thresholds.no_location_title')}
            description={t('preferences.thresholds.no_location_desc')}
          />
        )}

        <div>
          <Slider
            label={t('preferences.thresholds.distance_label')}
            minValue={1}
            maxValue={100}
            step={1}
            value={preferences.max_distance_km}
            onChange={(value) => setPreferences((prev) => ({ ...prev, max_distance_km: Array.isArray(value) ? value[0] ?? prev.max_distance_km : value }))}
            getValue={() => t('preferences.thresholds.distance_value', { value: preferences.max_distance_km })}
            aria-label={t('preferences.thresholds.distance_label')}
          />
        </div>

        <div>
          <Slider
            label={t('preferences.thresholds.quality_label')}
            minValue={30}
            maxValue={90}
            step={5}
            value={preferences.min_match_score}
            onChange={(value) => setPreferences((prev) => ({ ...prev, min_match_score: Array.isArray(value) ? value[0] ?? prev.min_match_score : value }))}
            getValue={() => t('preferences.thresholds.quality_value', { value: preferences.min_match_score })}
            aria-label={t('preferences.thresholds.quality_label')}
          />
        </div>
      </GlassCard>

      {/* Categories */}
      <GlassCard className="p-6">
        <h2 className="font-semibold text-theme-primary flex items-center gap-2 mb-1">
          <Tags className="w-5 h-5 text-theme-subtle" aria-hidden="true" />
          {t('preferences.categories.title')}
        </h2>
        <p className="text-sm text-theme-subtle mb-4">{t('preferences.categories.description')}</p>

        {categories.length > 0 ? (
          <CheckboxGroup
            aria-label={t('preferences.categories.title')}
            value={preferences.categories.map(String)}
            onValueChange={(values) => setPreferences((prev) => ({ ...prev, categories: values.map(Number) }))}
            orientation="horizontal"
          >
            {categories.map((category) => (
              <Checkbox key={category.id} value={String(category.id)}>
                {category.name}
              </Checkbox>
            ))}
          </CheckboxGroup>
        ) : (
          <p className="text-sm text-theme-subtle">{t('preferences.categories.empty')}</p>
        )}
      </GlassCard>

      {/* Notifications */}
      <GlassCard className="p-6 space-y-6">
        <h2 className="font-semibold text-theme-primary flex items-center gap-2">
          <Bell className="w-5 h-5 text-theme-subtle" aria-hidden="true" />
          {t('preferences.notifications.title')}
        </h2>

        <RadioGroup
          label={t('preferences.notifications.frequency_label')}
          value={preferences.notification_frequency}
          onValueChange={(value) => setPreferences((prev) => ({ ...prev, notification_frequency: value as MatchPreferences['notification_frequency'] }))}
        >
          <Radio value="daily">{t('preferences.notifications.daily')}</Radio>
          <Radio value="fortnightly">{t('preferences.notifications.fortnightly')}</Radio>
          <Radio value="monthly">{t('preferences.notifications.monthly')}</Radio>
          <Radio value="never">{t('preferences.notifications.never')}</Radio>
        </RadioGroup>

        <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-theme-elevated">
          <div className="flex items-center gap-3 min-w-0">
            <Flame className="w-4 h-4 text-[var(--color-warning)] flex-shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium text-theme-primary">{t('preferences.notifications.hot_matches')}</p>
              <p className="text-sm text-theme-subtle">{t('preferences.notifications.hot_matches_desc')}</p>
            </div>
          </div>
          <Switch
            aria-label={t('preferences.notifications.hot_matches')}
            isSelected={preferences.notify_hot_matches}
            onValueChange={(checked) => setPreferences((prev) => ({ ...prev, notify_hot_matches: checked }))}
            className="shrink-0"
          />
        </div>

        <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-theme-elevated">
          <div className="flex items-center gap-3 min-w-0">
            <ArrowLeftRight className="w-4 h-4 text-success flex-shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium text-theme-primary">{t('preferences.notifications.mutual_matches')}</p>
              <p className="text-sm text-theme-subtle">{t('preferences.notifications.mutual_matches_desc')}</p>
            </div>
          </div>
          <Switch
            aria-label={t('preferences.notifications.mutual_matches')}
            isSelected={preferences.notify_mutual_matches}
            onValueChange={(checked) => setPreferences((prev) => ({ ...prev, notify_mutual_matches: checked }))}
            className="shrink-0"
          />
        </div>
      </GlassCard>

      {/* Sticky save bar */}
      {isDirty && (
        <>
          <div aria-hidden="true" className="h-20 sm:hidden" />
          <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+4rem)] z-[290] rounded-t-xl border-t border-theme-default bg-surface/95 px-4 py-3 shadow-[0_-4px_24px_rgba(0,0,0,0.08)] backdrop-blur sm:sticky sm:bottom-4 sm:inset-x-auto sm:rounded-xl sm:border sm:shadow-lg">
            <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
              <p className="text-sm text-theme-muted">{t('preferences.unsaved_changes')}</p>
              <Button
                onPress={handleSave}
                className="min-h-[44px] bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
                startContent={<Save className="w-4 h-4" aria-hidden="true" />}
                isLoading={isSaving}
              >
                {t('preferences.save')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default MatchPreferencesPage;
