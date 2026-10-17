// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Marketplace utility functions.
 *
 * Maps raw API listing responses to the shared MarketplaceListingItem type
 * used by all marketplace grid/card components.
 */

import type { MarketplaceListingItem } from '@/types/marketplace';

/**
 * Raw listing shape returned by the /v2/marketplace/listings API.
 * Field names differ from the shared MarketplaceListingItem type.
 */
export interface ApiMarketplaceListing {
  id: number;
  title: string;
  description?: string;
  price: number | null;
  price_type: 'fixed' | 'negotiable' | 'free' | 'auction' | 'contact' | 'lend';
  loan_terms?: string | null;
  currency: string;
  condition: string;
  category_id?: number | null;
  category_name?: string | null;
  location?: string | null;
  images?: { url: string; thumbnail_url: string }[];
  seller?: {
    id: number;
    name: string;
    avatar_url: string | null;
  };
  views_count: number;
  is_saved: boolean;
  is_featured?: boolean;
  created_at: string;
}

/**
 * Converts a raw API marketplace listing to the shared MarketplaceListingItem
 * type expected by MarketplaceListingCard / MarketplaceListingGrid.
 */
export function mapApiToListingItem(
  raw: ApiMarketplaceListing,
  fallbackCurrency = '',
): MarketplaceListingItem {
  const primaryImage = raw.images?.[0] ?? null;

  return {
    id: raw.id,
    title: raw.title,
    price: raw.price,
    price_currency: raw.currency || fallbackCurrency,
    price_type: raw.price_type,
    loan_terms: raw.price_type === 'lend' ? (raw.loan_terms ?? null) : undefined,
    condition: (raw.condition as MarketplaceListingItem['condition']) || null,
    location: raw.location ?? undefined,
    delivery_method: '',
    seller_type: '',
    status: 'active',
    image: primaryImage
      ? { url: primaryImage.url, thumbnail_url: primaryImage.thumbnail_url }
      : null,
    image_count: raw.images?.length ?? 0,
    category: raw.category_id
      ? { id: raw.category_id, name: raw.category_name ?? '', slug: '' }
      : null,
    user: raw.seller
      ? { id: raw.seller.id, name: raw.seller.name, avatar_url: raw.seller.avatar_url ?? undefined }
      : null,
    is_saved: raw.is_saved,
    is_own: false,
    is_promoted: raw.is_featured ?? false,
    views_count: raw.views_count,
    created_at: raw.created_at,
  };
}
