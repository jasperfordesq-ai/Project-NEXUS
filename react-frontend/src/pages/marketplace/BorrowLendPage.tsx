// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BorrowLendPage — Grid of borrow & lend listings (price_type = 'lend').
 *
 * The "tool library" face of Marketplace & Freecycle: items members lend out
 * rather than sell, so they come back. Same layout and API usage as
 * FreeItemsPage, pre-filtered to lend listings, with a "Lend something" CTA
 * for authenticated members. A lend listing has no price, cannot be posted
 * and cannot be bought — borrowers message the owner from the listing page.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Handshake from 'lucide-react/icons/handshake';
import Plus from 'lucide-react/icons/plus';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/feedback';
import { MarketplaceListingGrid } from '@/components/marketplace';
import type { MarketplaceListingItem } from '@/types/marketplace';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';

const ITEMS_PER_PAGE = 24;

export function BorrowLendPage() {
  const { t } = useTranslation('marketplace');
  usePageTitle(t('borrow.page_title'));
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { tenantPath, hasFeature } = useTenant();
  const toast = useToast();
  const featureEnabled = hasFeature('marketplace');

  const [listings, setListings] = useState<MarketplaceListingItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef<string | null>(null);

  const loadListings = useCallback(async (append = false) => {
    try {
      if (!append) {
        setIsLoading(true);
        setError(null);
      } else {
        setIsLoadingMore(true);
      }

      const params = new URLSearchParams();
      params.set('price_type', 'lend');
      params.set('limit', String(ITEMS_PER_PAGE));
      if (append && cursorRef.current) {
        params.set('cursor', cursorRef.current);
      }

      const response = await api.get<MarketplaceListingItem[]>(
        `/v2/marketplace/listings?${params}`,
      );

      if (response.success && response.data) {
        const mapped = response.data as MarketplaceListingItem[];
        if (append) {
          setListings((prev) => [...prev, ...mapped]);
        } else {
          setListings(mapped);
        }
        cursorRef.current = response.meta?.cursor ?? response.meta?.next_cursor ?? null;
        setHasMore(response.meta?.has_more ?? response.data.length >= ITEMS_PER_PAGE);
      } else if (!append) {
        setError(t('borrow.unable_to_load'));
      }
    } catch (err) {
      logError('Failed to load borrow & lend listings', err);
      if (!append) {
        setError(t('borrow.unable_to_load'));
      } else {
        toast.error(t('borrow.load_more_failed'));
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [toast, t]);

  useEffect(() => {
    if (!featureEnabled) return;
    cursorRef.current = null;
    setHasMore(true);
    loadListings();
  }, [featureEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save / unsave handlers
  const handleSave = async (id: number) => {
    if (!isAuthenticated) {
      toast.error(t('common.sign_in_to_save'));
      return;
    }
    try {
      const response = await api.post(`/v2/marketplace/listings/${id}/save`);
      if (response.success) {
        setListings((prev) => prev.map((l) => (l.id === id ? { ...l, is_saved: true } : l)));
        toast.success(t('common.saved_for_later'));
      } else {
        toast.error(response.error || t('common.save_failed'));
      }
    } catch (err) {
      logError('Failed to save listing', err);
      toast.error(t('common.save_failed'));
    }
  };

  const handleUnsave = async (id: number) => {
    if (!isAuthenticated) return;
    try {
      const response = await api.delete(`/v2/marketplace/listings/${id}/save`);
      if (response.success) {
        setListings((prev) => prev.map((l) => (l.id === id ? { ...l, is_saved: false } : l)));
        toast.success(t('common.removed_from_saved'));
      } else {
        toast.error(response.error || t('common.save_failed'));
      }
    } catch (err) {
      logError('Failed to unsave listing', err);
      toast.error(t('common.save_failed'));
    }
  };

  if (!featureEnabled) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12">
        <EmptyState
          icon={<ShoppingBag className="w-8 h-8" aria-hidden="true" />}
          title={t('hub_feature_gate.title')}
          description={t('hub_feature_gate.description')}
        />
      </div>
    );
  }

  return (
    <>
      <PageMeta
        title={t('borrow.page_title')}
        description={t('borrow.meta_description')}
      />

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Handshake className="w-7 h-7 text-accent" aria-hidden="true" />
              {t('borrow.page_title')}
            </h1>
            <p className="text-muted text-sm mt-1">
              {t('borrow.subtitle')}
            </p>
          </div>
          {isAuthenticated && (
            <Button
              as={Link}
              to={tenantPath('/marketplace/sell')}
              variant="secondary"
              startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
            >
              {t('borrow.lend_something')}
            </Button>
          )}
        </div>

        {/* CTA banner */}
        {isAuthenticated && (
          <GlassCard className="p-5 flex flex-col gap-4 border border-accent/30 bg-accent/5 sm:flex-row sm:items-center">
            <Handshake className="w-10 h-10 text-accent shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-foreground">
                {t('borrow.cta_title')}
              </h3>
              <p className="text-sm text-muted">
                {t('borrow.cta_description')}
              </p>
            </div>
            <Button
              variant="secondary"
              as={Link}
              to={tenantPath('/marketplace/sell')}
              size="sm"
              className="w-full sm:w-auto sm:shrink-0"
            >
              {t('borrow.lend_something')}
            </Button>
          </GlassCard>
        )}

        {/* Listings */}
        {isLoading ? (
          <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-16">
            <Spinner size="lg" color="accent" />
          </div>
        ) : error ? (
          <GlassCard role="alert" className="p-8 text-center">
            <p className="text-danger mb-4">{error}</p>
            <Button variant="tertiary" onPress={() => loadListings()}>
              {t('common.try_again')}
            </Button>
          </GlassCard>
        ) : listings.length === 0 ? (
          <EmptyState
            icon={<Handshake className="w-8 h-8" aria-hidden="true" />}
            title={t('borrow.no_items_title')}
            description={t('borrow.no_items_description')}
            action={
              isAuthenticated
                ? {
                    label: t('borrow.lend_something'),
                    onClick: () => navigate(tenantPath('/marketplace/sell')),
                  }
                : undefined
            }
          />
        ) : (
          <>
            <MarketplaceListingGrid
              listings={listings}
              onSave={handleSave}
              onUnsave={handleUnsave}
            />

            {hasMore && (
              <div className="flex justify-center mt-8">
                <Button
                  variant="tertiary"
                  onPress={() => loadListings(true)}
                  isLoading={isLoadingMore}
                >
                  {t('common.load_more')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default BorrowLendPage;
