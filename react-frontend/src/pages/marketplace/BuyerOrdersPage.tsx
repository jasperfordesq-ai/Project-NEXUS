// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BuyerOrdersPage — View and manage marketplace purchase orders.
 *
 * Features:
 * - Tabs: All, Active (paid/shipped), Completed, Cancelled/Refunded
 * - Order cards with listing image, seller, price, status, date
 * - Context-aware action buttons per order status
 * - Rating modal for completed orders
 * - Tracking info display for shipped orders
 * - Cursor-based pagination
 * - Auth required
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';

import ShoppingBag from 'lucide-react/icons/shopping-bag';
import Package from 'lucide-react/icons/package';
import Truck from 'lucide-react/icons/truck';
import Star from 'lucide-react/icons/star';
import ExternalLink from 'lucide-react/icons/external-link';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Tab, Tabs } from '@/components/ui/Tabs';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { EmptyState } from '@/components/feedback';
import { OrderStatusBadge, RatingModal } from '@/components/marketplace';
import type { MarketplaceOrderItem } from '@/types/marketplace';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, resolveThumbnailUrl, getFormattingLocale } from '@/lib/helpers';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';
import { formatMarketplaceCurrency } from '@/lib/marketplaceNumbers';
import { safeHref } from '@/lib/safeHref';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type OrderTab = 'all' | 'active' | 'completed' | 'cancelled';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 20;

