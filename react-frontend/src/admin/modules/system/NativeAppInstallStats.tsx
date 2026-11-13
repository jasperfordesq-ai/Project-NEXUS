// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Phone app — the figures, the member list, and (for a platform owner) the
 * all-communities view.
 *
 * Two tiers, mirroring the API:
 *  - every community admin sees their own community;
 *  - a god-mode operator additionally sees a cross-community block, which the
 *    server sends only to them (`platform` is null for everyone else).
 *
 * 🔴 A member "has the app" when they are signed in on it — with or without
 * notifications. These are NOT Google Play / App Store download counts, and
 * the page keeps saying so: someone who installs the app and never signs in is
 * unknown to the platform.
 *
 * Wording here is for a community administrator, not a developer. No "push",
 * "registration", "tenant" or "god mode" on screen — a test enforces it.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Bell from 'lucide-react/icons/bell';
import Building2 from 'lucide-react/icons/building-2';
import Globe from 'lucide-react/icons/globe';
import Info from 'lucide-react/icons/info';
import Smartphone from 'lucide-react/icons/smartphone';
import UserPlus from 'lucide-react/icons/user-plus';
import Users from 'lucide-react/icons/users';

import { Card, CardBody, CardHeader, Chip } from '@/components/ui';
import { getFormattingLocale } from '@/lib/helpers';
import { adminSettings } from '../../api/adminApi';
import { DataTable, type Column } from '../../components/DataTable';
import { StatCard } from '../../components/StatCard';
import { NativeAppMembersTable, PhoneChips, formatAppDate, type NativeAppMember } from './NativeAppMembersTable';

export interface NativeAppSummary {
  /** Signed in on the app, with or without notifications. */
  members_with_app: number;
  members_notifications_on: number;
  /** Phones that allowed notifications — the only ones whose type we know. */
  native_devices: number;
  devices_by_platform: Record<string, number>;
  last_joined_at: string | null;
}

export interface NativeAppTenantStats extends NativeAppSummary {
  tenant_id: number;
}

export interface NativeAppTenantBreakdown {
  tenant_id: number;
  tenant_name: string | null;
  tenant_slug: string | null;
  members_with_app: number;
  native_devices: number;
  last_joined_at: string | null;
}

export interface NativeAppRecentMember extends NativeAppMember {
  tenant_id: number;
  tenant_name: string | null;
}

export interface NativeAppPlatformStats extends NativeAppSummary {
  tenants_with_app: number;
  by_tenant: NativeAppTenantBreakdown[];
  recent_members: NativeAppRecentMember[];
}

export interface NativeAppInstallStatsResponse {
  tenant_id: number;
  is_god: boolean;
  scope: 'tenant' | 'platform';
  tenant: NativeAppTenantStats;
  platform: NativeAppPlatformStats | null;
}

