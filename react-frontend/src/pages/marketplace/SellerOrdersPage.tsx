// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Tab, Tabs } from '@/components/ui/Tabs';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { safeHref } from '@/lib/safeHref';
/**
 * SellerOrdersPage — View and manage marketplace sales orders from the seller perspective.
 *
 * Features:
 * - Tabs: All, Active (paid/shipped), Completed, Cancelled/Refunded
 * - Order cards with listing image, buyer, price, status, date
 * - "Mark Shipped" modal with tracking info inputs
 * - Status-aware action buttons
 * - Cursor-based pagination
 * - Auth required
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';

import Store from 'lucide-react/icons/store';
import Package from 'lucide-react/icons/package';
import Truck from 'lucide-react/icons/truck';
import Star from 'lucide-react/icons/star';
import ExternalLink from 'lucide-react/icons/external-link';
import Clock from 'lucide-react/icons/clock';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { OrderStatusBadge } from '@/components/marketplace';
import type { MarketplaceOrderItem } from '@/types/marketplace';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, resolveThumbnailUrl, getFormattingLocale } from '@/lib/helpers';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';
import { formatMarketplaceCurrency } from '@/lib/marketplaceNumbers';

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

const SHIPPING_METHODS = [
  { key: 'standard' },
  { key: 'express' },
  { key: 'tracked' },
  { key: 'hand_delivery' },
  { key: 'other' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatPrice(price: number, currency: string): string {
  const numericPrice = Number(price);
  return formatMarketplaceCurrency(Number.isFinite(numericPrice) ? numericPrice : 0, currency);
}

// ─────────────────────────────────────────────────────────────────────────────
// Seller Order Card
// ─────────────────────────────────────────────────────────────────────────────

function SellerOrderCard({
  order,
  onMarkShipped,
}: {
  order: MarketplaceOrderItem;
  onMarkShipped: (orderId: number) => void;
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
              <Package className="w-8 h-8 text-muted" />
            </div>
          )}
        </Link> : (
          <div
            className="shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-surface-secondary flex items-center justify-center"
            aria-label={t('listing.not_found_title')}
          >
            <Package className="w-8 h-8 text-muted" />
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
                  src={resolveAvatarUrl(order.buyer.avatar_url) || undefined}
                  name={order.buyer.name}
                  size="sm"
                  className="w-5 h-5"
                />
                <span className="text-xs text-muted">
                  {t('orders.seller.buyer_label')} {order.buyer.name}
                </span>
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
              #{order.order_number} - {new Date(order.created_at).toLocaleDateString(getFormattingLocale())}
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
              <Button
                size="sm"

                onPress={() => onMarkShipped(order.id)}
                startContent={<Truck className="w-3.5 h-3.5" />}
              >
                {t('orders.seller.mark_shipped')}
              </Button>
            )}
            {order.status === 'shipped' && (
              <Button size="sm" variant="tertiary" isDisabled startContent={<Clock className="w-3.5 h-3.5" />}>
                {t('orders.seller.awaiting_confirmation')}
              </Button>
            )}
            {order.status === 'delivered' && (
              <Button size="sm" variant="tertiary" isDisabled startContent={<Clock className="w-3.5 h-3.5" />}>
                {t('orders.seller.awaiting_completion')}
              </Button>
            )}
            {order.status === 'completed' && hasRating && (
              <span className="text-xs text-success flex items-center gap-1">
                <Star className="w-3 h-3 fill-success" />
                {t('orders.seller.buyer_rated')}
              </span>
            )}
            {order.status === 'disputed' && (
              <Button size="sm" variant="danger-soft" isDisabled>
                {t('orders.seller.dispute_open')}
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

export function SellerOrdersPage() {
  const navigate = useNavigate();
  const { t } = useTranslation('marketplace');
  usePageTitle(t('orders.seller.page_title'));
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

  // Ship modal state
  const shipModal = useDisclosure();
  const [shipOrderId, setShipOrderId] = useState<number | null>(null);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [shippingMethod, setShippingMethod] = useState('standard');
  const [isSubmittingShip, setIsSubmittingShip] = useState(false);

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
        `/v2/marketplace/orders/sales?${params}`,
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
      logError('Failed to load seller orders', err);
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

  // Open ship modal
  const handleOpenShipModal = useCallback((orderId: number) => {
    setShipOrderId(orderId);
    setTrackingNumber('');
    setTrackingUrl('');
    setShippingMethod('standard');
    shipModal.onOpen();
  }, [shipModal]);

  // Submit shipment
  const handleSubmitShipment = useCallback(async () => {
    if (shipOrderId == null) return;

    setIsSubmittingShip(true);
    try {
      const response = await api.put(`/v2/marketplace/orders/${shipOrderId}/ship`, {
        tracking_number: trackingNumber.trim() || undefined,
        tracking_url: trackingUrl.trim() || undefined,
        shipping_method: shippingMethod,
      });

      if (response.success) {
        toast.success(t('orders.seller.shipped_success'));
        setOrders((prev) =>
          prev.map((o) =>
            o.id === shipOrderId
              ? {
                  ...o,
                  status: 'shipped',
                  tracking_number: trackingNumber.trim() || undefined,
                  tracking_url: trackingUrl.trim() || undefined,
                  shipping_method: shippingMethod,
                }
              : o,
          ),
        );
        shipModal.onClose();
      } else {
        toast.error(response.error || t('orders.action_error'));
      }
    } catch (err) {
      logError('Failed to mark order as shipped', err);
      toast.error(t('orders.action_error'));
    } finally {
      setIsSubmittingShip(false);
    }
  }, [shipOrderId, trackingNumber, trackingUrl, shippingMethod, toast, shipModal, t])

  if (!isAuthenticated) return null;

  return (
    <>
      <PageMeta title={t('orders.seller.page_title')} noIndex={true} />

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Store className="w-7 h-7 text-accent" />
            {t('orders.seller.title')}
          </h1>
          <p className="text-muted text-sm mt-1">
            {t('orders.seller.subtitle')}
          </p>
        </div>

        {/* Tabs */}
        <Tabs
          aria-label={t('seller_orders_tabs_aria')}
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
            icon={<Store className="w-10 h-10 text-muted" />}
            title={t('orders.seller.empty_title')}
            description={t('orders.seller.empty_description')}
            action={{
              label: t('orders.seller.create_listing'),
              onClick: () => navigate(tenantPath('/marketplace/sell')),
            }}
          />
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <SellerOrderCard
                key={order.id}
                order={order}
                onMarkShipped={handleOpenShipModal}
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

      {/* Ship Order Modal */}
      <Modal isOpen={shipModal.isOpen} onClose={shipModal.onClose} size="md" placement="center">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-accent" />
            {t('orders.seller.ship_modal_title')}
          </ModalHeader>
          <ModalBody className="space-y-4">
            <p className="text-sm text-muted">
              {t('orders.seller.ship_modal_description')}
            </p>
            <Select
              label={t('orders.seller.shipping_method')}
              selectedKeys={[shippingMethod]}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0] as string;
                if (selected) setShippingMethod(selected);
              }}
            >
              {SHIPPING_METHODS.map((method) => (
                <SelectItem key={method.key} id={method.key}>
                  {t(`orders.seller.shipping_method_${method.key}`)}
                </SelectItem>
              ))}
            </Select>
            <Input
              label={t('orders.seller.tracking_number')}
              placeholder={t('orders.seller.tracking_number_placeholder')}
              value={trackingNumber}
              onValueChange={setTrackingNumber}
            />
            <Input
              label={t('orders.seller.tracking_url_label')}
              placeholder={t('orders.seller.tracking_url_placeholder')}
              value={trackingUrl}
              onValueChange={setTrackingUrl}
              type="url"
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={shipModal.onClose} isDisabled={isSubmittingShip}>
              {t('common.cancel')}
            </Button>
            <Button

              onPress={handleSubmitShipment}
              isLoading={isSubmittingShip}
              startContent={!isSubmittingShip ? <Truck className="w-4 h-4" /> : undefined}
            >
              {t('orders.seller.confirm_shipped')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

export default SellerOrdersPage;
