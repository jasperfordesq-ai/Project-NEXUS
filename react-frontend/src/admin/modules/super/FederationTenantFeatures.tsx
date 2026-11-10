// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Card, CardBody, CardHeader, Button, Chip, Spinner, Switch } from '@/components/ui';
import { useState, useCallback, useEffect } from 'react';

import { Separator } from '@/components/ui';
import { useParams } from 'react-router-dom';
import Shield from 'lucide-react/icons/shield';
import Network from 'lucide-react/icons/network';
import UserCheck from 'lucide-react/icons/user-check';
import MessageSquare from 'lucide-react/icons/message-square';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import LayoutList from 'lucide-react/icons/layout-list';
import Calendar from 'lucide-react/icons/calendar';
import Users from 'lucide-react/icons/users';
import Plus from 'lucide-react/icons/plus';
import Minus from 'lucide-react/icons/minus';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { useTranslation } from 'react-i18next';
import { adminSuper } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/DataTable';
import { ConfirmModal } from '../../components/ConfirmModal';
import type { FederationWhitelistEntry, FederationPartnership } from '../../api/types';

/**
 * Federation Tenant Features
 * Manage federation-specific features for an individual tenant:
 * whitelist status, feature toggles, and partnerships.
 */


interface TenantFeatureSet {
  cross_tenant_profiles_enabled: boolean;
  cross_tenant_messaging_enabled: boolean;
  cross_tenant_transactions_enabled: boolean;
  cross_tenant_listings_enabled: boolean;
  cross_tenant_events_enabled: boolean;
  cross_tenant_groups_enabled: boolean;
}

interface TenantInfo {
  id: number;
  name: string;
  slug: string;
  domain: string;
}

const FEATURE_TOGGLE_KEYS: Array<{
  key: keyof TenantFeatureSet;
  labelKey: string;
  descKey: string;
  icon: typeof Shield;
}> = [
  { key: 'cross_tenant_profiles_enabled', labelKey: 'super.cross_tenant_profiles', descKey: 'super.cross_tenant_profiles_desc', icon: UserCheck },
  { key: 'cross_tenant_messaging_enabled', labelKey: 'super.cross_tenant_messaging', descKey: 'super.cross_tenant_messaging_desc', icon: MessageSquare },
  { key: 'cross_tenant_transactions_enabled', labelKey: 'super.cross_tenant_transactions', descKey: 'super.cross_tenant_transactions_desc', icon: ArrowLeftRight },
  { key: 'cross_tenant_listings_enabled', labelKey: 'super.cross_tenant_listings', descKey: 'super.cross_tenant_listings_desc', icon: LayoutList },
  { key: 'cross_tenant_events_enabled', labelKey: 'super.cross_tenant_events', descKey: 'super.cross_tenant_events_desc', icon: Calendar },
  { key: 'cross_tenant_groups_enabled', labelKey: 'super.cross_tenant_groups', descKey: 'super.cross_tenant_groups_desc', icon: Users },
];

