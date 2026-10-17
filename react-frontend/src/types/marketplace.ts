// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Marketplace Module Type Definitions
 *
 * Types for marketplace listings, offers, categories, sellers, and filters.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Listing Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketplaceListingItem {
  id: number;
  title: string;
  tagline?: string;
  price: number | null;
  price_currency: string;
  price_type: 'fixed' | 'negotiable' | 'free' | 'auction' | 'contact' | 'lend';
  time_credit_price?: number | null;
  /**
   * Owner's conditions for a borrow & lend listing (`price_type === 'lend'`):
   * plain text, at most 500 characters. The API only returns it for lend
   * listings; it is null/absent for everything else.
   */
  loan_terms?: string | null;
  condition: 'new' | 'like_new' | 'good' | 'fair' | 'poor' | null;
  location?: string;
  delivery_method: string;
  seller_type: string;
  status: string;
  image: { url: string; thumbnail_url?: string; alt_text?: string } | null;
  image_count: number;
  category?: { id: number; name: string; slug: string; icon?: string } | null;
  user?: { id: number; name: string; avatar_url?: string; is_verified?: boolean } | null;
  is_saved: boolean;
  is_own: boolean;
  is_promoted: boolean;
  views_count: number;
  created_at: string;
  // AG46 — inventory tracking (optional, server-supplied for own listings)
  inventory_count?: number | null;
  low_stock_threshold?: number | null;
  is_oversold_protected?: boolean;
}

export interface MarketplaceListingDetail extends MarketplaceListingItem {
  description: string;
  quantity: number;
  latitude?: number;
  longitude?: number;
  shipping_available: boolean;
  local_pickup: boolean;
  template_data?: Record<string, unknown>;
  images: Array<{
    id: number;
    url: string;
    thumbnail_url?: string;
    alt_text?: string;
    is_primary: boolean;
  }>;
  video_url?: string | null;
  saves_count: number;
  expires_at?: string;
  updated_at?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Category Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketplaceCategory {
  id: number;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  parent_id?: number;
  listing_count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Offer Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketplaceOffer {
  id: number;
  amount: number;
  currency: string;
  message?: string;
  status: 'pending' | 'accepted' | 'declined' | 'countered' | 'expired' | 'withdrawn';
  counter_amount?: number;
  counter_message?: string;
  expires_at?: string;
  accepted_at?: string;
  created_at: string;
  listing?: {
    id: number;
    title: string;
    price: number;
    price_currency: string;
    status: string;
    shipping_available?: boolean;
    local_pickup?: boolean;
    delivery_method?: string;
    image?: { url: string; thumbnail_url?: string } | null;
  };
  buyer?: { id: number; name: string; avatar_url?: string };
  seller?: { id: number; name: string; avatar_url?: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketplaceFilters {
  q?: string;
  category_id?: number;
  price_min?: number;
  price_max?: number;
  condition?: string[];
  seller_type?: string;
  delivery_method?: string;
  sort?: string;
  posted_within?: number;
  /** One `price_type` value (`fixed`, `negotiable`, `free`, `lend`, ...). */
  price_type?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seller Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketplaceSellerProfile {
  id: number;
  user_id: number;
  display_name: string;
  bio?: string;
  avatar_url?: string;
  cover_image_url?: string;
  seller_type: string;
  business_name?: string;
  business_verified: boolean;
  is_community_endorsed: boolean;
  community_trust_score?: number;
  avg_rating?: number;
  total_ratings: number;
  total_sales: number;
  response_time_avg?: number;
  response_rate?: number;
  active_listings: number;
  member_since?: string;
  joined_marketplace_at?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Saved Search Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketplaceSavedSearch {
  id: number;
  name: string;
  search_query?: string | null;
  filters?: {
    category_id?: number;
    price_min?: number;
    price_max?: number;
    condition?: string;
    location?: string;
    radius?: number;
  } | null;
  alert_frequency: 'instant' | 'daily' | 'weekly';
  alert_channel: 'email' | 'push' | 'both';
  is_active: boolean;
  last_alerted_at?: string | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collection Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketplaceCollection {
  id: number;
  name: string;
  description?: string | null;
  is_public: boolean;
  item_count: number;
  created_at: string;
  updated_at?: string;
}

export interface MarketplaceCollectionItem {
  collection_item_id: number;
  note?: string | null;
  added_at: string;
  listing: {
    id: number;
    title: string;
    price: number | null;
    price_currency: string;
    price_type: string;
    condition: string | null;
    location?: string;
    status: string;
    image: { url: string; thumbnail_url?: string; alt_text?: string } | null;
    category?: { id: number; name: string; slug: string; icon?: string } | null;
    user?: { id: number; name: string; avatar_url?: string } | null;
    created_at: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Promotion Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketplacePromotionProduct {
  type: 'bump' | 'featured' | 'top_of_category' | 'homepage_carousel';
  label: string;
  description: string;
  price: number;
  currency: string;
  duration_hours: number;
}

export interface MarketplacePromotion {
  id: number;
  promotion_type: 'bump' | 'featured' | 'top_of_category' | 'homepage_carousel';
  amount_paid: number;
  currency: string;
  started_at: string;
  expires_at: string;
  is_active: boolean;
  impressions: number;
  clicks: number;
  listing?: {
    id: number;
    title: string;
    status: string;
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Group Marketplace Types (Phase 5 — MKT37)
// ─────────────────────────────────────────────────────────────────────────────

export interface GroupMarketplaceStats {
  active_listings: number;
  total_listed: number;
  total_sellers: number;
  categories: Array<{
    id: number;
    name: string;
    slug: string;
    icon?: string;
    listing_count: number;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Community Delivery Types (Phase 5 — MKT39)
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketplaceDeliveryOffer {
  id: number;
  order_id: number;
  deliverer_id: number;
  time_credits: number;
  estimated_minutes: number | null;
  notes: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'completed' | 'cancelled';
  accepted_at: string | null;
  completed_at: string | null;
  created_at: string;
  deliverer?: {
    id: number;
    name: string;
    avatar_url: string | null;
    is_verified: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shipping Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketplaceShippingOption {
  id: number;
  courier_name: string;
  courier_code?: string;
  price: number;
  currency: string;
  estimated_days?: number;
  is_default: boolean;
  is_active: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Reply Types (Phase 5 — MKT32)
// ─────────────────────────────────────────────────────────────────────────────

export interface AiAutoReplyResponse {
  reply: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Order Types (Stripe Payment Flow)
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketplaceOrderItem {
  id: number;
  order_number: string;
  buyer: { id: number; name: string; avatar_url?: string };
  seller: { id: number; name: string; avatar_url?: string };
  listing: { id: number; title: string; image?: { url: string; thumbnail_url?: string } } | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  currency: string;
  status: string;
  tracking_number?: string;
  tracking_url?: string;
  shipping_method?: string;
  buyer_confirmed_at?: string;
  seller_confirmed_at?: string;
  created_at: string;
  ratings?: Array<{ rating: number; rater_role: string; comment?: string }>;
}
