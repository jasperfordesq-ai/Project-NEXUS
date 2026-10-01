import { Card, CardBody, CardHeader, Spinner, Button, Input, Select, SelectItem, Switch, Checkbox } from '@/components/ui';
import { useState, useCallback, useEffect } from 'react';

import { Separator } from '@/components/ui';
import Globe from 'lucide-react/icons/globe';
import MapPin from 'lucide-react/icons/map-pin';
import KeyRound from 'lucide-react/icons/key-round';
import Eye from 'lucide-react/icons/eye';
import EyeOff from 'lucide-react/icons/eye-off';
import { useTranslation } from 'react-i18next';
import { useToast, useTenant } from '@/contexts';
import { languageDisplayName } from '@/lib/languageDisplayName';

// Google API keys always use this invariant credential prefix.
const GOOGLE_API_KEY_EXAMPLE_PREFIX = 'AIza…';
import { adminConfig, adminSettings } from '../../api/adminApi';
import type { TenantConfig } from '../../api/types';
import { SecretInput } from '../../components/SecretInput';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform Infrastructure
 *
 * Tenant-wide infrastructure that doesn't belong to a single module:
 *  - Languages (default + supported)
 *  - Maps & location (kill switch + provider choice)
 *  - Per-tenant API keys (Google Maps, MapTiler)
 *
 * Rendered inline at the bottom of /admin/module-configuration.
 * Previously lived on /admin/tenant-features (now retired).
 */


const PLATFORM_LANGUAGES = [
  { code: 'en', short: 'EN' },
  { code: 'ga', short: 'GA' },
  { code: 'de', short: 'DE' },
  { code: 'fr', short: 'FR' },
  { code: 'it', short: 'IT' },
  { code: 'pt', short: 'PT' },
  { code: 'es', short: 'ES' },
  { code: 'nl', short: 'NL' },
  { code: 'pl', short: 'PL' },
  { code: 'ja', short: 'JA' },
  { code: 'ar', short: 'AR' },
];

interface PlatformInfrastructureProps {
  config: TenantConfig | null;
  onConfigChange: (updater: (prev: TenantConfig | null) => TenantConfig | null) => void;
}

