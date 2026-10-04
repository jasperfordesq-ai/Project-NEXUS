import { getFormattingLocale } from '@/lib/helpers';
import { Button, Chip, Card, CardBody, Input, Spinner, Tabs, Tab, Tooltip } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Listings / Content Directory
 * Unified view of all user-generated content with moderation actions.
 * Includes Featured Listings management tab (L4).
 * Parity: PHP Admin\ListingController::index()
 */

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Trash2 from 'lucide-react/icons/trash-2';
import Star from 'lucide-react/icons/star';
import StarOff from 'lucide-react/icons/star-off';
import Search from 'lucide-react/icons/search';
import Plus from 'lucide-react/icons/plus';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { adminListings } from '../../api/adminApi';
import { DataTable, StatusBadge, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import type { AdminListing, FeaturedListing } from '../../api/types';

const typeColors: Record<string, 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'default'> = {
  listing: 'primary',
  event: 'secondary',
  poll: 'warning',
  goal: 'success',
  resource: 'default',
  volunteer: 'danger',
};

// ─────────────────────────────────────────────────────────────────────────────
// Featured Listings Sub-Component
// ─────────────────────────────────────────────────────────────────────────────

function FeaturedListingsPanel() {
  const { t } = useTranslation('admin_listings');
  const toast = useToast();

  const [featured, setFeatured] = useState<FeaturedListing[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [searchResults, setSearchResults] = useState<AdminListing[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [featureLoading, setFeatureLoading] = useState<number | null>(null);
  const [unfeatureConfirm, setUnfeatureConfirm] = useState<FeaturedListing | null>(null);
  const [unfeatureLoading, setUnfeatureLoading] = useState(false);

  const loadFeatured = useCallback(async () => {
    setFeaturedLoading(true);
    try {
      const res = await adminListings.getFeatured();
      if (res.success && res.data) {
        const data = res.data as unknown;
        setFeatured(Array.isArray(data) ? data : []);
      }
    } catch {
      toast.error(t('listings.failed_load_content'));
    } finally {
      setFeaturedLoading(false);
    }
  }, [toast, t])

  useEffect(() => {
    loadFeatured();
  }, [loadFeatured]);

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await adminListings.list({ search: query, status: 'active' });
      if (res.success && res.data) {
        const data = res.data as unknown;
        if (Array.isArray(data)) {
          setSearchResults(data);
        } else if (data && typeof data === 'object') {
          const pd = data as { data: AdminListing[] };
          setSearchResults(pd.data || []);
        }
      }
    } catch {
      // Silently handle search errors
    } finally {
      setSearching(false);
    }
  }, []);

  const handleFeature = async (listingId: number) => {
    setFeatureLoading(listingId);
    try {
      const res = await adminListings.feature(listingId);
      if (res?.success) {
        toast.success(t('listings.featured_success'));
        setSearchQuery('');
        setSearchResults([]);
        loadFeatured();
      } else {
        toast.error(t('listings.failed_feature'));
      }
    } catch {
      toast.error(t('listings.an_unexpected_error_occurred'));
    } finally {
      setFeatureLoading(null);
    }
  };

  const handleUnfeature = async () => {
    if (!unfeatureConfirm) return;
    setUnfeatureLoading(true);
    try {
      const res = await adminListings.unfeature(unfeatureConfirm.listing_id);
      if (res?.success) {
        toast.success(t('listings.unfeatured_success'));
        loadFeatured();
      } else {
        toast.error(t('listings.failed_unfeature'));
      }
    } catch {
      toast.error(t('listings.an_unexpected_error_occurred'));
    } finally {
      setUnfeatureLoading(false);
      setUnfeatureConfirm(null);
    }
  };

  // Filter out already-featured listings from search results
  const featuredIds = new Set(featured.map((f) => f.listing_id));
  const filteredResults = searchResults.filter((r) => !featuredIds.has(r.id));

  const featuredColumns: Column<FeaturedListing>[] = [
    {
      key: 'title',
      label: t('listings.col_listing_title'),
      sortable: true,
      render: (item) => (
        <span className="font-medium text-foreground">{item.title}</span>
      ),
    },
    {
      key: 'type',
      label: t('listings.type'),
      sortable: true,
      render: (item) => (
        <Chip size="sm" variant="soft" color={typeColors[item.type] || 'default'} className="capitalize">
          {t(`listings.types.${item.type}`, {
            defaultValue: t('listings.types.unknown'),
          })}
        </Chip>
      ),
    },
    {
      key: 'user_name',
      label: t('listings.author'),
      sortable: true,
    },
    {
      key: 'featured_at',
      label: t('listings.featured_date'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {new Date(item.featured_at).toLocaleDateString(getFormattingLocale())}
        </span>
      ),
    },
    {
      key: 'featured_by',
      label: t('listings.featured_by'),
      render: (item) => (
        <span className="text-sm text-muted">
          {item.featured_by || '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('listings.actions'),
      render: (item) => (
        <Button
          size="sm"
          variant="tertiary"
          color="warning"
          startContent={<StarOff aria-hidden="true" size={14} />}
          onPress={() => setUnfeatureConfirm(item)}
        >
          {t('listings.unfeature')}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Feature new listing search */}
      <Card  className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
        <CardBody className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Plus size={16} aria-hidden="true" />
            {t('listings.feature_listing')}
          </h3>
          <Input type="search" name="admin-search" autoComplete="off"
            placeholder={t('listings.placeholder_search_active_listings_to_feature')}
            aria-label={t('listings.label_search_listings')}
            startContent={<Search aria-hidden="true" size={16} className="text-muted" />}
            value={searchQuery}
            onValueChange={handleSearch}
            size="sm"
            variant="secondary"
            className="mb-3"
          />
          {searching && (
            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex items-center justify-center py-4">
              <Spinner size="sm" />
            </div>
          )}
          {filteredResults.length > 0 && (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {filteredResults.map((listing) => (
                <div
                  key={listing.id}
                  className="flex items-center justify-between rounded-xl border border-divider/70 bg-surface-secondary/30 p-3 transition-colors hover:bg-surface-secondary"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {listing.title}
                    </p>
                    <p className="text-xs text-muted">
                      {t('listings.by_author')} &middot;{' '}
                      <span>{t(`listings.types.${listing.type}`, {
                        defaultValue: t('listings.types.unknown'),
                      })}</span>
                    </p>
                  </div>
                  <Button
                    size="sm"
                    color="warning"
                    variant="tertiary"
                    startContent={<Star aria-hidden="true" size={14} />}
                    isLoading={featureLoading === listing.id}
                    onPress={() => handleFeature(listing.id)}
                  >
                    {t('listings.feature')}
                  </Button>
                </div>
              ))}
            </div>
          )}
          {searchQuery.length >= 2 && !searching && filteredResults.length === 0 && searchResults.length === 0 && (
            <p className="text-sm text-muted text-center py-2">
              {t('listings.no_active_listings_found')}
            </p>
          )}
        </CardBody>
      </Card>

      {/* Currently featured listings table */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Star size={16} className="text-warning" aria-hidden="true" />
          {t('listings.currently_featured')}
        </h3>
        <DataTable
          columns={featuredColumns}
          data={featured}
          keyField="listing_id"
          isLoading={featuredLoading}
          searchable={false}
          onRefresh={loadFeatured}
          emptyContent={t('listings.no_featured_listings')}
        />
      </div>

      {/* Unfeature confirmation modal */}
      {unfeatureConfirm && (
        <ConfirmModal
          isOpen={!!unfeatureConfirm}
          onClose={() => setUnfeatureConfirm(null)}
          onConfirm={handleUnfeature}
          title={t('listings.remove_from_featured')}
          message={t('listings.remove_from_featured_message')}
          confirmLabel={t('listings.unfeature')}
          confirmColor="warning"
          isLoading={unfeatureLoading}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main ListingsAdmin Component
// ─────────────────────────────────────────────────────────────────────────────


const LISTING_STATUS_TABS = ['all', 'pending', 'active', 'inactive'] as const;
type ListingStatusTab = (typeof LISTING_STATUS_TABS)[number];

/** A URL value outside the four tabs falls back to "all" rather than an empty list. */
function readStatusParam(value: string | null): ListingStatusTab {
  return (LISTING_STATUS_TABS as readonly string[]).includes(value ?? '') ? (value as ListingStatusTab) : 'all';
}

export function ListingsAdmin() {
  const { t } = useTranslation('admin_listings');
  useAdminPageMeta({
    title: t('listings.listings_admin_title'),
    description: t('listings.listings_admin_desc'),
  });
  const toast = useToast();

  const [activeTab, setActiveTab] = useState('content');
  const [items, setItems] = useState<AdminListing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  // The status tab lives in the address (`?status=pending`) so the dashboard's
  // "Review" link and the sidebar badge open the list already filtered. Until
  // 2026-10-04 this was plain state and every such link landed on "All".
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState(() => readStatusParam(searchParams.get('status')));
  const [search, setSearch] = useState('');
  const [confirmAction, setConfirmAction] = useState<{
    type: 'approve' | 'reject' | 'delete';
    item: AdminListing;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [featureToggleLoading, setFeatureToggleLoading] = useState<number | null>(null);

  // Sync when the URL changes from outside (a sidebar or dashboard link while
  // already on this page).
  useEffect(() => {
    const urlStatus = readStatusParam(searchParams.get('status'));
    if (urlStatus !== status) {
      setStatus(urlStatus);
      setPage(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleStatusChange = (key: string) => {
    const next = readStatusParam(key);
    setStatus(next);
    setPage(1);
    const params = new URLSearchParams(searchParams);
    if (next === 'all') {
      params.delete('status');
    } else {
      params.set('status', next);
    }
    setSearchParams(params, { replace: true });
  };

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminListings.list({
        page,
        status: status === 'all' ? undefined : status,
        search: search || undefined,
      });
      if (res.success && res.data) {
        const data = res.data as unknown;
        if (Array.isArray(data)) {
          setItems(data);
          // Use meta.total from the paginated response envelope for correct pagination.
          // Falling back to data.length only if meta is unavailable (non-paginated response).
          const metaTotal = (res.meta as Record<string, unknown> | undefined)?.total;
          setTotal(typeof metaTotal === 'number' ? metaTotal : data.length);
        } else if (data && typeof data === 'object') {
          const pd = data as { data: AdminListing[]; meta?: { total: number } };
          setItems(pd.data || []);
          setTotal(pd.meta?.total || 0);
        }
      }
    } catch {
      toast.error(t('listings.failed_load_content'));
    } finally {
      setLoading(false);
    }
  }, [page, status, search, toast, t])

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleAction = async () => {
    if (!confirmAction) return;
    setActionLoading(true);
    try {
      const { type, item } = confirmAction;
      let res;
      if (type === 'approve') {
        res = await adminListings.approve(item.id);
      } else if (type === 'reject') {
        res = await adminListings.reject(item.id);
      } else {
        res = await adminListings.delete(item.id);
      }

      if (res?.success) {
        toast.success(t(`listings.content_${type}_success`));
        loadItems();
      } else {
        toast.error(t(`listings.content_${type}_failed`));
      }
    } catch {
      toast.error(t('listings.an_unexpected_error_occurred'));
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  const handleFeatureToggle = async (item: AdminListing) => {
    setFeatureToggleLoading(item.id);
    try {
      const res = item.is_featured
        ? await adminListings.unfeature(item.id)
        : await adminListings.feature(item.id);
      if (res?.success) {
        toast.success(
          item.is_featured
            ? t('listings.removed_from_featured')
            : t('listings.now_featured')
        );
        loadItems();
      } else {
        toast.error(t('listings.failed_update_featured'));
      }
    } catch {
      toast.error(t('listings.an_unexpected_error_occurred'));
    } finally {
      setFeatureToggleLoading(null);
    }
  };

  const columns: Column<AdminListing>[] = [
    {
      key: 'title',
      label: t('listings.col_listing_title'),
      sortable: true,
      render: (item) => (
        <span className="font-medium text-foreground">{item.title}</span>
      ),
    },
    {
      key: 'type',
      label: t('listings.type'),
      sortable: true,
      render: (item) => (
        <Chip size="sm" variant="soft" color={typeColors[item.type] || 'default'} className="capitalize">
          {t(`listings.types.${item.type}`, {
            defaultValue: t('listings.types.unknown'),
          })}
        </Chip>
      ),
    },
    {
      key: 'user_name',
      label: t('listings.author'),
      sortable: true,
    },
    {
      key: 'status',
      label: t('listings.status'),
      sortable: true,
      render: (item) => <StatusBadge status={item.status} />,
    },
    {
      key: 'created_at',
      label: t('listings.created'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {new Date(item.created_at).toLocaleDateString(getFormattingLocale())}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('listings.actions'),
      render: (item) => (
        <div className="flex gap-1">
          {item.status === 'pending' && (
            <>
              <Button
                isIconOnly
                size="sm"
                variant="tertiary"
                color="success"
                onPress={() => setConfirmAction({ type: 'approve', item })}
                aria-label={t('listings.label_approve')}
              >
                <CheckCircle size={14} />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="danger"
                onPress={() => setConfirmAction({ type: 'reject', item })}
                aria-label={t('listings.label_reject')}
              >
                <XCircle size={14} />
              </Button>
            </>
          )}
          <Tooltip content={item.is_featured ? t('listings.unfeature') : t('listings.feature')}>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              color="warning"
              onPress={() => handleFeatureToggle(item)}
              isLoading={featureToggleLoading === item.id}
              aria-label={item.is_featured ? t('listings.unfeature_listing') : t('listings.feature_listing')}
            >
              {item.is_featured ? <Star size={14} className="fill-warning" /> : <StarOff size={14} />}
            </Button>
          </Tooltip>
          <Button
            isIconOnly
            size="sm"
            variant="danger"
            onPress={() => setConfirmAction({ type: 'delete', item })}
            aria-label={t('listings.label_delete')}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('listings.listings_admin_title')}
        description={t('listings.listings_admin_desc')}
      />

      {/* Top-level tabs: Content | Featured */}
      <div className="rounded-2xl border border-divider/70 bg-surface p-2 shadow-sm shadow-black/[0.03]">
        <Tabs
          aria-label={t('listings.section_tabs_aria')}
          selectedKey={activeTab}
          onSelectionChange={(key) => setActiveTab(key as string)}
          variant="primary"
          size="sm"
          classNames={{ tabList: 'mb-4' }}
        >
          <Tab key="content" title={t('listings.tab_content')} />
          <Tab
            key="featured"
            title={
              <div className="flex items-center gap-1.5">
                <Star size={14} aria-hidden="true" />
                {t('listings.tab_featured')}
              </div>
            }
          />
        </Tabs>
      </div>

      {activeTab === 'content' && (
        <>
          {/* Status filter sub-tabs */}
          <div className="rounded-2xl border border-divider/70 bg-surface p-2 shadow-sm shadow-black/[0.03]">
            <Tabs
              aria-label={t('listings.filter_tabs_aria')}
              selectedKey={status}
              onSelectionChange={(key) => handleStatusChange(String(key))}
              variant="underlined"
              size="sm"
            >
              <Tab key="all" title={t('listings.filter_all')} />
              <Tab key="pending" title={t('listings.filter_pending')} />
              <Tab key="active" title={t('listings.filter_active')} />
              <Tab key="inactive" title={t('listings.filter_inactive')} />
            </Tabs>
          </div>

          <DataTable
            columns={columns}
            data={items}
            isLoading={loading}
            searchPlaceholder={t('listings.search_content')}
            onSearch={(q) => { setSearch(q); setPage(1); }}
            onRefresh={loadItems}
            totalItems={total}
            page={page}
            pageSize={20}
            onPageChange={setPage}
          />

          {confirmAction && (
            <ConfirmModal
              isOpen={!!confirmAction}
              onClose={() => setConfirmAction(null)}
              onConfirm={handleAction}
              title={confirmAction.type === 'approve' ? t('listings.approve_content') : confirmAction.type === 'reject' ? t('listings.reject_content') : t('listings.delete_content')}
              message={
                confirmAction.type === 'approve'
                  ? t('listings.approve_content_message')
                  : confirmAction.type === 'reject'
                    ? t('listings.reject_content_message')
                    : t('listings.delete_content_message')
              }
              confirmLabel={confirmAction.type === 'approve' ? t('listings.approve') : confirmAction.type === 'reject' ? t('listings.reject') : t('listings.delete')}
              confirmColor={confirmAction.type === 'approve' ? 'primary' : 'danger'}
              isLoading={actionLoading}
            />
          )}
        </>
      )}

      {activeTab === 'featured' && <FeaturedListingsPanel />}
    </div>
  );
}

export default ListingsAdmin;
