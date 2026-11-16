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

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Bell from 'lucide-react/icons/bell';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Globe from 'lucide-react/icons/globe';
import Info from 'lucide-react/icons/info';
import Smartphone from 'lucide-react/icons/smartphone';
import UserPlus from 'lucide-react/icons/user-plus';
import Users from 'lucide-react/icons/users';

import { Card, CardBody, CardHeader } from '@/components/ui';
import { useAuth, useTenant } from '@/contexts';
import { isPlatformTeamUser } from '@/lib/access';
import { getFormattingLocale } from '@/lib/helpers';
import { adminSettings } from '../../api/adminApi';
import { StatCard } from '../../components/StatCard';
import { NativeAppMembersTable, formatAppDate } from './NativeAppMembersTable';

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

export interface NativeAppInstallStatsResponse {
  tenant_id: number;
  is_god: boolean;
  scope: 'tenant' | 'platform';
  tenant: NativeAppTenantStats;
  /** Always null since 16 Nov 2026: the all-communities figures are in the Platform team panel. */
  platform: null;
}

export function NativeAppInstallStats() {
  const { t } = useTranslation('admin_system');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [stats, setStats] = useState<NativeAppInstallStatsResponse | null>(null);
  const { user } = useAuth();
  const { tenantPath } = useTenant();

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
  const number = (value: number) => value.toLocaleString(getFormattingLocale());

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

      {/* The all-communities figures moved to the Platform team panel (16 Nov
          2026). One place for them: the platform team gets a way there, and
          nobody else is told the page exists. */}
      {isPlatformTeamUser(user) ? (
        <Link
          to={tenantPath('/platform-team/phone-app')}
          className="inline-flex items-center gap-2 self-start text-sm font-medium text-accent hover:underline"
        >
          <Globe size={16} aria-hidden="true" />
          {t('system.phone_app.all.title')}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      ) : null}
    </>
  );
}

export default NativeAppInstallStats;
