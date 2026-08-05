import { CardBody, Card, Button, Chip, Spinner } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Super Admin Dashboard
 * Platform-wide overview with tenant stats, tenant cards, and quick actions.
 */

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Building2 from 'lucide-react/icons/building-2';
import Users from 'lucide-react/icons/users';
import Shield from 'lucide-react/icons/shield';
import Globe from 'lucide-react/icons/globe';
import Plus from 'lucide-react/icons/plus';
import ArrowRight from 'lucide-react/icons/arrow-right';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Network from 'lucide-react/icons/network';
import Activity from 'lucide-react/icons/activity';
import ListChecks from 'lucide-react/icons/list-checks';
import { usePageTitle } from '@/hooks';
import { useAuth, useTenant, useToast } from '@/contexts';
import { superPanelLevel } from '@/lib/access';
import { adminSuper } from '../../api/adminApi';
import { StatCard } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';
import type { SuperAdminDashboardStats, SuperAdminTenant } from '../../api/types';

export function SuperDashboard() {
  const { t } = useTranslation('admin_super');
  usePageTitle(t('super.page_title'));
  const { tenantPath } = useTenant();
  const { user } = useAuth();
  const toast = useToast();

  const [stats, setStats] = useState<SuperAdminDashboardStats | null>(null);
  const [tenants, setTenants] = useState<SuperAdminTenant[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, tenantsRes] = await Promise.all([
        adminSuper.getDashboard(),
        adminSuper.listTenants(),
      ]);

      if (dashRes.success && dashRes.data) {
        setStats(dashRes.data);
      } else if (!dashRes.success) {
        toast.error(`${t('super.dashboard')}: ${t('super.failed_to_load_stats')}`);
      }

      if (tenantsRes.success && tenantsRes.data) {
        setTenants(Array.isArray(tenantsRes.data) ? tenantsRes.data : []);
      } else if (!tenantsRes.success) {
        toast.error(`${t('super.tenants')}: ${t('super.failed_to_load_tenant_list')}`);
      }
    } catch {
      toast.error(`${t('super.dashboard_error')}: ${t('common.unknown')}`);
    } finally {
      setLoading(false);
    }
  }, [t, toast])


  useEffect(() => {
    loadData();
  }, [loadData]);

  /*
   * `master` sees the whole installation; `regional` sees its own community and
   * the communities beneath it, and nothing else — the API enforces that, so the
   * page must not describe itself as platform-wide to them. Calling a branch view
   * "platform-wide" is how somebody concludes they are seeing everyone's data.
   */
  const isPlatformLevel = superPanelLevel(user) === 'master';

  /*
   * 🔴 Federation Controls is TIER B — platform-only. Its endpoints
   * (`/admin/super/federation/*`) sit behind `EnsureIsSuperAdmin` and answer 403
   * to the super-admin of a branch, verified by hand on 2026-08-05. Offering the
   * card to a `regional` user is a control the API will refuse, which is the one
   * thing this panel must never do. Every other action here is tier A and is
   * subtree-scoped server-side, so it is safe for both levels.
   */
  const quickActions = [
    { label: t('super.create_tenant'), href: tenantPath('/super-admin/tenants/create'), icon: Plus },
    { label: t('super.view_hierarchy'), href: tenantPath('/super-admin/tenants/hierarchy'), icon: Network },
    { label: t('super.bulk_operations'), href: tenantPath('/super-admin/bulk'), icon: ListChecks },
    { label: t('super.cross_tenant_users'), href: tenantPath('/super-admin/users'), icon: Users },
    { label: t('super.audit_log'), href: tenantPath('/super-admin/audit'), icon: Activity },
    ...(isPlatformLevel
      ? [{ label: t('super.federation_controls'), href: tenantPath('/super-admin/federation'), icon: Globe }]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title={t('super.super_dashboard_title')}
        description={isPlatformLevel
          ? t('super.super_dashboard_desc')
          : t('super.super_dashboard_desc_branch')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw aria-hidden="true" size={16} />}
            onPress={loadData}
            isLoading={loading}
            size="sm"
          >
            {t('common.refresh')}
          </Button>
        }
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Link to={tenantPath('/super-admin/tenants')} className="block cursor-pointer hover:scale-[1.02] transition-transform">
          <StatCard
            label={t('super.label_total_tenants')}
            value={stats?.total_tenants ?? '---'}
            icon={Building2}
            loading={loading}
          />
        </Link>
        <Link to={tenantPath('/super-admin/tenants')} className="block cursor-pointer hover:scale-[1.02] transition-transform">
          <StatCard
            label={t('super.label_active_tenants')}
            value={stats?.active_tenants ?? '---'}
            icon={Shield}
            color="success"
            loading={loading}
          />
        </Link>
        <Link to={tenantPath('/super-admin/users')} className="block cursor-pointer hover:scale-[1.02] transition-transform">
          <StatCard
            label={t('super.label_total_users')}
            value={stats?.total_users ?? '---'}
            icon={Users}
            loading={loading}
          />
        </Link>
        <Link to={tenantPath('/super-admin/tenants')} className="block cursor-pointer hover:scale-[1.02] transition-transform">
          <StatCard
            label={t('super.label_total_listings')}
            value={stats?.total_listings ?? '---'}
            icon={Globe}
            color="warning"
            loading={loading}
          />
        </Link>
      </div>

      {/* Quick Actions */}
      <Card  className="mb-6">
        <CardBody className="p-4">
          <h3 className="text-lg font-semibold text-foreground mb-4">{t('super.quick_actions')}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {quickActions.map((action) => (
              <Button
                key={action.href}
                as={Link}
                to={action.href}
                variant="secondary"
                className="min-h-11 justify-between px-4 py-3"
                endContent={<ArrowRight aria-hidden="true" size={16} />}
                startContent={<action.icon aria-hidden="true" size={18} />}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Tenant Cards */}
      <h3 className="text-lg font-semibold text-foreground mb-4">{t('super.tenants')}</h3>
      {loading ? (
        <div className="flex justify-center py-12">
          <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" /></div>
        </div>
      ) : tenants.length === 0 ? (
        <Card >
          <CardBody className="flex flex-col items-center py-12 text-muted">
            <Building2 aria-hidden="true" size={40} className="mb-2" />
            <p>{t('super.no_tenants_found')}</p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tenants.map((tenant) => (
            <Card
              key={tenant.id}

              isPressable
              as={Link}
              to={tenantPath(`/super-admin/tenants/${tenant.id}`)}
            >
              <CardBody className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground truncate">{tenant.name}</p>
                    <p className="text-xs text-muted truncate">{tenant.domain || tenant.slug}</p>
                  </div>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={tenant.is_active ? 'success' : 'default'}
                  >
                    {tenant.is_active ? t('common.active') : t('super.inactive_label')}
                  </Chip>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted">
                  <span className="flex items-center gap-1">
                    <Users aria-hidden="true" size={14} />
                    {t('super.users_count', { count: tenant.user_count ?? 0 })}
                  </span>
                  {tenant.allows_subtenants && (
                    <Chip size="sm" variant="soft">{t('super.hub')}</Chip>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* View All Tenants link */}
      {tenants.length > 0 && (
        <div className="mt-4 flex justify-center">
          <Button
            as={Link}
            to={tenantPath('/super-admin/tenants')}
            variant="tertiary"
            endContent={<ArrowRight aria-hidden="true" size={16} />}
          >
            {t('super.view_all_tenants')}
          </Button>
        </div>
      )}
    </div>
  );
}

export default SuperDashboard;