export function NativeAppInstallStats() {
  const { t } = useTranslation('admin_system');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [stats, setStats] = useState<NativeAppInstallStatsResponse | null>(null);

  useEffect(() => {
    let active = true;

    adminSettings.getNativeAppInstallStats()
      .then((res) => {
        if (!active) return;
        const data = (res.data ?? null) as NativeAppInstallStatsResponse | null;
        setStats(data);
        // A reply with no figures in it is a failed load, not a community of zero.
        setFailed(!data?.tenant);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, []);

  const tenant = stats?.tenant;
  const platform = stats?.platform ?? null;
  const number = (value: number) => value.toLocaleString(getFormattingLocale());

  // The all-communities tables use the shared admin table so they turn into
  // cards on a phone instead of running off the side of the screen.
  const communityColumns = useMemo<Column<NativeAppTenantBreakdown>[]>(() => [
    {
      key: 'community',
      label: t('system.phone_app.all.columns.community'),
      isRowHeader: true,
      render: (row) => (
        <div>
          <div className="font-medium text-foreground">
            {row.tenant_name ?? t('system.phone_app.all.unnamed_community', { id: row.tenant_id })}
          </div>
          {row.tenant_slug ? <div className="text-xs text-muted">{row.tenant_slug}</div> : null}
        </div>
      ),
    },
    {
      key: 'members_with_app',
      label: t('system.phone_app.all.columns.members'),
      render: (row) => row.members_with_app.toLocaleString(getFormattingLocale()),
    },
    {
      key: 'native_devices',
      label: t('system.phone_app.all.columns.phones'),
      render: (row) => row.native_devices.toLocaleString(getFormattingLocale()),
    },
    {
      key: 'last_joined_at',
      label: t('system.phone_app.all.columns.newest'),
      render: (row) => formatAppDate(row.last_joined_at, t('system.phone_app.members.no_date')),
    },
  ], [t]);

  const newestColumns = useMemo<Column<NativeAppRecentMember & { row_key: string }>[]>(() => [
    {
      key: 'member',
      label: t('system.phone_app.members.columns.member'),
      isRowHeader: true,
      render: (member) => (
        <div>
          <div className="font-medium text-foreground">
            {member.display_name ?? t('system.phone_app.members.unnamed_member', { id: member.user_id })}
          </div>
          {member.username ? <div className="text-xs text-muted">@{member.username}</div> : null}
        </div>
      ),
    },
    {
      key: 'community',
      label: t('system.phone_app.all.columns.community'),
      render: (member) => member.tenant_name ?? t('system.phone_app.all.unnamed_community', { id: member.tenant_id }),
    },
    {
      key: 'phone',
      label: t('system.phone_app.members.columns.phone'),
      render: (member) => <PhoneChips phones={member.phones ?? []} />,
    },
    {
      key: 'first_seen_at',
      label: t('system.phone_app.members.columns.first_seen'),
      render: (member) => formatAppDate(member.first_seen_at, t('system.phone_app.members.no_date')),
    },
  ], [t]);

  const newestRows = useMemo(
    () => (platform?.recent_members ?? []).map((member) => ({ ...member, row_key: `${member.tenant_id}-${member.user_id}` })),
    [platform],
  );

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <Smartphone size={20} aria-hidden="true" />
          <h3 className="text-lg font-semibold">{t('system.phone_app.summary.title')}</h3>
        </CardHeader>
        <CardBody className="gap-4">
          {failed && !loading ? (
            <p className="text-sm text-danger">{t('system.phone_app.summary.load_failed')}</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatCard
                  label={t('system.phone_app.summary.members_with_app')}
                  value={tenant?.members_with_app ?? 0}
                  description={t('system.phone_app.summary.members_with_app_hint')}
                  icon={Users}
                  color="primary"
                  loading={loading}
                />
                <StatCard
                  label={t('system.phone_app.summary.notifications_on')}
                  value={tenant?.members_notifications_on ?? 0}
                  description={t('system.phone_app.summary.notifications_on_hint')}
                  icon={Bell}
                  color="success"
                  loading={loading}
                />
                <StatCard
                  label={t('system.phone_app.summary.newest')}
                  value={formatAppDate(tenant?.last_joined_at ?? null, t('system.phone_app.summary.newest_none'))}
                  icon={UserPlus}
                  color="secondary"
                  loading={loading}
                />
              </div>

              {tenant ? (
                <div className="rounded-lg border border-divider p-3">
                  <p className="text-sm font-medium text-foreground">{t('system.phone_app.summary.phone_types')}</p>
                  <p className="mt-1 text-sm text-foreground">
                    {t('system.phone_app.summary.phone_types_value', {
                      android: number(tenant.devices_by_platform?.android ?? 0),
                      ios: number(tenant.devices_by_platform?.ios ?? 0),
                    })}
                  </p>
                  <p className="mt-1 text-xs text-muted">{t('system.phone_app.summary.phone_types_hint')}</p>
                </div>
              ) : null}

              <div className="flex items-start gap-2 text-sm text-muted">
                <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <p>{t('system.phone_app.summary.not_downloads')}</p>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <NativeAppMembersTable />

      {platform ? (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Globe size={20} aria-hidden="true" />
              <h3 className="text-lg font-semibold">{t('system.phone_app.all.title')}</h3>
            </div>
            <Chip size="sm" variant="soft" color="warning">
              {t('system.phone_app.all.owners_only')}
            </Chip>
          </CardHeader>
          <CardBody className="gap-4">
            <p className="text-sm text-muted">{t('system.phone_app.all.description')}</p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard
                label={t('system.phone_app.all.members_with_app')}
                value={platform.members_with_app}
                icon={Users}
                color="primary"
              />
              <StatCard
                label={t('system.phone_app.all.phones')}
                value={platform.native_devices}
                description={t('system.phone_app.summary.phone_types_value', {
                  android: number(platform.devices_by_platform?.android ?? 0),
                  ios: number(platform.devices_by_platform?.ios ?? 0),
                })}
                icon={Bell}
                color="success"
              />
              <StatCard
                label={t('system.phone_app.all.communities')}
                value={platform.tenants_with_app}
                icon={Building2}
                color="secondary"
              />
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold text-foreground">{t('system.phone_app.all.by_community')}</h4>
              <DataTable
                columns={communityColumns}
                data={platform.by_tenant}
                keyField="tenant_id"
                searchable={false}
                emptyContent={t('system.phone_app.all.empty')}
                mobileCards
              />
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold text-foreground">{t('system.phone_app.all.newest_title')}</h4>
              <DataTable
                columns={newestColumns}
                data={newestRows}
                keyField="row_key"
                searchable={false}
                emptyContent={t('system.phone_app.all.empty')}
                mobileCards
              />
            </div>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}

export default NativeAppInstallStats;