const TAB_STATUS_MAP: Record<OrderTab, string | undefined> = {
  all: undefined,
  active: 'paid,shipped',
  completed: 'completed,delivered',
  cancelled: 'cancelled,refunded',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatPrice(price: number, currency: string): string {
  const numericPrice = Number(price);
  return formatMarketplaceCurrency(Number.isFinite(numericPrice) ? numericPrice : 0, currency);
}

// ─────────────────────────────────────────────────────────────────────────────
// Order Card
// ─────────────────────────────────────────────────────────────────────────────

function OrderCard({
  order,
  onRequestConfirmDelivery,
  onRate,
}: {
  order: MarketplaceOrderItem;
  onRequestConfirmDelivery: (orderId: number) => void;
  onRate: (orderId: number) => void;
}) {
  const { t } = useTranslation('marketplace');
  const { tenant, tenantPath } = useTenant();

  const hasRating = order.ratings && order.ratings.some((r) => r.rater_role === 'buyer');

  return (
    <GlassCard className="p-4">
      <div className="flex gap-4">
        {/* Listing image */}
        {order.listing ? <Link
          to={tenantPath(`/marketplace/${order.listing.id}`)}
          className="shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-surface-secondary"
        >
          {order.listing.image?.url ? (
            <img
              src={resolveThumbnailUrl(order.listing.image.thumbnail_url || order.listing.image.url, { width: 160, height: 160 })}
              alt={order.listing.title}
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ShoppingBag className="w-8 h-8 text-muted" />
            </div>
          )}
        </Link> : (
          <div
            className="shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-surface-secondary flex items-center justify-center"
            aria-label={t('listing.not_found_title')}
          >
            <ShoppingBag className="w-8 h-8 text-muted" />
          </div>
        )}

        {/* Order details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {order.listing ? <Link
                to={tenantPath(`/marketplace/${order.listing.id}`)}
                className="font-semibold text-foreground hover:text-accent transition-colors line-clamp-1"
              >
                {order.listing.title}
              </Link> : (
                <span className="font-semibold text-muted line-clamp-1">
                  {t('listing.not_found_title')}
                </span>
              )}
              <div className="flex items-center gap-2 mt-1">
                <Avatar
                  src={resolveAvatarUrl(order.seller.avatar_url) || undefined}
                  name={order.seller.name}
                  size="sm"
                  className="w-5 h-5"
                />
                <span className="text-xs text-muted">{order.seller.name}</span>
              </div>
            </div>
            <OrderStatusBadge status={order.status} />
          </div>

          <div className="flex items-center justify-between mt-2">
            <div>
              <span className="text-lg font-bold text-foreground">
                {formatPrice(order.total_price, order.currency || tenant?.currency || '')}
              </span>
              {order.quantity > 1 && (
                <span className="text-xs text-muted ml-1">
                  {t('orders.quantity_multiplier', { count: order.quantity })}
                </span>
              )}
            </div>
            <span className="text-xs text-muted">
              {new Date(order.created_at).toLocaleDateString(getFormattingLocale())}
            </span>
          </div>

          {/* Tracking info */}
          {order.tracking_number && (order.status === 'shipped' || order.status === 'delivered') && (
            <div className="flex items-center gap-2 mt-2 text-xs text-muted">
              <Truck className="w-3.5 h-3.5" />
              <span>{t('orders.tracking_number')} {order.tracking_number}</span>
              {order.tracking_url && (
                <a
                  href={safeHref(order.tracking_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline inline-flex items-center gap-0.5"
                >
                  {t('orders.track')}
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-3">
            {order.status === 'paid' && (
              <Button size="sm" variant="tertiary" isDisabled startContent={<Package className="w-3.5 h-3.5" />}>
                {t('orders.buyer.waiting_shipment')}
              </Button>
            )}
            {order.status === 'shipped' && (
              <Button
                size="sm"

                onPress={() => onRequestConfirmDelivery(order.id)}
                startContent={<CheckCircle2 className="w-3.5 h-3.5" />}
              >
                {t('orders.buyer.confirm_delivery')}
              </Button>
            )}
            {order.status === 'delivered' && !hasRating && (
              <Button
                size="sm"

                variant="secondary"
                onPress={() => onRate(order.id)}
                startContent={<Star className="w-3.5 h-3.5" />}
              >
                {t('orders.buyer.rate_order')}
              </Button>
            )}
            {order.status === 'completed' && !hasRating && (
              <Button
                size="sm"

                variant="secondary"
                onPress={() => onRate(order.id)}
                startContent={<Star className="w-3.5 h-3.5" />}
              >
                {t('orders.buyer.leave_rating')}
              </Button>
            )}
            {order.status === 'completed' && hasRating && (
              <span className="text-xs text-success flex items-center gap-1">
                <Star className="w-3 h-3 fill-success" />
                {t('orders.buyer.rated')}
              </span>
            )}
            {order.status === 'disputed' && (
              <Button size="sm" variant="danger-soft" isDisabled>
                {t('orders.buyer.dispute_open')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function BuyerOrdersPage() {
  const navigate = useNavigate();
  const { t } = useTranslation('marketplace');
  usePageTitle(t('orders.buyer.page_title'));
  const { isAuthenticated } = useAuth();
  const { tenantPath } = useTenant();
  const toast = useToast();

  // State
  const [activeTab, setActiveTab] = useState<OrderTab>('all');
  const [orders, setOrders] = useState<MarketplaceOrderItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef<string | null>(null);

  // Rating modal
  const ratingModal = useDisclosure();
  const [ratingOrderId, setRatingOrderId] = useState<number | null>(null);

  // Confirm delivery modal
  const [confirmDeliveryId, setConfirmDeliveryId] = useState<number | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate(tenantPath('/login'), { replace: true });
    }
  }, [isAuthenticated, navigate, tenantPath]);

  // Load orders
  const loadOrders = useCallback(async (append = false) => {
    try {
      if (!append) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      const params = new URLSearchParams();
      params.set('limit', String(ITEMS_PER_PAGE));
      if (append && cursorRef.current) {
        params.set('cursor', cursorRef.current);
      }
      const statuses = TAB_STATUS_MAP[activeTab];
      if (statuses) {
        params.set('status', statuses);
      }

      const response = await api.get<MarketplaceOrderItem[]>(
        `/v2/marketplace/orders/purchases?${params}`,
      );

      if (response.success && response.data) {
        if (append) {
          setOrders((prev) => [...prev, ...response.data!]);
        } else {
          setOrders(response.data);
        }
        cursorRef.current = response.meta?.cursor ?? response.meta?.next_cursor ?? null;
        setHasMore(response.meta?.has_more ?? response.data.length >= ITEMS_PER_PAGE);
      } else if (!append) {
        setOrders([]);
      }
    } catch (err) {
      logError('Failed to load buyer orders', err);
      if (!append) {
        toast.error(t('orders.load_error'));
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [activeTab, toast, t])

  // Reload on tab change
  useEffect(() => {
    if (!isAuthenticated) return;
    cursorRef.current = null;
    setHasMore(true);
    loadOrders();
  }, [activeTab, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Confirm delivery
  const handleConfirmDelivery = useCallback(async (orderId: number) => {
    try {
      const response = await api.put(`/v2/marketplace/orders/${orderId}/confirm-delivery`);
      if (response.success) {
        toast.success(t('orders.buyer.delivery_confirmed'));
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, status: 'delivered' } : o)),
        );
      } else {
        toast.error(response.error || t('orders.action_error'));
      }
    } catch (err) {
      logError('Failed to confirm delivery', err);
      toast.error(t('orders.action_error'));
    }
  }, [toast, t])

  // Open rating modal
  const handleOpenRating = useCallback((orderId: number) => {
    setRatingOrderId(orderId);
    ratingModal.onOpen();
  }, [ratingModal]);

  // Rating success
  const handleRatingSuccess = useCallback(() => {
    loadOrders();
  }, [loadOrders]);

  if (!isAuthenticated) return null;

  return (
    <>
      <PageMeta title={t('orders.buyer.page_title')} noIndex={true} />

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ShoppingBag className="w-7 h-7 text-accent" />
            {t('orders.buyer.title')}
          </h1>
          <p className="text-muted text-sm mt-1">
            {t('orders.buyer.subtitle')}
          </p>
        </div>

        {/* Tabs */}
        <Tabs
          aria-label={t('buyer_orders_tabs_aria')}
          selectedKey={activeTab}
          onSelectionChange={(key) => setActiveTab(key as OrderTab)}

          variant="secondary"
          classNames={{ tabList: 'gap-4' }}
        >
          <Tab key="all" title={t('orders.tab_all')} />
          <Tab key="active" title={t('orders.tab_active')} />
          <Tab key="completed" title={t('orders.tab_completed')} />
          <Tab key="cancelled" title={t('orders.tab_cancelled')} />
        </Tabs>

        {/* Orders list */}
        {isLoading ? (
          <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-16">
            <Spinner size="lg" color="accent" />
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag className="w-10 h-10 text-muted" />}
            title={t('orders.buyer.empty_title')}
            description={t('orders.buyer.empty_description')}
            action={{
              label: t('orders.buyer.browse_marketplace'),
              onClick: () => navigate(tenantPath('/marketplace')),
            }}
          />
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onRequestConfirmDelivery={(id) => setConfirmDeliveryId(id)}
                onRate={handleOpenRating}
              />
            ))}

            {/* Load more */}
            {hasMore && (
              <div className="flex justify-center mt-6">
                <Button
                  variant="tertiary"

                  onPress={() => loadOrders(true)}
                  isLoading={isLoadingMore}
                >
                  {t('common.load_more')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirm Delivery Modal */}
      <Modal
        isOpen={confirmDeliveryId !== null}
        onOpenChange={(open) => { if (!open) setConfirmDeliveryId(null); }}
        placement="center"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{t('orders.buyer.confirm_delivery_modal_title')}</ModalHeader>
              <ModalBody>
                <p className="text-sm text-muted">
                  {t('orders.buyer.confirm_delivery_modal_body')}
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>
                  {t('common.cancel')}
                </Button>
                <Button

                  onPress={() => {
                    if (confirmDeliveryId !== null) {
                      handleConfirmDelivery(confirmDeliveryId);
                    }
                    setConfirmDeliveryId(null);
                  }}
                >
                  {t('orders.buyer.confirm_delivery')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Rating modal */}
      {ratingOrderId !== null && (
        <RatingModal
          orderId={ratingOrderId}
          isOpen={ratingModal.isOpen}
          onClose={ratingModal.onClose}
          onSuccess={handleRatingSuccess}
        />
      )}
    </>
  );
}

export default BuyerOrdersPage;