export default function PlatformInfrastructure({ config: _config, onConfigChange: _onConfigChange }: PlatformInfrastructureProps) {
  const { t, i18n } = useTranslation('admin_config');
  const toast = useToast();
  const { refreshTenant, supportedLanguages, defaultLanguage, hasFeature } = useTenant();

  const [loading, setLoading] = useState(true);
  // Language state
  const [langDefault, setLangDefault] = useState(defaultLanguage);
  const [langSupported, setLangSupported] = useState<string[]>(supportedLanguages);
  const [savingLang, setSavingLang] = useState(false);

  // Maps kill switch (the per-tenant `maps` feature flag). When off, no map
  // components render anywhere for this tenant; address autocomplete still
  // works via the geocoding provider below. Backed by the same toggle endpoint
  // every other feature uses (PUT /v2/admin/config/features).
  const [mapsEnabled, setMapsEnabled] = useState<boolean>(() => hasFeature('maps'));
  const [savingMaps, setSavingMaps] = useState(false);

  // Provider state
  const [mapProvider, setMapProvider] = useState<'google' | 'openstreetmap' | 'ordnance_survey'>('google');
  const [geocodingProvider, setGeocodingProvider] = useState<'google' | 'nominatim' | 'os_places'>('google');
  const [savingProviders, setSavingProviders] = useState(false);

  // API keys
  const [googleMapsKeyDisplay, setGoogleMapsKeyDisplay] = useState('');
  const [googleMapsKeyInput, setGoogleMapsKeyInput] = useState('');
  const [googleMapsKeySet, setGoogleMapsKeySet] = useState(false);
  const [googleMapId, setGoogleMapId] = useState('');
  const [maptilerKeyDisplay, setMaptilerKeyDisplay] = useState('');
  const [maptilerKeyInput, setMaptilerKeyInput] = useState('');
  const [maptilerKeySet, setMaptilerKeySet] = useState(false);
  const [osMapsKeyDisplay, setOsMapsKeyDisplay] = useState('');
  const [osMapsKeyInput, setOsMapsKeyInput] = useState('');
  const [osMapsKeySet, setOsMapsKeySet] = useState(false);
  const [savingKeys, setSavingKeys] = useState(false);
  const [showGoogleKey, setShowGoogleKey] = useState(false);
  const [showMaptilerKey, setShowMaptilerKey] = useState(false);
  const [showOsMapsKey, setShowOsMapsKey] = useState(false);

  useEffect(() => {
    setLangDefault(defaultLanguage);
    setLangSupported(supportedLanguages);
  }, [defaultLanguage, supportedLanguages]);

  // Keep the kill-switch in sync with the live tenant feature flag (e.g. after
  // refreshTenant() re-pulls the bootstrap, or another admin tab changes it).
  useEffect(() => {
    setMapsEnabled(hasFeature('maps'));
  }, [hasFeature]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    const settingsRes = await adminSettings.get();
    if (settingsRes.success && settingsRes.data) {
      const s = settingsRes.data.settings as Record<string, unknown>;
      const mp = s.map_provider;
      const gp = s.geocoding_provider;
      if (mp === 'google' || mp === 'openstreetmap' || mp === 'ordnance_survey') setMapProvider(mp);
      if (gp === 'google' || gp === 'nominatim' || gp === 'os_places') setGeocodingProvider(gp);

      const gk = s.google_maps_api_key;
      setGoogleMapsKeyDisplay(typeof gk === 'string' ? gk : '');
      setGoogleMapsKeySet(s.google_maps_api_key_set === true);

      const gmid = s.google_maps_map_id;
      setGoogleMapId(typeof gmid === 'string' ? gmid : '');

      const mk = s.maptiler_api_key;
      setMaptilerKeyDisplay(typeof mk === 'string' ? mk : '');
      setMaptilerKeySet(s.maptiler_api_key_set === true);

      const ok = s.os_maps_api_key;
      setOsMapsKeyDisplay(typeof ok === 'string' ? ok : '');
      setOsMapsKeySet(s.os_maps_api_key_set === true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleLangToggle = (code: string, checked: boolean) => {
    if (code === 'en') return;
    const updated = checked
      ? [...langSupported, code]
      : langSupported.filter((c) => c !== code);
    setLangSupported(updated);
    if (!checked && langDefault === code) setLangDefault('en');
  };

  const handleSaveLanguages = async () => {
    setSavingLang(true);
    const res = await adminConfig.updateLanguageConfig({
      default_language: langDefault,
      supported_languages: langSupported,
    });
    if (res.success) {
      toast.success(t('tenant_features.language_settings_saved'));
      refreshTenant();
    } else {
      toast.error(t('tenant_features.language_settings_save_failed'));
    }
    setSavingLang(false);
  };

  const handleToggleMaps = async (value: boolean) => {
    setSavingMaps(true);
    const previous = mapsEnabled;
    setMapsEnabled(value); // optimistic — reverted on failure
    const res = await adminConfig.updateFeature('maps', value);
    if (res.success) {
      toast.success(t('tenant_features.maps_kill_switch_saved'));
      refreshTenant();
    } else {
      setMapsEnabled(previous);
      toast.error(t('tenant_features.maps_providers_save_failed'));
    }
    setSavingMaps(false);
  };

  const handleSaveProviders = async () => {
    setSavingProviders(true);
    const res = await adminSettings.update({
      map_provider: mapProvider,
      geocoding_provider: geocodingProvider,
    });
    if (res.success) {
      toast.success(t('tenant_features.maps_providers_saved'));
      refreshTenant();
    } else {
      toast.error(t('tenant_features.maps_providers_save_failed'));
    }
    setSavingProviders(false);
  };

  const handleSaveApiKeys = async () => {
    setSavingKeys(true);
    const payload: Record<string, string> = {};
    if (googleMapsKeyInput !== '') payload.google_maps_api_key = googleMapsKeyInput.trim();
    payload.google_maps_map_id = googleMapId.trim();
    if (maptilerKeyInput !== '') payload.maptiler_api_key = maptilerKeyInput.trim();
    if (osMapsKeyInput !== '') payload.os_maps_api_key = osMapsKeyInput.trim();
    const res = await adminSettings.update(payload);
    if (res.success) {
      toast.success(t('tenant_features.api_keys_saved'));
      setGoogleMapsKeyInput('');
      setMaptilerKeyInput('');
      setOsMapsKeyInput('');
      await loadSettings();
    } else {
      toast.error(t('tenant_features.api_keys_save_failed'));
    }
    setSavingKeys(false);
  };

  const handleClearGoogleKey = async () => {
    setSavingKeys(true);
    const res = await adminSettings.update({ google_maps_api_key: '' });
    if (res.success) {
      toast.success(t('tenant_features.google_key_cleared'));
      await loadSettings();
    } else {
      toast.error(t('tenant_features.clear_failed'));
    }
    setSavingKeys(false);
  };

  const handleClearMaptilerKey = async () => {
    setSavingKeys(true);
    const res = await adminSettings.update({ maptiler_api_key: '' });
    if (res.success) {
      toast.success(t('tenant_features.maptiler_key_cleared'));
      await loadSettings();
    } else {
      toast.error(t('tenant_features.clear_failed'));
    }
    setSavingKeys(false);
  };

  const handleClearOsMapsKey = async () => {
    setSavingKeys(true);
    const res = await adminSettings.update({ os_maps_api_key: '' });
    if (res.success) {
      toast.success(t('tenant_features.os_maps_key_cleared'));
      await loadSettings();
    } else {
      toast.error(t('tenant_features.clear_failed'));
    }
    setSavingKeys(false);
  };

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex h-32 items-center justify-center">
        <Spinner size="sm" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-3 space-y-6">

        {/* Languages */}
        <Card>
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <Globe size={18} className="text-accent" aria-hidden="true" />
            <h3 className="font-semibold">{t('tenant_features.language_localisation_heading')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4 space-y-4">
            <div>
              <p className="text-sm font-medium mb-1">{t('tenant_features.default_language')}</p>
              <p className="text-xs text-muted mb-2">
                {t('tenant_features.default_language_hint')}
              </p>
              <Select
                aria-label={t('tenant_features.default_language')}
                selectedKeys={[langDefault]}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setLangDefault(val);
                }}
                className="max-w-xs"
                size="sm"
              >
                {PLATFORM_LANGUAGES.filter((l) => langSupported.includes(l.code)).map((lang) => (
                  <SelectItem key={lang.code} id={lang.code}>{languageDisplayName(lang.code, i18n.resolvedLanguage)} ({lang.short})</SelectItem>
                ))}
              </Select>
            </div>
            <Separator />
            <div>
              <p className="text-sm font-medium mb-1">{t('tenant_features.available_languages')}</p>
              <p className="text-xs text-muted mb-3">
                {t('tenant_features.available_languages_hint')}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {PLATFORM_LANGUAGES.map((lang) => (
                  <Checkbox
                    key={lang.code}
                    isSelected={langSupported.includes(lang.code)}
                    isDisabled={lang.code === 'en'}
                    onValueChange={(checked) => handleLangToggle(lang.code, checked)}
                  >
                    <span className="text-sm">
                      {languageDisplayName(lang.code, i18n.resolvedLanguage)} ({lang.short})
                      {lang.code === 'en' && (
                        <span className="ml-2 text-xs text-muted">{t('tenant_features.always_enabled')}</span>
                      )}
                    </span>
                  </Checkbox>
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                isLoading={savingLang}
                isDisabled={savingLang}
                onPress={handleSaveLanguages}
              >
                {t('tenant_features.save_changes')}
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* Maps & Location */}
        <Card>
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <MapPin size={18} className="text-warning" aria-hidden="true" />
            <h3 className="font-semibold">{t('tenant_features.maps_card_title')}</h3>
            <span className="text-sm text-muted">
              {t('tenant_features.maps_card_subtitle')}
            </span>
          </CardHeader>
          <CardBody className="px-4 pb-4 space-y-4">
            <div className="flex flex-wrap gap-2 items-center text-xs">
              <span className="text-muted">{t('tenant_features.currently_serving')}:</span>
              <span className={`px-2 py-0.5 rounded-full font-medium ${mapsEnabled ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300' : 'bg-surface-secondary text-muted'}`}>
                {t('tenant_features.status_maps')}{': '}
                {mapsEnabled ? t('tenant_features.status_on') : t('tenant_features.status_off')}
              </span>
              <span className={`px-2 py-0.5 rounded-full font-medium ${geocodingProvider === 'google' ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300' : 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300'}`}>
                {t('tenant_features.status_autocomplete')}{': '}
                {geocodingProvider === 'google'
                  ? t('tenant_features.status_google_places_paid')
                  : geocodingProvider === 'os_places'
                    ? t('tenant_features.status_os_places')
                    : t('tenant_features.status_nominatim_free')}
              </span>
            </div>

            {geocodingProvider === 'google' && (
              <div className="rounded-lg bg-warning-50 dark:bg-warning-900/10 px-3 py-2 text-xs text-warning-700 dark:text-warning-300 border border-warning-200 dark:border-warning-800">
                {t('tenant_features.cost_warning')}
              </div>
            )}

            <Separator />

            <div className="flex items-center justify-between rounded-lg bg-surface-secondary px-3 py-3">
              <div className="pr-4">
                <p className="font-medium text-sm mb-0.5">
                  {t('tenant_features.maps_kill_switch_label')}
                </p>
                <p className="text-xs text-muted mt-0.5">
                  {t('tenant_features.maps_kill_switch_desc')}
                </p>
              </div>
              <Switch
                isSelected={mapsEnabled}
                isDisabled={savingMaps}
                onValueChange={handleToggleMaps}
                size="sm"
                aria-label={t('tenant_features.maps_kill_switch_aria')}
              />
            </div>

            <Separator />

            <div>
              <p className="text-sm font-medium mb-1">
                {t('tenant_features.map_provider_label')}
              </p>
              <p className="text-xs text-muted mb-2">
                {t('tenant_features.map_provider_desc')}
              </p>
              <Select
                aria-label={t('tenant_features.map_provider_aria')}
                selectedKeys={[mapProvider]}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val === 'google' || val === 'openstreetmap' || val === 'ordnance_survey') setMapProvider(val);
                }}
                className="max-w-xs"
                size="sm"
                isDisabled={savingProviders}
              >
                <SelectItem key="google" id="google">{t('tenant_features.provider_google')}</SelectItem>
                <SelectItem key="openstreetmap" id="openstreetmap">{t('tenant_features.provider_osm')}</SelectItem>
                <SelectItem key="ordnance_survey" id="ordnance_survey">{t('tenant_features.provider_os_maps')}</SelectItem>
              </Select>
            </div>

            <div>
              <p className="text-sm font-medium mb-1">
                {t('tenant_features.geocoding_provider_label')}
              </p>
              <p className="text-xs text-muted mb-2">
                {t('tenant_features.geocoding_provider_desc')}
              </p>
              <Select
                aria-label={t('tenant_features.geocoding_provider_aria')}
                selectedKeys={[geocodingProvider]}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val === 'google' || val === 'nominatim' || val === 'os_places') setGeocodingProvider(val);
                }}
                className="max-w-xs"
                size="sm"
              >
                <SelectItem key="google" id="google">{t('tenant_features.provider_google_places')}</SelectItem>
                <SelectItem key="nominatim" id="nominatim">{t('tenant_features.provider_nominatim')}</SelectItem>
                <SelectItem key="os_places" id="os_places">{t('tenant_features.provider_os_places')}</SelectItem>
              </Select>
            </div>

            <div className="flex justify-end">
              <Button
                size="sm"
                isLoading={savingProviders}
                isDisabled={savingProviders}
                onPress={handleSaveProviders}
              >
                {t('tenant_features.save_changes')}
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* API Keys */}
        <Card>
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <KeyRound size={18} className="text-accent" aria-hidden="true" />
            <h3 className="font-semibold">
              {t('tenant_features.api_keys_card_title')}
            </h3>
            <span className="text-sm text-muted">
              {t('tenant_features.api_keys_card_subtitle')}
            </span>
          </CardHeader>
          <CardBody className="px-4 pb-4 space-y-5">
            <p className="text-xs text-muted">
              {t('tenant_features.api_keys_intro')}
            </p>

            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium">
                  {t('tenant_features.google_maps_api_key_label')}
                </p>
                <span className={`text-xs px-2 py-0.5 rounded-full ${googleMapsKeySet ? 'bg-success/10 text-success' : 'bg-surface-secondary text-muted'}`}>
                  {googleMapsKeySet
                    ? t('tenant_features.key_status_set')
                    : t('tenant_features.key_status_default')}
                </span>
              </div>
              <p className="text-xs text-muted mb-2">
                {t('tenant_features.google_maps_api_key_hint')}
              </p>
              <div className="flex gap-2">
                <SecretInput
                  aria-label={t('tenant_features.google_maps_api_key_label')}
                  placeholder={googleMapsKeySet ? googleMapsKeyDisplay : GOOGLE_API_KEY_EXAMPLE_PREFIX}
                  value={googleMapsKeyInput}
                  onValueChange={setGoogleMapsKeyInput}
                  type={showGoogleKey ? 'text' : 'password'}
                  size="sm"
                  isDisabled={savingKeys}
                  endContent={
                    <Button
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      className="text-muted"
                      aria-label={showGoogleKey ? t('tenant_features.hide_key') : t('tenant_features.show_key')}
                      onPress={() => setShowGoogleKey((v) => !v)}
                    >
                      {showGoogleKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </Button>
                  }
                />
                {googleMapsKeySet && (
                  <Button
                    size="sm"
                    variant="danger"
                    isDisabled={savingKeys}
                    onPress={handleClearGoogleKey}
                  >
                    {t('tenant_features.clear')}
                  </Button>
                )}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-1">
                {t('tenant_features.google_map_id_label')}
              </p>
              <p className="text-xs text-muted mb-2">
                {t('tenant_features.google_map_id_hint')}
              </p>
              <Input
                aria-label={t('tenant_features.google_map_id_label')}
                placeholder={t('tenant_features.google_map_id_placeholder')}
                value={googleMapId}
                onValueChange={setGoogleMapId}
                size="sm"
                className="max-w-md"
                autoComplete="off"
                isDisabled={savingKeys}
              />
            </div>

            <Separator />

            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium">
                  {t('tenant_features.maptiler_api_key_label')}
                </p>
                <span className={`text-xs px-2 py-0.5 rounded-full ${maptilerKeySet ? 'bg-success/10 text-success' : 'bg-surface-secondary text-muted'}`}>
                  {maptilerKeySet
                    ? t('tenant_features.tiles_status_maptiler')
                    : t('tenant_features.tiles_status_free_osm')}
                </span>
              </div>
              <p className="text-xs text-muted mb-2">
                {t('tenant_features.maptiler_api_key_hint')}
              </p>
              <div className="flex gap-2">
                <SecretInput
                  aria-label={t('tenant_features.maptiler_api_key_label')}
                  placeholder={maptilerKeySet ? maptilerKeyDisplay : '…'}
                  value={maptilerKeyInput}
                  onValueChange={setMaptilerKeyInput}
                  type={showMaptilerKey ? 'text' : 'password'}
                  size="sm"
                  isDisabled={savingKeys}
                  endContent={
                    <Button
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      className="text-muted"
                      aria-label={showMaptilerKey ? t('tenant_features.hide_key') : t('tenant_features.show_key')}
                      onPress={() => setShowMaptilerKey((v) => !v)}
                    >
                      {showMaptilerKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </Button>
                  }
                />
                {maptilerKeySet && (
                  <Button
                    size="sm"
                    variant="danger"
                    isDisabled={savingKeys}
                    onPress={handleClearMaptilerKey}
                  >
                    {t('tenant_features.clear')}
                  </Button>
                )}
              </div>
            </div>

            <Separator />

            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium">
                  {t('tenant_features.os_maps_api_key_label')}
                </p>
                <span className={`text-xs px-2 py-0.5 rounded-full ${osMapsKeySet ? 'bg-success/10 text-success' : 'bg-surface-secondary text-muted'}`}>
                  {osMapsKeySet
                    ? t('tenant_features.tiles_status_os_maps')
                    : t('tenant_features.tiles_status_os_maps_unset')}
                </span>
              </div>
              <p className="text-xs text-muted mb-2">
                {t('tenant_features.os_maps_api_key_hint')}
              </p>
              <div className="flex gap-2">
                <SecretInput
                  aria-label={t('tenant_features.os_maps_api_key_label')}
                  placeholder={osMapsKeySet ? osMapsKeyDisplay : '…'}
                  value={osMapsKeyInput}
                  onValueChange={setOsMapsKeyInput}
                  type={showOsMapsKey ? 'text' : 'password'}
                  size="sm"
                  isDisabled={savingKeys}
                  endContent={
                    <Button
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      className="text-muted"
                      aria-label={showOsMapsKey ? t('tenant_features.hide_key') : t('tenant_features.show_key')}
                      onPress={() => setShowOsMapsKey((v) => !v)}
                    >
                      {showOsMapsKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </Button>
                  }
                />
                {osMapsKeySet && (
                  <Button
                    size="sm"
                    variant="danger"
                    isDisabled={savingKeys}
                    onPress={handleClearOsMapsKey}
                  >
                    {t('tenant_features.clear')}
                  </Button>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                size="sm"
                isLoading={savingKeys}
                isDisabled={savingKeys || (!googleMapsKeyInput && !maptilerKeyInput && !osMapsKeyInput && googleMapId === '')}
                onPress={handleSaveApiKeys}
              >
                {t('tenant_features.save_api_keys')}
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
