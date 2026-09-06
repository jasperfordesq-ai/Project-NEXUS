import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner, Select, SelectItem, Switch } from '@/components/ui';
import { useEffect, useMemo, useState } from 'react';

import Download from 'lucide-react/icons/download';
import Save from 'lucide-react/icons/save';
import Smartphone from 'lucide-react/icons/smartphone';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageHeader } from '../../components/PageHeader';
import { NativeAppInstallStats } from './NativeAppInstallStats';
import { adminSettings } from '../../api/adminApi';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Native App Settings
 * Configure mobile app (Capacitor) settings and tenant-branded build readiness.
 */


type NativeAppForm = Record<string, string | boolean>;

interface NativeAppReadiness {
  has_ios_identity?: boolean;
  has_android_identity?: boolean;
  has_store_metadata?: boolean;
  push_routing_configured?: boolean;
  tenant_branded_ready?: boolean;
  missing_requirements?: string[];
}

interface NativeAppResponse {
  native_app?: NativeAppForm;
  deployment_readiness?: NativeAppReadiness;
}

const DEFAULT_FORM: NativeAppForm = {
  native_app_name: 'Project NEXUS',
  native_app_short_name: 'NEXUS',
  native_app_bundle_id: 'com.nexus.timebank',
  native_app_package_name: 'com.nexus.timebank',
  native_app_version: '1.1.0',
  native_app_push_enabled: true,
  native_app_fcm_server_key: '',
  native_app_apns_key_id: '',
  native_app_apns_team_id: '',
  native_app_service_worker: true,
  native_app_install_prompt: true,
  native_app_theme_color: '#1976D2',
  native_app_background_color: '#ffffff',
  native_app_display: 'standalone',
  native_app_orientation: 'portrait',
  native_app_store_mode: 'shared',
  native_app_build_profile: 'preview',
  native_app_ios_app_store_id: '',
  native_app_android_play_store_id: '',
  native_app_marketing_url: '',
  native_app_privacy_url: '',
  native_app_support_url: '',
  native_app_push_sender_id: '',
  native_app_tenant_channel_prefix: '',
};

const readinessLabels: Array<[keyof NativeAppReadiness, string]> = [
  ['has_ios_identity', 'readiness_ios_identity'],
  ['has_android_identity', 'readiness_android_identity'],
  ['has_store_metadata', 'readiness_store_metadata'],
  ['push_routing_configured', 'readiness_push_routing'],
  ['tenant_branded_ready', 'readiness_tenant_branded'],
];

function fieldValue(formData: NativeAppForm, key: string): string {
  const value = formData[key];
  return typeof value === 'boolean' ? String(value) : String(value ?? '');
}

