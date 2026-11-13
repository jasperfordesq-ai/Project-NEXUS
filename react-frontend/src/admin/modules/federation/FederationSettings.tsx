// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Card, CardBody, CardHeader, Button, Input, Switch, Skeleton } from '@/components/ui';
import { useState, useCallback, useEffect } from 'react';

import { Separator } from '@/components/ui';
import Network from 'lucide-react/icons/network';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Save from 'lucide-react/icons/save';
import KeyRound from 'lucide-react/icons/key-round';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { adminFederation } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { PartnerTimebankGuidance } from './PartnerTimebankGuidance';
import { BrokerEmptyState, BrokerStatusChip } from '@/broker/components';

/**
 * Federation Settings
 * Configure federation features and partnership preferences for the tenant.
 * Includes functional switches with save/dirty state tracking.
 */


interface FedSettings {
  federation_enabled: boolean;
  tenant_id: number;
  settings: {
    allow_inbound_partnerships: boolean;
    shared_categories: string[];
    max_partnerships: number;
  };
}

export function FederationSettings() {
  const { t } = useTranslation('admin_federation', { keyPrefix: 'federation' });
  usePageTitle(t('federation_settings_title'));
  const toast = useToast();

  const [data, setData] = useState<FedSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFederation.getSettings();
      if (res.success && res.data) {
        const payload = res.data as unknown;
        if (payload && typeof payload === 'object' && 'data' in payload) {
          setData((payload as { data: FedSettings }).data);
        } else {
          setData(payload as FedSettings);
        }
        setDirty(false);
      }
    } catch {
      toast.error(t('failed_to_load_federation_settings'));
      setData(null);
    }
    setLoading(false);
  }, [t, toast])


  useEffect(() => { loadData(); }, [loadData]);

  const updateField = useCallback((field: string, value: boolean | number) => {
    setData((prev) => {
      if (!prev) return prev;
      if (field === 'federation_enabled') {
        return { ...prev, federation_enabled: value as boolean };
      }
      return {
        ...prev,
        settings: { ...prev.settings, [field]: value },
      };
    });
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!data) return;
    setSaving(true);
    try {
      const res = await adminFederation.updateSettings({
        federation_enabled: data.federation_enabled,
        settings: data.settings,
      });
      if (res.success) {
        toast.success(t('federation_settings_saved_successfully'));
        setDirty(false);
      } else {
        const error = t('save_failed');
        toast.error(error);
      }
    } catch {
      toast.error(t('failed_to_save_federation_settings'));
    } finally {
      setSaving(false);
    }
  }, [data, t, toast])


  if (loading) {
    return (
      <div>
        <PageHeader
          title={t('federation_settings_title')}
          description={t('federation_settings_desc')}
        />
        <div role="status" aria-label={t('loading')} aria-busy="true" className="space-y-6">
          <Card >
            <CardHeader><Skeleton className="h-5 w-40 rounded-lg" /></CardHeader>
            <CardBody className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32 rounded-lg" />
                    <Skeleton className="h-3 w-48 rounded-lg" />
                  </div>
                  <Skeleton className="h-6 w-12 rounded-full" />
                </div>
              ))}
            </CardBody>
          </Card>
          <Card >
            <CardHeader><Skeleton className="h-5 w-48 rounded-lg" /></CardHeader>
            <CardBody className="space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-4 w-36 rounded-lg" />
                  <Skeleton className="h-8 w-20 rounded-lg" />
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <PageHeader
          title={t('federation_settings_title')}
          description={t('federation_settings_desc')}
          actions={
            <Button variant="tertiary" startContent={<RefreshCw aria-hidden="true" size={16} />} onPress={loadData}>
              {t('refresh')}
            </Button>
          }
        />
        <BrokerEmptyState
          icon={Network}
          title={t('not_enabled_for_tenant')}
          hint={t('enable_from_tenant_features')}
          color="neutral"
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('federation_settings_title')}
        description={t('federation_settings_desc')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw aria-hidden="true" size={16} />}
            onPress={loadData}
            size="sm"
          >
            {t('refresh')}
          </Button>
        }
      />

      <div className="space-y-4">
        <PartnerTimebankGuidance page="settings" />

        {/* Platform-level JWT auth is configured in Super Admin → Federation
            Controls. Tenant admins see this pointer so they know where to
            look (and can ask the platform operator) when a partner using
            JWT-based auth has trouble. */}
        <Card  className="border border-border">
          <CardBody className="flex flex-row items-start gap-3 text-sm">
            <KeyRound aria-hidden="true" size={18} className="text-muted mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">{t('jwt_federation_auth_platform_title')}</p>
              <p className="text-muted mt-1">
                {t('jwt_federation_auth_platform_intro')}{' '}
                <strong>{t('external_partners')}</strong>{' '}
                {t('jwt_federation_auth_platform_middle')}{' '}
                <code className="text-xs bg-surface-secondary px-1 rounded">FEDERATION_JWT_SECRET</code>{' '}
                {t('jwt_federation_auth_platform_suffix')}{' '}
                <strong>{t('label_super_admin')} / {t('federation_controls')}</strong>.
              </p>
            </div>
          </CardBody>
        </Card>

        <Card >
          <CardHeader className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{t('federation_status')}</h3>
            <BrokerStatusChip status={data.federation_enabled ? 'active' : 'inactive'} />
          </CardHeader>
          <CardBody>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">{t('federation_enabled')}</p>
                <p className="text-sm text-muted">{t('federation_enabled_desc')}</p>
              </div>
              <Switch
                isSelected={data.federation_enabled}
                onValueChange={(val) => updateField('federation_enabled', val)}
                aria-label={t('federation_enabled')}
              />
            </div>
          </CardBody>
        </Card>

        <Card >
          <CardHeader><h3 className="text-lg font-semibold">{t('partnership_preferences')}</h3></CardHeader>
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">{t('allow_inbound_partnerships')}</p>
                <p className="text-sm text-muted">{t('allow_inbound_partnerships_desc')}</p>
              </div>
              <Switch
                isSelected={data.settings?.allow_inbound_partnerships ?? true}
                onValueChange={(val) => updateField('allow_inbound_partnerships', val)}
                aria-label={t('allow_inbound_partnerships')}
              />
            </div>
            {/* "Approve new partners automatically" lived here until November
                2026. Nothing on the server ever acted on it, and it was retired
                rather than made real: approving a partnership shares member
                profiles with another community, which stays a person's call. */}
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">{t('max_partnerships')}</p>
                <p className="text-sm text-muted">{t('max_partnerships_desc')}</p>
              </div>
              <Input
                type="number"
                value={String(data.settings?.max_partnerships ?? 10)}
                onValueChange={(val) => updateField('max_partnerships', Math.min(100, Math.max(1, parseInt(val, 10) || 1)))}
                variant="secondary"
                size="sm"
                className="w-24"
                min={1}
                max={100}
                aria-label={t('max_partnerships')}
              />
            </div>
            <Separator />
            <div className="flex flex-wrap items-center justify-end gap-3">
              {dirty && <span className="text-xs text-warning">{t('unsaved_changes')}</span>}
              <Button
                startContent={<Save aria-hidden="true" size={16} />}
                onPress={handleSave}
                isLoading={saving}
                isDisabled={!dirty}
                size="sm"
              >
                {t('save_changes')}
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default FederationSettings;
