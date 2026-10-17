// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Marketplace Seller Management
 * View, filter, verify, and suspend marketplace seller profiles.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback } from 'react';

import Store from 'lucide-react/icons/store';
import ShieldCheck from 'lucide-react/icons/shield-check';
import UserX from 'lucide-react/icons/user-x';
import Eye from 'lucide-react/icons/eye';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import BadgeCheck from 'lucide-react/icons/badge-check';
import Star from 'lucide-react/icons/star';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { PageHeader } from '../../components/PageHeader';
import { DataTable, type Column } from '../../components/DataTable';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import { Button, Chip, Tabs, Tab, Tooltip } from '@/components/ui';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Seller {
  id: number;
  user_id: number;
  display_name: string;
  seller_type: 'private' | 'business';
  business_name: string | null;
  business_verified: boolean;
  is_community_endorsed: boolean;
  active_listings: number;
  total_sales: number;
  avg_rating: number;
  total_ratings: number;
  joined_marketplace_at: string | null;
  user: { id: number; name: string; email: string; avatar_url: string | null } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SELLER_FILTER_TABS = ['all', 'private', 'business', 'verified', 'unverified'] as const;

const typeColors: Record<string, 'primary' | 'secondary' | 'default'> = {
  private: 'default',
  business: 'primary',
};

function renderRating(rating: number) {
  const num = Number(rating);
  if (!num || num === 0) {
    return <span className="text-sm text-muted">--</span>;
  }
  return (
    <div className="flex items-center gap-1">
      <Star size={14} className="text-warning fill-warning" />
      <span className="text-sm text-muted">{num.toFixed(1)}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function MarketplaceSellerAdmin() {
  const { t } = useTranslation('admin_marketplace');
  usePageTitle(t('marketplace.sellers_page_title'));
  const toast = useToast();
  const { tenantPath } = useTenant();

  const [sellers, setSellers] = useState<Seller[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Action states
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmVerify, setConfirmVerify] = useState<Seller | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState<Seller | null>(null);

  const loadSellers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: '20' });
      if (search) params.set('search', search);
      if (filter !== 'all') {
        // Map UI filter tabs to API parameters
        if (filter === 'private' || filter === 'business') {
          params.set('seller_type', filter);
        } else if (filter === 'verified') {
          params.set('verified', '1');
        } else if (filter === 'unverified') {
          params.set('verified', '0');
        }
      }

      const res = await api.get<Seller[]>(
        `/v2/admin/marketplace/sellers?${params.toString()}`
      );

      if (res.success && res.data) {
        const data = res.data as unknown;
        if (Array.isArray(data)) {
          setSellers(data);
          const metaTotal = (res.meta as Record<string, unknown> | undefined)?.total;
          setTotal(typeof metaTotal === 'number' ? metaTotal : data.length);
        } else if (data && typeof data === 'object') {
          const pd = data as { data: Seller[]; meta?: { total: number } };
          setSellers(pd.data || []);
          setTotal(pd.meta?.total || 0);
        }
      }
    } catch {
      toast.error(t('marketplace.failed_load_sellers'));
    } finally {
      setLoading(false);
    }
  }, [page, filter, search, t, toast])


  useEffect(() => {
    loadSellers();
  }, [loadSellers]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const handleVerify = async () => {
    if (!confirmVerify) return;
    setActionLoading(true);
    try {
      const res = await api.post(`/v2/admin/marketplace/sellers/${confirmVerify.id}/verify`);
      if (res?.success) {
        toast.success(t('marketplace.seller_verified'));
        loadSellers();
      } else {
        toast.error(t('marketplace.failed_verify_seller'));
      }
    } catch {
      toast.error(t('marketplace.unexpected_error'));
    } finally {
      setActionLoading(false);
      setConfirmVerify(null);
    }
  };

  const handleSuspend = async () => {
    if (!confirmSuspend) return;
    setActionLoading(true);
    try {
      const res = await api.post(`/v2/admin/marketplace/sellers/${confirmSuspend.id}/suspend`);
      if (res?.success) {
        toast.success(t('marketplace.seller_suspended'));
        loadSellers();
      } else {
        toast.error(t('marketplace.failed_suspend_seller'));
      }
    } catch {
      toast.error(t('marketplace.unexpected_error'));
    } finally {
      setActionLoading(false);
      setConfirmSuspend(null);
    }
  };

  // ─── Table columns ─────────────────────────────────────────────────────────

  const columns: Column<Seller>[] = [
    {
      key: 'display_name',
      label: t('marketplace.col_seller_name'),
      sortable: true,
      render: (item) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{item.display_name}</span>
          {item.business_verified && (
            <Tooltip content={t('marketplace.verified_seller')}>
              <BadgeCheck size={16} className="text-success shrink-0" />
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      key: 'seller_type',
      label: t('marketplace.col_type'),
      sortable: true,
      render: (item) => (
        <Chip
          size="sm"
          variant="soft"
          color={typeColors[item.seller_type] || 'default'}
        >
          {t(`marketplace.seller_type.${item.seller_type}`, {
            defaultValue: t('marketplace.seller_type.unknown'),
          })}
        </Chip>
      ),
    },
    {
      key: 'active_listings',
      label: t('marketplace.col_active_listings'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">{item.active_listings}</span>
      ),
    },
    {
      key: 'total_sales',
      label: t('marketplace.col_sales'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">{item.total_sales}</span>
      ),
    },
    {
      key: 'avg_rating',
      label: t('marketplace.col_rating'),
      sortable: true,
      render: (item) => renderRating(item.avg_rating),
    },
    {
      key: 'joined_marketplace_at',
      label: t('marketplace.col_joined'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {item.joined_marketplace_at
            ? new Date(item.joined_marketplace_at).toLocaleDateString(getFormattingLocale())
            : '--'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('marketplace.col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          {item.seller_type === 'business' && !item.business_verified && (
            <Tooltip content={t('marketplace.verify_business')}>
              <Button
                isIconOnly
                size="sm"
                variant="tertiary"
                color="success"
                onPress={() => setConfirmVerify(item)}
                isDisabled={actionLoading}
                aria-label={t('marketplace.action_verify_seller')}
              >
                <ShieldCheck size={14} />
              </Button>
            </Tooltip>
          )}
          <Tooltip content={t('marketplace.action_suspend_seller')}>
            <Button
              isIconOnly
              size="sm"
              variant="danger"
              onPress={() => setConfirmSuspend(item)}
              isDisabled={actionLoading}
              aria-label={t('marketplace.action_suspend_seller')}
            >
              <UserX size={14} />
            </Button>
          </Tooltip>
          <Tooltip content={t('marketplace.action_view_seller_profile')}>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              as="a"
              href={tenantPath(`/profile/${item.user_id}`)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('marketplace.action_view_seller_profile')}
            >
              <Eye size={14} />
            </Button>
          </Tooltip>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('marketplace.sellers_title')}
        description={t('marketplace.sellers_description')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw size={16} />}
            onPress={loadSellers}
          >
            {t('marketplace.refresh')}
          </Button>
        }
      />

      {/* Filter tabs */}
      <div className="mb-4">
        <Tabs
          aria-label={t('marketplace.seller_tabs_aria')}
          selectedKey={filter}
          onSelectionChange={(key) => {
            setFilter(key as string);
            setPage(1);
          }}
          variant="underlined"
          size="sm"
        >
          {SELLER_FILTER_TABS.map((tab) => (
            <Tab key={tab} title={<span className="capitalize">{t(`marketplace.seller_filter_${tab}`)}</span>} />
          ))}
        </Tabs>
      </div>

      {/* Data table */}
      <DataTable
        columns={columns}
        data={sellers}
        isLoading={loading}
        searchPlaceholder={t('marketplace.search_sellers')}
        onSearch={(q) => {
          setSearch(q);
          setPage(1);
        }}
        onRefresh={loadSellers}
        totalItems={total}
        page={page}
        pageSize={20}
        onPageChange={setPage}
        emptyContent={
          <EmptyState
            icon={Store}
            title={t('marketplace.no_sellers_found')}
            description={
              search || filter !== 'all'
                ? t('marketplace.try_adjusting_filters')
                : t('marketplace.no_sellers_registered_yet')
            }
          />
        }
      />

      {/* Verify confirmation */}
      {confirmVerify && (
        <ConfirmModal
          isOpen={!!confirmVerify}
          onClose={() => setConfirmVerify(null)}
          onConfirm={handleVerify}
          title={t('marketplace.verify_seller_title')}
          message={t('marketplace.verify_seller_message')}
          confirmLabel={t('marketplace.verify_btn')}
          cancelLabel={t('marketplace.cancel')}
          confirmColor="primary"
          isLoading={actionLoading}
        />
      )}

      {/* Suspend confirmation */}
      {confirmSuspend && (
        <ConfirmModal
          isOpen={!!confirmSuspend}
          onClose={() => setConfirmSuspend(null)}
          onConfirm={handleSuspend}
          title={t('marketplace.suspend_seller_title')}
          message={t('marketplace.suspend_seller_message')}
          confirmLabel={t('marketplace.suspend_btn')}
          cancelLabel={t('marketplace.cancel')}
          confirmColor="danger"
          isLoading={actionLoading}
        />
      )}
    </div>
  );
}

export default MarketplaceSellerAdmin;