export function NativeApp() {
  const { t } = useTranslation('admin_system');
  usePageTitle(t('system.page_title'));
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [formData, setFormData] = useState<NativeAppForm>(DEFAULT_FORM);
  const [readiness, setReadiness] = useState<NativeAppReadiness>({});

  const tenantBranded = formData.native_app_store_mode === 'tenant_branded';
  const readyCount = useMemo(
    () => readinessLabels.filter(([key]) => readiness[key]).length,
    [readiness],
  );

  useEffect(() => {
    adminSettings.getNativeAppSettings()
      .then((res) => {
        const payload = (res.data ?? {}) as NativeAppResponse;
        setFormData((prev) => ({ ...prev, ...(payload.native_app ?? {}) }));
        setReadiness(payload.deployment_readiness ?? {});
      })
      .catch(() => toast.error(t('system.failed_to_load_native_app_settings')))
      .finally(() => setLoading(false));
  }, [t, toast]);

  const updateField = (key: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await adminSettings.updateNativeAppSettings(formData);
      if (res.success) {
        const refreshed = await adminSettings.getNativeAppSettings();
        const payload = (refreshed.data ?? {}) as NativeAppResponse;
        setFormData((prev) => ({ ...prev, ...(payload.native_app ?? {}) }));
        setReadiness(payload.deployment_readiness ?? {});
        toast.success(t('system.native_app_settings_saved_successfully'));
      } else {
        toast.error(t('system.failed_to_save_native_app_settings'));
      }
    } catch {
      toast.error(t('system.failed_to_save_native_app_settings'));
    } finally {
      setSaving(false);
    }
  };

  const exportBuildManifest = async () => {
    setExporting(true);
    try {
      const response = await adminSettings.getNativeAppBuildManifest();
      const manifest = response.data ?? {};
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'native-app-build-manifest.json';
      link.click();
      URL.revokeObjectURL(url);
      toast.success(t('system.native_app.build_manifest_exported'));
    } catch {
      toast.error(t('system.native_app.build_manifest_export_failed'));
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('system.native_app_title')}
        description={t('system.native_app.description')}
      />

      <div className="space-y-4">
        <NativeAppInstallStats />

        <Card>
          <CardHeader className="flex items-center gap-2">
            <Smartphone size={20} />
            <h3 className="text-lg font-semibold">{t('system.native_app.app_configuration')}</h3>
          </CardHeader>
          <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input label={t('system.native_app.app_name')} variant="secondary" value={fieldValue(formData, 'native_app_name')} onValueChange={(v) => updateField('native_app_name', v)} />
            <Input label={t('system.native_app.short_name')} variant="secondary" value={fieldValue(formData, 'native_app_short_name')} onValueChange={(v) => updateField('native_app_short_name', v)} />
            <Input label={t('system.native_app.bundle_id')} variant="secondary" value={fieldValue(formData, 'native_app_bundle_id')} onValueChange={(v) => updateField('native_app_bundle_id', v)} />
            <Input label={t('system.native_app.package_name')} variant="secondary" value={fieldValue(formData, 'native_app_package_name')} onValueChange={(v) => updateField('native_app_package_name', v)} />
            <Input label={t('system.native_app.app_version')} variant="secondary" value={fieldValue(formData, 'native_app_version')} onValueChange={(v) => updateField('native_app_version', v)} />
            <Select label={t('system.native_app.store_mode')} selectedKeys={[fieldValue(formData, 'native_app_store_mode')]} onChange={(event) => updateField('native_app_store_mode', event.target.value)}>
              <SelectItem key="shared" id="shared">{t('system.native_app.shared_app')}</SelectItem>
              <SelectItem key="tenant_branded" id="tenant_branded">{t('system.native_app.tenant_branded_app')}</SelectItem>
            </Select>
            <Select label={t('system.native_app.build_profile')} selectedKeys={[fieldValue(formData, 'native_app_build_profile')]} onChange={(event) => updateField('native_app_build_profile', event.target.value)}>
              <SelectItem key="preview" id="preview">{t('system.native_app.preview')}</SelectItem>
              <SelectItem key="production" id="production">{t('system.native_app.production')}</SelectItem>
            </Select>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><h3 className="text-lg font-semibold">{t('system.native_app.store_metadata')}</h3></CardHeader>
          <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input label={t('system.native_app.ios_app_store_id')} variant="secondary" value={fieldValue(formData, 'native_app_ios_app_store_id')} onValueChange={(v) => updateField('native_app_ios_app_store_id', v)} />
            <Input label={t('system.native_app.android_play_store_id')} variant="secondary" value={fieldValue(formData, 'native_app_android_play_store_id')} onValueChange={(v) => updateField('native_app_android_play_store_id', v)} />
            <Input label={t('system.native_app.marketing_url')} variant="secondary" value={fieldValue(formData, 'native_app_marketing_url')} onValueChange={(v) => updateField('native_app_marketing_url', v)} />
            <Input label={t('system.native_app.privacy_url')} variant="secondary" value={fieldValue(formData, 'native_app_privacy_url')} onValueChange={(v) => updateField('native_app_privacy_url', v)} />
            <Input label={t('system.native_app.support_url')} variant="secondary" value={fieldValue(formData, 'native_app_support_url')} onValueChange={(v) => updateField('native_app_support_url', v)} className="md:col-span-2" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader><h3 className="text-lg font-semibold">{t('system.native_app.push_notifications')}</h3></CardHeader>
          <CardBody className="gap-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">{t('system.native_app.enable_push_notifications')}</p>
                <p className="text-sm text-muted">{t('system.native_app.enable_push_notifications_desc')}</p>
              </div>
              <Switch isSelected={!!formData.native_app_push_enabled} onValueChange={(v) => updateField('native_app_push_enabled', v)} aria-label={t('system.native_app.push_notifications')} />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input label={t('system.native_app.fcm_server_key')} type="password" variant="secondary" value={fieldValue(formData, 'native_app_fcm_server_key')} onValueChange={(v) => updateField('native_app_fcm_server_key', v)} />
              <Input label={t('system.native_app.apns_key_id')} type="password" variant="secondary" value={fieldValue(formData, 'native_app_apns_key_id')} onValueChange={(v) => updateField('native_app_apns_key_id', v)} />
              <Input label={t('system.native_app.apns_team_id')} variant="secondary" value={fieldValue(formData, 'native_app_apns_team_id')} onValueChange={(v) => updateField('native_app_apns_team_id', v)} />
              <Input label={t('system.native_app.push_sender_id')} variant="secondary" value={fieldValue(formData, 'native_app_push_sender_id')} onValueChange={(v) => updateField('native_app_push_sender_id', v)} />
              <Input label={t('system.native_app.tenant_channel_prefix')} variant="secondary" value={fieldValue(formData, 'native_app_tenant_channel_prefix')} onValueChange={(v) => updateField('native_app_tenant_channel_prefix', v)} className="md:col-span-2" />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><h3 className="text-lg font-semibold">{t('system.native_app.pwa_settings')}</h3></CardHeader>
          <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-divider p-3">
              <div>
                <p className="font-medium">{t('system.native_app.service_worker')}</p>
                <p className="text-sm text-muted">{t('system.native_app.service_worker_desc')}</p>
              </div>
              <Switch isSelected={!!formData.native_app_service_worker} onValueChange={(v) => updateField('native_app_service_worker', v)} aria-label={t('system.native_app.service_worker')} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-divider p-3">
              <div>
                <p className="font-medium">{t('system.native_app.install_prompt')}</p>
                <p className="text-sm text-muted">{t('system.native_app.install_prompt_desc')}</p>
              </div>
              <Switch isSelected={!!formData.native_app_install_prompt} onValueChange={(v) => updateField('native_app_install_prompt', v)} aria-label={t('system.native_app.install_prompt')} />
            </div>
            <Input label={t('system.native_app.theme_color')} type="color" variant="secondary" value={fieldValue(formData, 'native_app_theme_color')} onValueChange={(v) => updateField('native_app_theme_color', v)} />
            <Input label={t('system.native_app.background_color')} type="color" variant="secondary" value={fieldValue(formData, 'native_app_background_color')} onValueChange={(v) => updateField('native_app_background_color', v)} />
            <Select label={t('system.native_app.display')} selectedKeys={[fieldValue(formData, 'native_app_display')]} onChange={(event) => updateField('native_app_display', event.target.value)}>
              <SelectItem key="standalone" id="standalone">{t('system.native_app.standalone')}</SelectItem>
              <SelectItem key="fullscreen" id="fullscreen">{t('system.native_app.fullscreen')}</SelectItem>
              <SelectItem key="minimal-ui" id="minimal-ui">{t('system.native_app.minimal_ui')}</SelectItem>
              <SelectItem key="browser" id="browser">{t('system.native_app.browser')}</SelectItem>
            </Select>
            <Select label={t('system.native_app.orientation')} selectedKeys={[fieldValue(formData, 'native_app_orientation')]} onChange={(event) => updateField('native_app_orientation', event.target.value)}>
              <SelectItem key="portrait" id="portrait">{t('system.native_app.portrait')}</SelectItem>
              <SelectItem key="landscape" id="landscape">{t('system.native_app.landscape')}</SelectItem>
              <SelectItem key="any" id="any">{t('system.native_app.any')}</SelectItem>
            </Select>
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{t('system.native_app.deployment_readiness')}</h3>
            <Chip color={tenantBranded && readiness.tenant_branded_ready ? 'success' : 'warning'} variant="soft">
              {readyCount} / {readinessLabels.length}
            </Chip>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
              {readinessLabels.map(([key, labelKey]) => (
                <div key={key} className="rounded-lg border border-divider p-3">
                  <p className="text-sm font-medium">{t(`system.native_app.${labelKey}`)}</p>
                  <Chip size="sm" color={readiness[key] ? 'success' : 'default'} variant="soft" className="mt-2">
                    {readiness[key] ? t('system.native_app.ready') : t('system.native_app.missing')}
                  </Chip>
                </div>
              ))}
            </div>
            {!!readiness.missing_requirements?.length && (
              <div className="mt-4 rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800">
                <p className="font-medium">{t('system.native_app.missing_requirements')}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {readiness.missing_requirements.map((requirement) => (
                    <li key={requirement}>{t(`system.native_app.requirements.${requirement}`)}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" startContent={<Download size={16} />} onPress={() => void exportBuildManifest()} isLoading={exporting}>
            {t('system.native_app.export_build_manifest')}
          </Button>
          <Button variant="primary" startContent={<Save size={16} />} onPress={() => void handleSave()} isLoading={saving}>
            {t('system.native_app.save_settings')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default NativeApp;