export function FederationTenantFeatures() {
  const { t } = useTranslation('admin_super');
  const { tenantId } = useParams<{ tenantId: string }>();
  const numericTenantId = Number(tenantId);
  const toast = useToast();

  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [features, setFeatures] = useState<TenantFeatureSet | null>(null);
  const [whitelisted, setWhitelisted] = useState(false);
  const [partnerships, setPartnerships] = useState<FederationPartnership[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [partnerAction, setPartnerAction] = useState<{ type: 'suspend' | 'terminate'; id: number } | null>(null);

  usePageTitle(tenant ? t('super.federation_features_title') : t('super.loading_tenant_features'));

  const loadData = useCallback(async () => {
    if (!numericTenantId || isNaN(numericTenantId)) return;
    setLoading(true);

    const [tenantRes, featuresRes, whitelistRes, partnershipsRes] = await Promise.all([
      adminSuper.getTenant(numericTenantId),
      adminSuper.getTenantFederationFeatures(numericTenantId),
      adminSuper.getWhitelist(),
      adminSuper.getFederationPartnerships(),
    ]);

    if (tenantRes.success && tenantRes.data) {
      const t = tenantRes.data;
      setTenant({ id: t.id, name: t.name, slug: t.slug, domain: t.domain });
    }

    if (featuresRes.success && featuresRes.data) {
      const raw = featuresRes.data as unknown as { features?: Record<string, boolean> };
      if (raw.features) {
        setFeatures({
          cross_tenant_profiles_enabled: raw.features.cross_tenant_profiles_enabled ?? false,
          cross_tenant_messaging_enabled: raw.features.cross_tenant_messaging_enabled ?? false,
          cross_tenant_transactions_enabled: raw.features.cross_tenant_transactions_enabled ?? false,
          cross_tenant_listings_enabled: raw.features.cross_tenant_listings_enabled ?? false,
          cross_tenant_events_enabled: raw.features.cross_tenant_events_enabled ?? false,
          cross_tenant_groups_enabled: raw.features.cross_tenant_groups_enabled ?? false,
        });
      }
    } else {
      // Default all off if endpoint returns nothing
      setFeatures({
        cross_tenant_profiles_enabled: false,
        cross_tenant_messaging_enabled: false,
        cross_tenant_transactions_enabled: false,
        cross_tenant_listings_enabled: false,
        cross_tenant_events_enabled: false,
        cross_tenant_groups_enabled: false,
      });
    }

    if (whitelistRes.success && whitelistRes.data) {
      const list = Array.isArray(whitelistRes.data) ? whitelistRes.data : [];
      setWhitelisted(list.some((e: FederationWhitelistEntry) => e.tenant_id === numericTenantId));
    }

    if (partnershipsRes.success && partnershipsRes.data) {
      const all = Array.isArray(partnershipsRes.data) ? partnershipsRes.data : [];
      setPartnerships(
        all.filter(
          (p: FederationPartnership) =>
            p.tenant_1_id === numericTenantId || p.tenant_2_id === numericTenantId,
        ),
      );
    }

    setLoading(false);
  }, [numericTenantId]);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleFeature = async (featureKey: keyof TenantFeatureSet, enabled: boolean) => {
    setSaving(featureKey);
    const res = await adminSuper.updateTenantFederationFeature(numericTenantId, featureKey, enabled);
    if (res?.success) {
      toast.success(t('super.tenant_feature_toggled'));
      setFeatures((prev) => prev ? { ...prev, [featureKey]: enabled } : prev);
    } else {
      toast.error(t('super.failed_to_update_feature'));
    }
    setSaving(null);
  };

  const toggleWhitelist = async () => {
    setSaving('whitelist');
    if (whitelisted) {
      const res = await adminSuper.removeFromWhitelist(numericTenantId);
      if (res?.success) {
        toast.success(t('super.removed_from_whitelist'));
        setWhitelisted(false);
      } else {
        toast.error(t('super.failed_to_remove_from_whitelist'));
      }
    } else {
      const res = await adminSuper.addToWhitelist(numericTenantId);
      if (res?.success) {
        toast.success(t('super.added_to_whitelist'));
        setWhitelisted(true);
      } else {
        toast.error(t('super.failed_to_add_to_whitelist'));
      }
    }
    setSaving(null);
  };

  const handlePartnerAction = async () => {
    if (!partnerAction) return;
    const res = partnerAction.type === 'suspend'
      ? await adminSuper.suspendPartnership(partnerAction.id, t('super.suspended_by_super_admin'))
      : await adminSuper.terminatePartnership(partnerAction.id, t('super.terminated_by_super_admin'));
    if (res?.success) {
      toast.success(t('super.partnership_action_success'));
      loadData();
    } else {
      toast.error(t('super.operation_failed'));
    }
    setPartnerAction(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16">
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" label={t('super.loading_tenant_features')} /></div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="p-8 text-center text-muted">
        {t('super.tenant_not_found')}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('super.federation_features_title')}
        description={t('super.federation_features_desc')}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tenant Info */}
        <Card>
          <CardHeader className="flex gap-2 items-center">
            <Network size={20} />
            <h3 className="font-semibold">{t('super.tenant_information')}</h3>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-muted">{t('super.label_name')}</span>
              <span className="font-medium">{tenant.name}</span>
            </div>
            <Separator />
            <div className="flex justify-between items-center">
              <span className="text-muted">{t('super.label_slug')}</span>
              <Chip size="sm" variant="soft">{tenant.slug}</Chip>
            </div>
            <Separator />
            <div className="flex justify-between items-center">
              <span className="text-muted">{t('super.label_domain')}</span>
              <span className="text-sm">{tenant.domain || t('super.not_applicable')}</span>
            </div>
            <Separator />
            <div className="flex justify-between items-center">
              <span className="text-muted">{t('super.label_tenant_id')}</span>
              <Chip size="sm" variant="soft" color="accent">{tenant.id}</Chip>
            </div>
          </CardBody>
        </Card>

        {/* Whitelist Status */}
        <Card>
          <CardHeader className="flex gap-2 items-center">
            <Shield size={20} />
            <h3 className="font-semibold">{t('super.whitelist_status')}</h3>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span>{t('super.federation_whitelist_label')}</span>
              <Chip
                color={whitelisted ? 'success' : 'default'}
                variant="soft"
                size="lg"
              >
                {whitelisted ? t('super.whitelisted') : t('super.not_whitelisted')}
              </Chip>
            </div>
            <p className="text-sm text-muted">
              {whitelisted
                ? t('super.whitelisted_desc')
                : t('super.not_whitelisted_desc')}
            </p>
            <Button
              variant={whitelisted ? 'danger' : 'secondary'}
              startContent={whitelisted ? <Minus size={16} /> : <Plus size={16} />}
              isLoading={saving === 'whitelist'}
              onPress={toggleWhitelist}
            >
              {whitelisted ? t('super.remove_from_whitelist') : t('super.add_to_whitelist')}
            </Button>
          </CardBody>
        </Card>

        {/* Feature Toggles */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex gap-2 items-center">
            <Shield size={20} />
            <h3 className="font-semibold">{t('super.federation_feature_toggles')}</h3>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {features && FEATURE_TOGGLE_KEYS.map(({ key, labelKey, descKey, icon: Icon }) => (
                <div
                  key={key}
                  className="flex items-center justify-between p-3 rounded-lg bg-surface-secondary"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent-soft-foreground">
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{t(labelKey)}</p>
                      <p className="text-xs text-muted truncate">{t(descKey)}</p>
                    </div>
                  </div>
                  <Switch
                    size="sm"
                    isSelected={features[key]}
                    isDisabled={saving === key}
                    onValueChange={(v) => toggleFeature(key, v)}
                  />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* Partnerships */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex gap-2 items-center">
            <Network size={20} />
            <h3 className="font-semibold">
              {t('super.tab_with_count', { label: t('super.partnerships_heading'), count: partnerships.length })}
            </h3>
          </CardHeader>
          <CardBody>
            {partnerships.length === 0 ? (
              <p className="text-muted text-sm text-center py-4">
                {t('super.no_partnerships_for_tenant')}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {partnerships.map((p) => {
                  const partnerName =
                    p.tenant_1_id === numericTenantId ? p.tenant_2_name : p.tenant_1_name;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between py-3 px-2 border-b last:border-b-0"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-medium">{partnerName}</span>
                        <StatusBadge status={p.status} />
                        <span className="text-xs text-muted">
                          {t('super.since_date')}
                        </span>
                      </div>
                      {p.status === 'active' && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onPress={() => setPartnerAction({ type: 'suspend', id: p.id })}
                          >
                            {t('super.suspend_btn')}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onPress={() => setPartnerAction({ type: 'terminate', id: p.id })}
                          >
                            {t('super.terminate_btn')}
                          </Button>
                        </div>
                      )}
                      {p.status === 'suspended' && (
                        <Chip size="sm" variant="soft" color="warning">{t('super.partnership_suspended')}</Chip>
                      )}
                      {p.status === 'terminated' && (
                        <Chip size="sm" variant="soft" color="danger">{t('super.partnership_terminated')}</Chip>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <ConfirmModal
        isOpen={!!partnerAction}
        onClose={() => setPartnerAction(null)}
        onConfirm={handlePartnerAction}
        title={partnerAction ? (partnerAction.type === 'suspend' ? t('super.suspend_partnership_message') : t('super.terminate_partnership_message')) : ''}
        message={t('super.partnership_action_confirm')}
        confirmLabel={partnerAction?.type === 'suspend' ? t('super.suspend_btn') : t('super.terminate_btn')}
        confirmColor="danger"
      />
    </div>
  );
}

export default FederationTenantFeatures;
