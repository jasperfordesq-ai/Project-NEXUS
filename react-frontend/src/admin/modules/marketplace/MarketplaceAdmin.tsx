// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Card, CardBody, CardHeader, Button, Chip, Spinner, Table, TableHeader, TableBody, TableRow, TableColumn, TableCell } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import ShoppingBag from 'lucide-react/icons/shopping-bag';
import Store from 'lucide-react/icons/store';
import PackageCheck from 'lucide-react/icons/package-check';
import Clock from 'lucide-react/icons/clock';
import DollarSign from 'lucide-react/icons/dollar-sign';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ChevronRight from 'lucide-react/icons/chevron-right';
import Shield from 'lucide-react/icons/shield';
import Users from 'lucide-react/icons/users';
import Gavel from 'lucide-react/icons/gavel';
import { usePageTitle } from '@/hooks';
import { useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { formatMarketplaceCurrency } from '@/lib/marketplaceNumbers';
import { StatCard } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';
import { MarketplaceCategoriesPanel } from './MarketplaceCategoriesPanel';

/**
 * Admin Marketplace & Freecycle Dashboard
 * Overview with key metrics, recent listings, the community's category
 * manager, and quick navigation to the moderation queue and seller
 * management sub-pages.
 */


// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface DashboardStats {
  total_listings: number;
  active_listings: number;
  total_sellers: number;
  pending_moderation: number;
  total_orders: number;
  revenue: number | null;
  currency: string | null;
  revenue_by_currency: Array<{ currency: string; total: number }>;
}

interface RecentListing {
  id: number;
  title: string;
  price: number;
  price_currency: string;
  price_type: string;
  status: string;
  moderation_status: string;
  moderation_notes?: string;
  seller_type: string;
  views_count: number;
  image: string | null;
  category: string | null;
  user: { id: number; name: string } | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status colors
// ─────────────────────────────────────────────────────────────────────────────

const moderationColors: Record<string, 'success' | 'warning' | 'danger' | 'default' | 'primary'> = {
  approved: 'success',
  pending: 'warning',
  rejected: 'danger',
  flagged: 'danger',
  draft: 'default',
};

const statusColors: Record<string, 'success' | 'warning' | 'danger' | 'default' | 'primary'> = {
  active: 'success',
  inactive: 'default',
  sold: 'primary',
  expired: 'warning',
  draft: 'default',
};

/**
 * Price types that carry no amount. Everything else (fixed, negotiable,
 * auction) renders as a currency value.
 */
const PRICE_TYPES_WITHOUT_AMOUNT = new Set(['free', 'lend', 'contact']);

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function MarketplaceAdmin() {
  const { t } = useTranslation('admin_marketplace');
  const { t: tc } = useTranslation('marketplace_cases');
  const { t: tm } = useTranslation('marketplace');
  usePageTitle(t('marketplace.page_title'));
  const toast = useToast();
  const { tenant, tenantPath } = useTenant();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentListings, setRecentListings] = useState<RecentListing[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, listingsRes] = await Promise.all([
        api.get<DashboardStats>('/v2/admin/marketplace/dashboard'),
        api.get<RecentListing[]>('/v2/admin/marketplace/listings?per_page=10'),
      ]);

      if (statsRes.success && statsRes.data) {
        const data = statsRes.data as unknown as DashboardStats;
        setStats(data);
      }

