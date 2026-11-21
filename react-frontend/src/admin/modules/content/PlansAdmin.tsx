// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Plans Admin
 * Super-admin CRUD for subscription plans and pricing tiers.
 * Shows Stripe sync status, tenant count, and one-click Stripe sync.
 */

import { useState, useEffect, useCallback } from 'react';

import CreditCard from 'lucide-react/icons/credit-card';
import Plus from 'lucide-react/icons/plus';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import AlertCircle from 'lucide-react/icons/circle-alert';
import Users from 'lucide-react/icons/users';
import { useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast, useAuth } from '@/contexts';
import { adminPlans, type PlanListItem } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useTranslation } from 'react-i18next';
import { Button, Chip, Spinner, Tooltip } from '@/components/ui';
import { formatCurrency, formatNumber } from '@/lib/helpers';

const TIER_COLORS: Record<number, 'default' | 'primary' | 'secondary' | 'success' | 'warning'> = {
  0: 'default',
  1: 'primary',
  2: 'secondary',
  3: 'warning',
};

export function PlansAdmin() {
  const { t } = useTranslation('admin_content');
  usePageTitle(t('content.plans_admin_title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const userRecord = user as Record<string, unknown> | null;
  const isSuperAdmin =
    (user?.role as string) === 'super_admin' ||
    userRecord?.is_super_admin === true ||
    userRecord?.is_tenant_super_admin === true;

  const [data, setData] = useState<PlanListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<PlanListItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminPlans.list();
      if (res.success && res.data) {
        const result = res.data as unknown;
        setData(Array.isArray(result) ? result as PlanListItem[] : []);
      }
    } catch {
      toast.error(t('content.failed_to_load_plans'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);


  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setActionLoading(true);
    try {
      const res = await adminPlans.delete(confirmDelete.id);
      if (res?.success) {
        toast.success(t('content.plan_deleted_successfully'));
        fetchData();
      } else {
        toast.error(t('content.failed_to_delete_plan'));
      }
    } catch {
      toast.error(t('content.an_unexpected_error_occurred'));
    } finally {
      setActionLoading(false);
      setConfirmDelete(null);
    }
  };

  const handleSyncStripe = async (plan: PlanListItem) => {
    setSyncingId(plan.id);
    try {
      const res = await adminPlans.syncStripe(plan.id);
      if (res.success) {
        toast.success(t('content.plan_synced_to_stripe', { name: plan.name }));
        fetchData();
      } else {
        toast.error(t('content.stripe_sync_failed'));
      }
    } catch {
      toast.error(t('content.stripe_sync_failed_config'));
    } finally {
      setSyncingId(null);
    }
  };

  // Decimals arrive as strings ("49.00"), so 0 must be checked after conversion.
  const formatPrice = (price: number | string | null | undefined, currency: 'EUR' | 'GBP' = 'EUR') => {
    const amount = Number(price ?? 0);
    if (!amount) return t('content.free');
    return formatCurrency(amount, currency);
  };

  const columns: Column<PlanListItem>[] = [
    {
      key: 'name',
      label: t('content.label_name'),
      sortable: true,
      render: (item) => (
        <div className="flex flex-col gap-0.5">
          {isSuperAdmin ? (
            <Button
              type="button"
              variant="tertiary"
              onPress={() => navigate(tenantPath(`/platform-team/plans/edit/${item.id}`))}
              className="text-left font-semibold text-accent hover:underline min-w-0 min-h-10 p-0 justify-start"
            >
              {item.name}
            </Button>
          ) : (
            <span className="font-semibold">{item.name}</span>
          )}
          {item.description && (
            <span className="text-xs text-muted line-clamp-1">{item.description}</span>
          )}
        </div>
      ),
    },
    {
      key: 'tier_level',
      label: t('content.tier'),
      sortable: true,
      render: (item) => (
        <Chip
          size="sm"
          variant="soft"
          color={TIER_COLORS[item.tier_level] ?? 'default'}
        >
          {item.tier_level === 0 ? t('content.free') : t('content.tier_level_badge', { level: item.tier_level })}
        </Chip>
      ),
    },
    {
      key: 'price_monthly',
      label: t('content.monthly_price'),
      sortable: true,
      render: (item) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{formatPrice(item.price_monthly)}</span>
          {item.price_monthly_gbp != null ? (
            <span className="text-sm font-medium">{formatPrice(item.price_monthly_gbp, 'GBP')}</span>
          ) : (
            <span className="text-xs text-muted">{t('content.plan_no_gbp_price')}</span>
          )}
          <span className="text-xs text-muted">{t('content.yearly_price_suffix', { price: formatPrice(item.price_yearly) })}</span>
        </div>
      ),
    },
    {
      key: 'max_users',
      label: t('content.max_users'),
      sortable: true,
      render: (item) => (
        <span className="text-sm">
          {item.max_users != null ? formatNumber(item.max_users) : t('content.plan_unlimited')}
        </span>
      ),
    },
    {
      key: 'tenant_count',
      label: (
        <span className="flex items-center gap-1"><Users size={13} /> {t('content.tenants')}</span>
      ) as unknown as string,
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">{item.tenant_count}</span>
      ),
    },
    {
      key: 'stripe_synced',
      label: t('content.stripe'),
      render: (item) => (
        <Tooltip
          content={
            item.stripe_synced
              ? t('content.stripe_product', { id: item.stripe_product_id })
              : t('content.not_synced_to_stripe')
          }
        >
          <span className="flex items-center gap-1 text-sm">
            {item.stripe_synced ? (
              <CheckCircle size={15} className="text-success" />
            ) : (
              <AlertCircle size={15} className="text-warning" />
            )}
            <span className={item.stripe_synced ? 'text-success' : 'text-warning'}>
              {item.stripe_synced ? t('content.synced') : t('content.unsynced')}
            </span>
          </span>
        </Tooltip>
      ),
    },
    {
      key: 'is_active',
      label: t('content.label_status'),
      render: (item) => (
        <Chip size="sm" variant="soft" color={item.is_active ? 'success' : 'default'}>
          {item.is_active ? t('content.label_active') : t('content.label_inactive')}
        </Chip>
      ),
    },
    ...(isSuperAdmin ? [{
      key: 'actions',
      label: t('listings.actions'),
      render: (item: PlanListItem) => (
        <div className="flex gap-1">
          <Tooltip content={t('content.edit_plan')}>
            <Button
              isIconOnly size="sm" variant="tertiary"
              onPress={() => navigate(tenantPath(`/platform-team/plans/edit/${item.id}`))}
              aria-label={t('content.label_edit_plan')}
            >
              <Pencil size={14} />
            </Button>
          </Tooltip>
          <Tooltip content={t('content.sync_to_stripe')}>
            <Button
              isIconOnly size="sm" variant="tertiary"
              onPress={() => handleSyncStripe(item)}
              isLoading={syncingId === item.id}
              aria-label={t('content.sync_to_stripe')}
            >
              <RefreshCw size={14} />
            </Button>
          </Tooltip>
          <Tooltip content={item.tenant_count > 0 ? t('content.active_tenants_cannot_delete', { count: item.tenant_count }) : t('content.delete_plan')}>
            <Button
              isIconOnly size="sm" variant="danger"
              onPress={() => setConfirmDelete(item)}
              isDisabled={item.tenant_count > 0}
              aria-label={t('content.label_delete_plan')}
            >
              <Trash2 size={14} />
            </Button>
          </Tooltip>
        </div>
      ),
    }] : []),
  ];

  if (loading) {
    return (
      <div>
        <PageHeader title={t('content.plans_admin_title')} description={t('content.plans_admin_desc')} />
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-12"><Spinner size="lg" /></div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('content.plans_admin_title')}
        description={t('content.plans_admin_desc')}
        actions={
          isSuperAdmin ? (
            <Button
              startContent={<Plus size={16} />}
              onPress={() => navigate(tenantPath('/platform-team/plans/create'))}
            >
              {t('breadcrumbs.create')} {t('content.plan')}
            </Button>
          ) : undefined
        }
      />

      {data.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title={t('content.no_plans')}
          description={t('content.desc_create_subscription_plans_to_offer_diffe')}
          {...(isSuperAdmin ? {
            actionLabel: `${t('breadcrumbs.create')} ${t('content.plan')}`,
            onAction: () => navigate(tenantPath('/platform-team/plans/create')),
          } : {})}
        />
      ) : (
        // Wider than a laptop screen: the buttons stay pinned in view while
        // the rest scrolls, and a phone gets one card per plan.
        <DataTable
          columns={columns}
          data={data}
          searchPlaceholder={t('content.search_plans')}
          onRefresh={fetchData}
          stickyActions
          mobileCards
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          isOpen={!!confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={handleDelete}
          title={`${t('common.delete')} ${t('content.plan')}`}
          message={t('content.confirm_delete_plan_named', { name: confirmDelete.name })}
          confirmLabel={t('common.delete')}
          confirmColor="danger"
          isLoading={actionLoading}
        />
      )}
    </div>
  );
}

export default PlansAdmin;
