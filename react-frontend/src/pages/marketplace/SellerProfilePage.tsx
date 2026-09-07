// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SellerProfilePage — Public seller profile in the marketplace.
 *
 * Features:
 * - Seller header with avatar, name, bio, type badge, trust score
 * - Stats row: total sales, avg rating, response time, active listings
 * - Tabs: Listings (default), Reviews (Phase 2 placeholder)
 * - Listings grid showing seller's marketplace items (shared MarketplaceListingGrid)
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';

import { Separator } from '@/components/ui/Separator';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Star from 'lucide-react/icons/star';
import Clock from 'lucide-react/icons/clock';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import MapPin from 'lucide-react/icons/map-pin';
import MessageCircle from 'lucide-react/icons/message-circle';
import Shield from 'lucide-react/icons/shield';
import Package from 'lucide-react/icons/package';
import User from 'lucide-react/icons/user';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { Tabs, Tab } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/feedback';
import { MarketplaceListingGrid } from '@/components/marketplace';
import { MarketplacePartnerBadge } from '@/components/marketplace/MarketplacePartnerBadge';
import type { MarketplaceListingItem } from '@/types/marketplace';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SellerProfile {
  id: number;
  user_id: number;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  seller_type: 'private' | 'business' | null;
  community_trust_score: number | null;
  total_sales: number;
  avg_rating: number | null;
  total_ratings: number;
  response_time_avg: string | null;
  active_listings: number;
  member_since: string;
  location: string | null;
  is_verified?: boolean;
  is_community_endorsed?: boolean;
  business_verified?: boolean;
  marketplace_partner_badge_at?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat Card
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
}) {
  return (
    <div className="text-center space-y-1">
      <Icon className="w-5 h-5 text-accent mx-auto" />
      <p className="text-lg font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function SellerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('marketplace');
  usePageTitle(t('seller.page_title'));
  const { isAuthenticated } = useAuth();
  const { tenantPath, hasFeature, hasModule } = useTenant();
  const canMessage = hasModule('messages') && hasFeature('direct_messaging');
  const toast = useToast();

  // State
  const [seller, setSeller] = useState<SellerProfile | null>(null);
  const [listings, setListings] = useState<MarketplaceListingItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingListings, setIsLoadingListings] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('listings');

  // Load seller profile
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await api.get<SellerProfile>(`/v2/marketplace/sellers/${id}`);
        if (cancelled) return;
        if (response.success && response.data) {
          setSeller(response.data);
        } else {
          setError(response.error || t('seller.not_found_title'));
        }
      } catch (err) {
        if (!cancelled) {
          logError('Failed to load seller profile', err);
          setError(t('seller.not_found_description'));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [id, t])

  // Update page title
  useEffect(() => {
    if (seller?.display_name) {
      document.title = `${seller.display_name} - ${t('seller.page_title')}`;
    }
  }, [seller?.display_name, t]);

  // Load seller listings
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const load = async () => {
      setIsLoadingListings(true);
      try {
        const response = await api.get<MarketplaceListingItem[]>(
          `/v2/marketplace/sellers/${id}/listings?limit=50`
        );
        if (!cancelled && response.success && response.data) {
          setListings(response.data as MarketplaceListingItem[]);
        }
      } catch (err) {
        if (!cancelled) logError('Failed to load seller listings', err);
      } finally {
        if (!cancelled) setIsLoadingListings(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [id]);

  // Save / Unsave
  const handleSave = useCallback(async (listingId: number) => {
    if (!isAuthenticated) {
      toast.error(t('common.sign_in_to_save'));
      return;
    }
    try {
      const response = await api.post(`/v2/marketplace/listings/${listingId}/save`);
      if (response.success) {
        setListings((prev) =>
          prev.map((l) => (l.id === listingId ? { ...l, is_saved: true } : l))
        );
        toast.success(t('common.saved_for_later'));
      } else {
        toast.error(response.error || t('common.save_failed'));
      }
    } catch (err) {
      logError('Failed to save listing', err);
      toast.error(t('common.save_failed'));
    }
  }, [isAuthenticated, toast, t]);

  const handleUnsave = useCallback(async (listingId: number) => {
    if (!isAuthenticated) {
      toast.error(t('common.sign_in_to_save'));
      return;
    }
    try {
      const response = await api.delete(`/v2/marketplace/listings/${listingId}/save`);
      if (response.success) {
        setListings((prev) =>
          prev.map((l) => (l.id === listingId ? { ...l, is_saved: false } : l))
        );
        toast.success(t('common.removed_from_saved'));
      } else {
        toast.error(response.error || t('common.save_failed'));
      }
    } catch (err) {
      logError('Failed to unsave listing', err);
      toast.error(t('common.save_failed'));
    }
  }, [isAuthenticated, toast, t]);

  // Loading
  if (isLoading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-24">
        <Spinner size="lg" color="accent" />
      </div>
    );
  }

  // Error
  if (error || !seller) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <EmptyState
          icon={<User className="w-8 h-8" />}
          title={t('seller.not_found_title')}
          description={error || t('seller.not_found_description')}
          action={{ label: t('seller.back_to_marketplace'), onClick: () => navigate(tenantPath('/marketplace')) }}
        />
      </div>
    );
  }

  const sellerMetaDescription = (
    seller.bio ||
    t('seller.view_listings', { name: seller.display_name })
  ).replace(/\s+/g, ' ').trim().slice(0, 160);

  return (
    <>
      <PageMeta
        title={`${seller.display_name} - ${t('seller.page_title')}`}
        description={sellerMetaDescription}
        image={seller.avatar_url || undefined}
        type="profile"
      />

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Back */}
        <Button
          as={Link}
          to={tenantPath('/marketplace')}
          variant="tertiary"
          size="sm"
          startContent={<ArrowLeft className="w-4 h-4" />}
        >
          {t('seller.marketplace')}
        </Button>

        {/* Seller header */}
        <GlassCard className="p-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
            <Avatar
              src={resolveAvatarUrl(seller.avatar_url) || undefined}
              name={seller.display_name}
              className="w-20 h-20 text-xl"
              isBordered
              color="accent"
            />
            <div className="flex-1 text-center sm:text-left space-y-2">
              <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-foreground">{seller.display_name}</h1>
                {(seller.business_verified || seller.is_community_endorsed) && (
                  <Chip
                    size="sm"
                    color="success"
                    variant="soft"
                    startContent={<Shield className="w-3 h-3" />}
                  >
                    {t('seller.verified')}
                  </Chip>
                )}
                {seller.seller_type && (
                  <Chip size="sm" variant="soft" color="default">
                    {seller.seller_type === 'business' ? t('seller.seller_type_business') : t('seller.seller_type_private')}
                  </Chip>
                )}
                <MarketplacePartnerBadge grantedAt={seller.marketplace_partner_badge_at ?? null} />
              </div>

              {seller.bio && (
                <p className="text-sm text-muted max-w-lg">{seller.bio}</p>
              )}

              <div className="flex items-center justify-center sm:justify-start gap-4 text-xs text-muted flex-wrap">
                {seller.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {seller.location}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {t('seller.member_since', { date: new Date(seller.member_since).toLocaleDateString(getFormattingLocale(), { month: 'long', year: 'numeric' }) })}
                </span>
              </div>

              {/* Trust score */}
              {seller.community_trust_score !== null && seller.community_trust_score > 0 && (
                <div className="flex items-center justify-center sm:justify-start gap-1.5">
                  <span className="text-xs text-muted">{t('seller.community_trust')}</span>
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <Star
                        key={level}
                        className={`w-3.5 h-3.5 ${
                          level <= Math.round((seller.community_trust_score ?? 0) / 20)
                            ? 'fill-warning text-warning'
                            : 'text-muted'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-xs font-medium text-foreground">{seller.community_trust_score}%</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
              {canMessage && isAuthenticated && (
                <Button
                  variant="secondary"
                  startContent={<MessageCircle className="w-4 h-4" />}
                  as={Link}
                  to={tenantPath(`/messages?to=${seller.user_id}`)}
                >
                  {t('seller.message')}
                </Button>
              )}
            </div>
          </div>

          {/* Stats row */}
          <Separator className="my-5" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              icon={ShoppingBag}
              label={t('seller.total_sales')}
              value={seller.total_sales}
            />
            <StatCard
              icon={Star}
              label={t('seller.avg_rating')}
              value={seller.avg_rating !== null ? seller.avg_rating.toFixed(1) : t('seller.na')}
            />
            <StatCard
              icon={Clock}
              label={t('seller.response_time')}
              value={seller.response_time_avg || t('seller.na')}
            />
            <StatCard
              icon={Package}
              label={t('seller.active_listings')}
              value={seller.active_listings}
            />
          </div>
        </GlassCard>

        {/* Tabs */}
        <Tabs
          aria-label={t('seller_profile_tabs_aria')}
          selectedKey={activeTab}
          onSelectionChange={(key) => setActiveTab(String(key))}
          variant="secondary"

        >
          <Tab
            key="listings"
            title={
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-4 h-4" />
                {t('seller.tab_listings')}
                <Chip size="sm" variant="soft">{listings.length}</Chip>
              </div>
            }
          />
          <Tab
            key="reviews"
            title={
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4" />
                {t('seller.tab_reviews')}
                <Chip size="sm" variant="soft">{seller.total_ratings}</Chip>
              </div>
            }
          />
        </Tabs>

        {/* Tab content */}
        {activeTab === 'listings' && (
          <div>
            {isLoadingListings ? (
              <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-12">
                <Spinner size="lg" color="accent" />
              </div>
            ) : listings.length === 0 ? (
              <EmptyState
                icon={<ShoppingBag className="w-8 h-8" />}
                title={t('seller.no_listings_title')}
                description={t('seller.no_listings_description', { name: seller.display_name })}
              />
            ) : (
              <MarketplaceListingGrid
                listings={listings}
                onSave={handleSave}
                onUnsave={handleUnsave}
              />
            )}
          </div>
        )}

        {activeTab === 'reviews' && (
          <GlassCard className="p-8 text-center">
            <Star className="w-12 h-12 text-muted mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-foreground mb-2">{t('seller.reviews_unavailable_title')}</h3>
            <p className="text-sm text-muted max-w-md mx-auto">
              {t('seller.reviews_unavailable_description')}
            </p>
          </GlassCard>
        )}
      </div>
    </>
  );
}

export default SellerProfilePage;