      if (listingsRes.success && listingsRes.data) {
        const data = listingsRes.data as unknown;
        if (Array.isArray(data)) {
          setRecentListings(data);
        } else if (data && typeof data === 'object') {
          const pd = data as { data: RecentListing[] };
          setRecentListings(pd.data || []);
        }
      }
    } catch {
      toast.error(t('marketplace.failed_load_dashboard'));
    } finally {
      setLoading(false);
    }
  }, [toast, t])


  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('marketplace.title')}
        description={t('marketplace.description')}
        actions={
          <Button
            variant="secondary"
            startContent={<RefreshCw size={16} />}
            onPress={loadDashboard}
          >
            {t('marketplace.refresh')}
          </Button>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label={t('marketplace.stat_total_listings')}
          value={stats?.total_listings ?? 0}
          icon={ShoppingBag}
          color="default"
          loading={loading}
        />
        <StatCard
          label={t('marketplace.stat_active_listings')}
          value={stats?.active_listings ?? 0}
          icon={PackageCheck}
          color="success"
          loading={loading}
        />
        <StatCard
          label={t('marketplace.stat_total_sellers')}
          value={stats?.total_sellers ?? 0}
          icon={Store}
          color="default"
          loading={loading}
        />
        <StatCard
          label={t('marketplace.stat_pending_moderation')}
          value={stats?.pending_moderation ?? 0}
          icon={Clock}
          color="warning"
          loading={loading}
        />
        <StatCard
          label={t('marketplace.stat_total_orders')}
          value={stats?.total_orders ?? 0}
          icon={DollarSign}
          color="default"
          loading={loading}
        />
        <StatCard
          label={tm('my_listings.stat_revenue')}
          value={(stats?.revenue_by_currency?.length
            ? stats.revenue_by_currency
            : stats?.revenue != null && stats.currency
              ? [{ total: stats.revenue, currency: stats.currency }]
              : [])
            .map((entry) => formatMarketplaceCurrency(entry.total, entry.currency))
            .join(' · ') || '0'}
          icon={DollarSign}
          color="success"
          loading={loading}
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Link to={tenantPath('/admin/marketplace/moderation')}>
          <Card isPressable className="w-full border border-divider/70 bg-surface transition-transform hover:-translate-y-0.5">
            <CardBody className="flex flex-row items-center gap-4 p-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-warning bg-warning/10">
                <Shield size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground">{t('marketplace.moderation_queue')}</p>
                <p className="text-sm text-muted">
                  {t('marketplace.moderation_queue_desc')}
                </p>
              </div>
              <ChevronRight size={20} className="text-muted" />
            </CardBody>
          </Card>
        </Link>
        <Link to={tenantPath('/admin/marketplace/sellers')}>
          <Card isPressable className="w-full border border-divider/70 bg-surface transition-transform hover:-translate-y-0.5">
            <CardBody className="flex flex-row items-center gap-4 p-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-accent bg-accent/10">
                <Users size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground">{t('marketplace.seller_management')}</p>
                <p className="text-sm text-muted">
                  {t('marketplace.seller_management_desc')}
                </p>
              </div>
              <ChevronRight size={20} className="text-muted" />
            </CardBody>
          </Card>
        </Link>
        <Link to={tenantPath('/admin/marketplace/cases')}>
          <Card isPressable className="w-full border border-divider/70 bg-surface transition-transform hover:-translate-y-0.5">
            <CardBody className="flex flex-row items-center gap-4 p-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-danger/10 text-danger">
                <Gavel size={24} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">{tc('admin.title')}</p>
                <p className="text-sm text-muted">{tc('admin.dashboard_description')}</p>
              </div>
              <ChevronRight size={20} className="text-muted" />
            </CardBody>
          </Card>
        </Link>
      </div>

      {/* Categories (owner, 17 Oct 2026: "a place to add categories") */}
      <MarketplaceCategoriesPanel />

      {/* Recent Listings Table */}
      <Card className="border border-divider/70 bg-surface">
        <CardHeader className="flex items-center justify-between px-4 pt-4">
          <h3 className="text-lg font-semibold text-foreground">{t('marketplace.recent_listings')}</h3>
          <Button as={Link} to={tenantPath('/admin/marketplace/moderation')} size="sm" variant="secondary">
            {t('marketplace.view_all')}
          </Button>
        </CardHeader>
        <CardBody className="px-4 pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner label={t('marketplace.loading_recent_listings')} /></div>
            </div>
          ) : recentListings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ShoppingBag size={32} className="text-muted mb-2" />
              <p className="text-sm text-muted">{t('marketplace.no_listings_yet')}</p>
            </div>
          ) : (
            <Table aria-label={t('marketplace.recent_listings')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('marketplace.col_title')}</TableColumn>
                <TableColumn>{t('marketplace.col_seller')}</TableColumn>
                <TableColumn>{t('marketplace.col_price')}</TableColumn>
                <TableColumn>{t('marketplace.col_status')}</TableColumn>
                <TableColumn>{t('marketplace.col_moderation')}</TableColumn>
                <TableColumn>{t('marketplace.col_created')}</TableColumn>
              </TableHeader>
              <TableBody>
                {recentListings.map((listing) => (
                  <TableRow key={listing.id}>
                    <TableCell>
                      <span className="font-medium text-foreground">{listing.title}</span>
                    </TableCell>
                    <TableCell className="text-muted">{listing.user?.name ?? '--'}</TableCell>
                    <TableCell className="text-muted">
                      {PRICE_TYPES_WITHOUT_AMOUNT.has(listing.price_type)
                        ? t(`marketplace.price_type.${listing.price_type}`)
                        : formatMarketplaceCurrency(
                          parseFloat(String(listing.price)) || 0,
                          listing.price_currency || tenant?.currency || '',
                        )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={statusColors[listing.status] || 'default'}
                        className="capitalize"
                      >
                        {t(`marketplace.status.${listing.status}`, {
                          defaultValue: t('marketplace.status.unknown'),
                        })}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={moderationColors[listing.moderation_status] || 'default'}
                        className="capitalize"
                      >
                        {t(`marketplace.moderation_status.${listing.moderation_status}`, {
                          defaultValue: t('marketplace.moderation_status.unknown'),
                        })}
                      </Chip>
                    </TableCell>
                    <TableCell className="text-muted">
                      {new Date(listing.created_at).toLocaleDateString(getFormattingLocale())}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export default MarketplaceAdmin;
