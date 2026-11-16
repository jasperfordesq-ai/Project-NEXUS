// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Phone app — every community on the platform: how many members have the app
 * in each, and the newest members to sign in on it.
 *
 * Shown in the Platform team panel (`/platform-team/phone-app`) since 16 Nov
 * 2026. Until then it was a block at the foot of each community admin's own
 * Phone app page, visible to the platform team only; it was lifted out of
 * `NativeAppInstallStats.tsx` unchanged apart from the "platform owners only"
 * chip, which the panel makes redundant.
 *
 * 🔴 It names members of communities the reader does not manage (no email
 * addresses). It must only ever be rendered from the platform team's own
 * request, `GET /v2/platform-team/phone-app`.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import Bell from 'lucide-react/icons/bell';
import Building2 from 'lucide-react/icons/building-2';
import Globe from 'lucide-react/icons/globe';
import Users from 'lucide-react/icons/users';

import { Card, CardBody, CardHeader } from '@/components/ui';
import { getFormattingLocale } from '@/lib/helpers';
import { DataTable, type Column } from '../../components/DataTable';
import { StatCard } from '../../components/StatCard';
import { PhoneChips, formatAppDate, type NativeAppMember } from './NativeAppMembersTable';

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

export interface NativeAppPlatformStats {
  members_with_app: number;
  native_devices: number;
  devices_by_platform: Record<string, number>;
  tenants_with_app: number;
  by_tenant: NativeAppTenantBreakdown[];
  recent_members: NativeAppRecentMember[];
}

export function PhoneAppAllCommunities({ platform }: { platform: NativeAppPlatformStats }) {
  const { t } = useTranslation('admin_system');
  const number = (value: number) => value.toLocaleString(getFormattingLocale());

  // The shared admin table, so the lists turn into cards on a phone instead
  // of running off the side of the screen.
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
    () => (platform.recent_members ?? []).map((member) => ({ ...member, row_key: `${member.tenant_id}-${member.user_id}` })),
    [platform],
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2">
        <Globe size={20} aria-hidden="true" />
        <h2 className="text-lg font-semibold">{t('system.phone_app.all.title')}</h2>
      </CardHeader>
      <CardBody className="gap-4">
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
          <h3 className="mb-2 text-sm font-semibold text-foreground">{t('system.phone_app.all.by_community')}</h3>
          <DataTable
            columns={communityColumns}
            data={platform.by_tenant ?? []}
            keyField="tenant_id"
            searchable={false}
            emptyContent={t('system.phone_app.all.empty')}
            mobileCards
          />
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">{t('system.phone_app.all.newest_title')}</h3>
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
  );
}

export default PhoneAppAllCommunities;
