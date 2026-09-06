// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Native App Install Statistics
 *
 * Restores the device/member numbers the decommissioned legacy admin panel
 * showed and the React rewrite dropped.
 *
 * Two tiers, mirroring the API:
 *  - every tenant admin sees their own community;
 *  - a god-mode operator additionally sees a cross-tenant block.
 *
 * 🔴 These are push registrations, NOT Google Play / App Store installs, and
 * the UI must keep saying so. A member who installs the app and declines the
 * notification prompt never appears here. Store install counts exist only in
 * Play Console.
 */

import { Card, CardBody, CardHeader, Chip, Spinner, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import { useEffect, useState } from 'react';

import Globe from 'lucide-react/icons/globe';
import Info from 'lucide-react/icons/info';
import Smartphone from 'lucide-react/icons/smartphone';
import Users from 'lucide-react/icons/users';
import { useTranslation } from 'react-i18next';
import { adminSettings } from '../../api/adminApi';

export interface NativeAppRecentDevice {
  user_id: number;
  display_name: string | null;
  username: string | null;
  email?: string | null;
  tenant_id?: number;
  tenant_name?: string | null;
  platform: string;
  registered_at: string | null;
  last_seen_at: string | null;
}

export interface NativeAppTenantStats {
  tenant_id: number;
  native_devices: number;
  native_users: number;
  web_subscriptions: number;
  web_users: number;
  push_enabled_users: number;
  devices_by_platform: Record<string, number>;
  first_registered_at: string | null;
  last_registered_at: string | null;
  recent_devices: NativeAppRecentDevice[];
}

export interface NativeAppTenantBreakdown {
  tenant_id: number;
  tenant_name: string | null;
  tenant_slug: string | null;
  native_devices: number;
  native_users: number;
  last_registered_at: string | null;
}

export interface NativeAppPlatformStats extends Omit<NativeAppTenantStats, 'tenant_id'> {
  tenants_with_installs: number;
  by_tenant: NativeAppTenantBreakdown[];
}

export interface NativeAppInstallStatsResponse {
  tenant_id: number;
  is_god: boolean;
  scope: 'tenant' | 'platform';
  tenant: NativeAppTenantStats;
  platform: NativeAppPlatformStats | null;
}

function StatTile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-divider p-3">
      <p className="text-2xl font-semibold text-theme-primary">{value.toLocaleString()}</p>
      <p className="text-sm font-medium text-theme-primary">{label}</p>
      {hint ? <p className="mt-1 text-xs text-theme-secondary">{hint}</p> : null}
    </div>
  );
}

