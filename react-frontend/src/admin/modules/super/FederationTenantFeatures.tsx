// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Card, CardBody, CardHeader, Chip, Spinner, Switch } from '@/components/ui';
import { useState, useCallback, useEffect } from 'react';

import { Separator } from '@/components/ui';
import { Link, useParams } from 'react-router-dom';
import Shield from 'lucide-react/icons/shield';
import Network from 'lucide-react/icons/network';
import UserCheck from 'lucide-react/icons/user-check';
import MessageSquare from 'lucide-react/icons/message-square';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import LayoutList from 'lucide-react/icons/layout-list';
import Calendar from 'lucide-react/icons/calendar';
import Users from 'lucide-react/icons/users';
import { usePageTitle } from '@/hooks';
import { useAuth, useTenant, useToast } from '@/contexts';
import { isPlatformTeamUser } from '@/lib/access';
import { useTranslation } from 'react-i18next';
import { adminSuper } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/DataTable';
import type { TenantFederationPartnership } from '../../api/types';

/**
 * Federation Tenant Features
 * Manage federation-specific features for an individual tenant, and show its
 * whitelist status and partnerships.
 *
 * Owner decision 17 Nov 2026: the whitelist and the partnership list are the
 * platform team's (their endpoints refuse everyone else). This page reads only
 * its own community's request, `federation/tenant/{id}/features`, which the
 * server confines to the caller's branch, and shows the whitelist status and
 * the partnerships read-only. Changing them happens in the Platform team panel
 * ("one admin place per setting"); a platform team member gets a pointer there.
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
  const { user } = useAuth();
  const { tenantPath } = useTenant();
  const onPlatformTeam = isPlatformTeamUser(user);

  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [features, setFeatures] = useState<TenantFeatureSet | null>(null);
  const [whitelisted, setWhitelisted] = useState(false);
  const [partnerships, setPartnerships] = useState<TenantFederationPartnership[]>([]);
  // False when the community's own federation request failed: the page then
  // says so instead of showing "not whitelisted" or "no partnerships".
  const [federationRead, setFederationRead] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  usePageTitle(tenant ? t('super.federation_features_title') : t('super.loading_tenant_features'));

  const loadData = useCallback(async () => {
    if (!numericTenantId || isNaN(numericTenantId)) return;
    setLoading(true);

    const [tenantRes, featuresRes] = await Promise.all([
      adminSuper.getTenant(numericTenantId),
      adminSuper.getTenantFederationFeatures(numericTenantId),
    ]);

    if (tenantRes.success && tenantRes.data) {
      const t = tenantRes.data;
      setTenant({ id: t.id, name: t.name, slug: t.slug, domain: t.domain });
    }

    if (featuresRes.success && featuresRes.data) {
      const raw = featuresRes.data;
      const flags = raw.features ?? {};
      setFeatures({
        cross_tenant_profiles_enabled: flags.cross_tenant_profiles_enabled ?? false,
        cross_tenant_messaging_enabled: flags.cross_tenant_messaging_enabled ?? false,
        cross_tenant_transactions_enabled: flags.cross_tenant_transactions_enabled ?? false,
        cross_tenant_listings_enabled: flags.cross_tenant_listings_enabled ?? false,
        cross_tenant_events_enabled: flags.cross_tenant_events_enabled ?? false,
        cross_tenant_groups_enabled: flags.cross_tenant_groups_enabled ?? false,
      });
      setWhitelisted(raw.is_whitelisted === true);
      setPartnerships(Array.isArray(raw.partnerships) ? raw.partnerships : []);
      setFederationRead(true);
    } else {
      // Unread is not "all off": show nothing as if it were the answer.
      setFeatures(null);
      setWhitelisted(false);
      setPartnerships([]);
      setFederationRead(false);
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
            {federationRead ? (
              <>
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
              </>
            ) : (
              <p className="text-sm text-muted">{t('super.tenant_federation_read_failed')}</p>
            )}
            {onPlatformTeam && (
              <Link
                to={tenantPath('/platform-team/federation/whitelist')}
                className="text-sm text-accent underline underline-offset-2"
              >
                {t('super.manage_whitelist_in_platform_team')}
              </Link>
            )}
          </CardBody>
        </Card>

        {/* Feature Toggles */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex gap-2 items-center">
            <Shield size={20} />
            <h3 className="font-semibold">{t('super.federation_feature_toggles')}</h3>
          </CardHeader>
          <CardBody>
            {!features && (
              <p className="text-sm text-muted">{t('super.tenant_federation_read_failed')}</p>
            )}
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
              {federationRead
                ? t('super.tab_with_count', { label: t('super.partnerships_heading'), count: partnerships.length })
                : t('super.partnerships_heading')}
            </h3>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {!federationRead ? (
              <p className="text-muted text-sm text-center py-4">
                {t('super.tenant_federation_read_failed')}
              </p>
            ) : partnerships.length === 0 ? (
              <p className="text-muted text-sm text-center py-4">
                {t('super.no_partnerships_for_tenant')}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {partnerships.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between py-3 px-2 border-b last:border-b-0"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{p.partner_name ?? t('super.not_applicable')}</span>
                      <StatusBadge status={p.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {onPlatformTeam && (
              <Link
                to={tenantPath('/platform-team/federation/partnerships')}
                className="text-sm text-accent underline underline-offset-2"
              >
                {t('super.manage_partnerships_in_platform_team')}
              </Link>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default FederationTenantFeatures;