export function NativeAppInstallStats() {
  const { t, i18n } = useTranslation('admin_system');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [stats, setStats] = useState<NativeAppInstallStatsResponse | null>(null);

  useEffect(() => {
    let active = true;

    adminSettings.getNativeAppInstallStats()
      .then((res) => {
        if (!active) return;
        setStats((res.data ?? null) as NativeAppInstallStatsResponse | null);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, []);

  // Locale-aware: a bare toLocaleDateString() with no locale silently renders
  // in the browser's language rather than the one the admin chose.
  const formatDate = (value: string | null): string => {
    if (!value) return t('system.native_app.installs.never');
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return t('system.native_app.installs.never');
    return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(parsed);
  };

  const memberLabel = (device: NativeAppRecentDevice): string =>
    device.display_name
      ?? (device.username ? `@${device.username}` : t('system.native_app.installs.unnamed_member', { id: device.user_id }));

  if (loading) {
    return (
      <Card>
        <CardBody>
          <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex h-32 items-center justify-center">
            <Spinner size="lg" />
          </div>
        </CardBody>
      </Card>
    );
  }

  if (failed || !stats) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-danger">{t('system.native_app.installs.load_failed')}</p>
        </CardBody>
      </Card>
    );
  }

  const { tenant, platform } = stats;

  return (
    <>
      <Card>
        <CardHeader className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Smartphone size={20} />
            <h3 className="text-lg font-semibold">{t('system.native_app.installs.title')}</h3>
          </div>
          <Chip size="sm" variant="soft" color="default">
            {t('system.native_app.installs.scope_this_community')}
          </Chip>
        </CardHeader>
        <CardBody className="gap-4">
          <div className="flex items-start gap-2 rounded-lg border border-divider bg-content2 p-3">
            <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-sm text-theme-secondary">{t('system.native_app.installs.not_store_installs')}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label={t('system.native_app.installs.phones_registered')}
              value={tenant.native_devices}
              hint={t('system.native_app.installs.platform_split', {
                android: tenant.devices_by_platform?.android ?? 0,
                ios: tenant.devices_by_platform?.ios ?? 0,
              })}
            />
            <StatTile
              label={t('system.native_app.installs.people_with_app')}
              value={tenant.native_users}
            />
            <StatTile
              label={t('system.native_app.installs.browser_subscriptions')}
              value={tenant.web_subscriptions}
            />
            <StatTile
              label={t('system.native_app.installs.reachable_by_push')}
              value={tenant.push_enabled_users}
              hint={t('system.native_app.installs.reachable_by_push_hint')}
            />
          </div>

          <p className="text-xs text-theme-secondary">
            {t('system.native_app.installs.first_last', {
              first: formatDate(tenant.first_registered_at),
              last: formatDate(tenant.last_registered_at),
            })}
          </p>

          <Table aria-label={t('system.native_app.installs.recent_table_label')} removeWrapper>
            <TableHeader>
              <TableColumn>{t('system.native_app.installs.columns.member')}</TableColumn>
              <TableColumn>{t('system.native_app.installs.columns.platform')}</TableColumn>
              <TableColumn>{t('system.native_app.installs.columns.registered')}</TableColumn>
              <TableColumn>{t('system.native_app.installs.columns.last_seen')}</TableColumn>
            </TableHeader>
            <TableBody emptyContent={t('system.native_app.installs.empty')}>
              {tenant.recent_devices.map((device, index) => (
                <TableRow key={`${device.user_id}-${device.registered_at ?? index}`}>
                  <TableCell>
                    <div className="font-medium text-theme-primary">{memberLabel(device)}</div>
                    {device.email ? <div className="text-xs text-theme-secondary">{device.email}</div> : null}
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" variant="soft" color={device.platform === 'ios' ? 'secondary' : 'success'}>
                      {device.platform}
                    </Chip>
                  </TableCell>
                  <TableCell>{formatDate(device.registered_at)}</TableCell>
                  <TableCell>{formatDate(device.last_seen_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      {platform ? (
        <Card>
          <CardHeader className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Globe size={20} />
              <h3 className="text-lg font-semibold">{t('system.native_app.installs.platform_title')}</h3>
            </div>
            <Chip size="sm" variant="soft" color="warning">
              {t('system.native_app.installs.god_only')}
            </Chip>
          </CardHeader>
          <CardBody className="gap-4">
            <p className="text-sm text-theme-secondary">{t('system.native_app.installs.platform_description')}</p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label={t('system.native_app.installs.phones_registered_all')}
                value={platform.native_devices}
                hint={t('system.native_app.installs.platform_split', {
                  android: platform.devices_by_platform?.android ?? 0,
                  ios: platform.devices_by_platform?.ios ?? 0,
                })}
              />
              <StatTile label={t('system.native_app.installs.people_with_app_all')} value={platform.native_users} />
              <StatTile label={t('system.native_app.installs.communities_with_installs')} value={platform.tenants_with_installs} />
              <StatTile label={t('system.native_app.installs.reachable_by_push_all')} value={platform.push_enabled_users} />
            </div>

            <div>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-theme-primary">
                <Users size={16} aria-hidden="true" />
                {t('system.native_app.installs.by_community')}
              </h4>
              <Table aria-label={t('system.native_app.installs.by_community_table_label')} removeWrapper>
                <TableHeader>
                  <TableColumn>{t('system.native_app.installs.columns.community')}</TableColumn>
                  <TableColumn>{t('system.native_app.installs.columns.phones')}</TableColumn>
                  <TableColumn>{t('system.native_app.installs.columns.people')}</TableColumn>
                  <TableColumn>{t('system.native_app.installs.columns.latest_install')}</TableColumn>
                </TableHeader>
                <TableBody emptyContent={t('system.native_app.installs.empty')}>
                  {platform.by_tenant.map((row) => (
                    <TableRow key={row.tenant_id}>
                      <TableCell>
                        <div className="font-medium text-theme-primary">
                          {row.tenant_name ?? t('system.native_app.installs.unnamed_community', { id: row.tenant_id })}
                        </div>
                        {row.tenant_slug ? <div className="text-xs text-theme-secondary">{row.tenant_slug}</div> : null}
                      </TableCell>
                      <TableCell>{row.native_devices.toLocaleString()}</TableCell>
                      <TableCell>{row.native_users.toLocaleString()}</TableCell>
                      <TableCell>{formatDate(row.last_registered_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold text-theme-primary">
                {t('system.native_app.installs.recent_all_communities')}
              </h4>
              <Table aria-label={t('system.native_app.installs.recent_all_table_label')} removeWrapper>
                <TableHeader>
                  <TableColumn>{t('system.native_app.installs.columns.member')}</TableColumn>
                  <TableColumn>{t('system.native_app.installs.columns.community')}</TableColumn>
                  <TableColumn>{t('system.native_app.installs.columns.platform')}</TableColumn>
                  <TableColumn>{t('system.native_app.installs.columns.registered')}</TableColumn>
                </TableHeader>
                <TableBody emptyContent={t('system.native_app.installs.empty')}>
                  {platform.recent_devices.map((device, index) => (
                    <TableRow key={`${device.tenant_id}-${device.user_id}-${device.registered_at ?? index}`}>
                      <TableCell>
                        <div className="font-medium text-theme-primary">{memberLabel(device)}</div>
                        {device.username ? <div className="text-xs text-theme-secondary">@{device.username}</div> : null}
                      </TableCell>
                      <TableCell>
                        {device.tenant_name ?? t('system.native_app.installs.unnamed_community', { id: device.tenant_id ?? 0 })}
                      </TableCell>
                      <TableCell>
                        <Chip size="sm" variant="soft" color={device.platform === 'ios' ? 'secondary' : 'success'}>
                          {device.platform}
                        </Chip>
                      </TableCell>
                      <TableCell>{formatDate(device.registered_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}

export default NativeAppInstallStats;
