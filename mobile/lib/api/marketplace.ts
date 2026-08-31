// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';
import { Platform } from 'react-native';

export type MarketplacePriceType = 'fixed' | 'negotiable' | 'free' | 'auction' | 'contact';
export type MarketplaceCondition = 'new' | 'like_new' | 'good' | 'fair' | 'poor';
export type MarketplaceDeliveryMethod = 'pickup' | 'shipping' | 'both' | 'community_delivery';

export interface MarketplaceCategory {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  icon?: string | null;
  listing_count: number;
}

export interface MarketplaceCategoryTemplateField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  options?: string[];
  required?: boolean;
}

export interface MarketplaceCategoryTemplate {
  id?: number | null;
  category_id: number;
  name?: string | null;
  fields: MarketplaceCategoryTemplateField[];
}

export interface MarketplaceUser {
  id: number;
  name: string;
  avatar_url?: string | null;
  is_verified?: boolean;
  member_since?: string | null;
}

export interface MarketplaceImage {
  id?: number;
  url: string;
  thumbnail_url?: string | null;
  alt_text?: string | null;
  is_primary?: boolean;
}

export interface MarketplaceVideoUpload {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}

export interface MarketplaceListingItem {
  id: number;
  title: string;
  tagline?: string | null;
  description?: string | null;
  price: number | null;
  price_currency: string;
  price_type: MarketplacePriceType;
  time_credit_price?: number | null;
  condition: MarketplaceCondition | null;
  quantity?: number | null;
  location?: string | null;
  delivery_method: MarketplaceDeliveryMethod | string;
  shipping_available?: boolean;
  local_pickup?: boolean;
  seller_type: string;
  status: string;
  image: MarketplaceImage | null;
  image_count: number;
  images?: MarketplaceImage[];
  video_url?: string | null;
  category?: MarketplaceCategory | null;
  user?: MarketplaceUser | null;
  is_saved: boolean;
  is_own: boolean;
  is_promoted: boolean;
  views_count: number;
  saves_count?: number;
  created_at: string;
  updated_at?: string | null;
  expires_at?: string | null;
  inventory_count?: number | null;
  low_stock_threshold?: number | null;
  is_oversold_protected?: boolean;
}

export interface MarketplaceNearbyListing extends MarketplaceListingItem {
  latitude?: number | null;
  longitude?: number | null;
  distance_km?: number | null;
}

export interface MarketplaceListingDetail extends MarketplaceListingItem {
  description: string;
  quantity: number;
  latitude?: number | null;
  longitude?: number | null;
  shipping_available: boolean;
  local_pickup: boolean;
  images: MarketplaceImage[];
  saves_count: number;
  template_data?: Record<string, unknown> | null;
}

export interface MarketplaceOffer {
  id: number;
  amount: number;
  currency: string;
  message?: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'countered' | 'expired' | 'withdrawn';
  counter_amount?: number | null;
  counter_message?: string | null;
  created_at: string;
  listing?: Pick<MarketplaceListingItem, 'id' | 'title' | 'status' | 'price' | 'price_currency' | 'image'>;
  buyer?: MarketplaceUser;
  seller?: MarketplaceUser;
}

export interface MarketplaceOrder {
  id: number;
  order_number: string;
  buyer?: MarketplaceUser;
  seller?: MarketplaceUser;
  listing?: { id: number; title: string; image?: { url: string } | null; delivery_method?: MarketplaceDeliveryMethod | string | null };
  quantity: number;
  unit_price: number;
  total_price: number;
  currency: string;
  status: string;
  tracking_number?: string | null;
  tracking_url?: string | null;
  shipping_method?: string | null;
  payment_method?: 'cash' | 'time_credits' | 'free';
  requires_payment?: boolean;
  time_credits_used?: number;
  wallet_transaction_id?: number | null;
  wallet_refund_transaction_id?: number | null;
  ratings?: MarketplaceOrderRating[];
  created_at: string;
}

export interface MarketplaceOrderRating {
  id: number;
  order_id?: number;
  rating: number;
  comment?: string | null;
  rater_role?: string | null;
  is_anonymous?: boolean;
  created_at?: string | null;
}

export interface MarketplaceOrderDispute {
  id: number;
  order_id?: number;
  reason: string;
  description: string;
  status?: string | null;
  created_at?: string | null;
}

export interface MarketplaceReport {
  id: number;
  status: string;
  message?: string;
}

export interface MarketplaceDeliveryOffer {
  id: number;
  order_id: number;
  deliverer_id: number;
  time_credits: number;
  estimated_minutes?: number | null;
  notes?: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'completed' | 'cancelled' | string;
  accepted_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  deliverer?: MarketplaceUser | null;
}

export interface MarketplaceSellerProfile {
  id: number;
  user_id: number;
  display_name: string;
  bio?: string | null;
  avatar_url?: string | null;
  cover_image_url?: string | null;
  location?: string | null;
  marketplace_partner_badge_at?: string | null;
  seller_type: string;
  business_name?: string | null;
  business_verified: boolean;
  is_community_endorsed: boolean;
  community_trust_score?: number | null;
  avg_rating?: number | null;
  total_ratings: number;
  total_sales: number;
  response_time_avg?: string | null;
  response_rate?: number | null;
  active_listings: number;
  member_since?: string | null;
  joined_marketplace_at?: string | null;
}

export interface MarketplaceDashboard {
  active_listings?: number;
  draft_listings?: number;
  sold_listings?: number;
  expired_listings?: number;
  total_listings?: number;
  total_sales?: number;
  pending_offers?: number;
  total_views?: number;
  total_revenue?: number;
  revenue_currency?: string;
  views_30d?: number;
  saves_30d?: number;
}

export interface MarketplaceGroupStats {
  active_listings: number;
  total_listed: number;
  total_sellers: number;
  categories: MarketplaceCategory[];
}

export interface MarketplaceSavedSearch {
  id: number;
  name: string;
  search_query?: string | null;
  filters?: Record<string, unknown> | null;
  alert_frequency: 'instant' | 'daily' | 'weekly';
  alert_channel: 'email' | 'push' | 'both';
  is_active: boolean;
  created_at: string;
}

export interface MarketplaceCollection {
  id: number;
  name: string;
  description?: string | null;
  is_public: boolean;
  item_count: number;
  created_at: string;
  updated_at?: string | null;
}

export interface MarketplaceCollectionItem {
  collection_item_id?: number;
  note?: string | null;
  added_at?: string;
  listing: MarketplaceListingItem;
}

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
  promotion_type: string;
  amount_paid: number;
  currency: string;
  started_at: string;
  expires_at: string;
  is_active: boolean;
  impressions?: number;
  clicks?: number;
  listing?: { id: number; title: string; status: string } | null;
}

export interface MarketplacePickupSlot {
  id: number;
  slot_start: string;
  slot_end: string;
  capacity: number;
  booked_count: number;
  is_recurring?: boolean;
  recurring_pattern?: string | null;
  is_active: boolean;
}

export interface MarketplacePickupReservation {
  id: number;
  slot_id?: number;
  order_id: number;
  listing_id?: number;
  listing_title?: string | null;
  qr_code?: string;
  status: string;
  reserved_at?: string | null;
  picked_up_at?: string | null;
  slot?: { slot_start?: string | null; slot_end?: string | null } | null;
}

export interface MarketplacePickupSlotOption {
  id: number;
  slot_start: string | null;
  slot_end: string | null;
  remaining: number;
}

export interface MarketplaceShippingOption {
  id: number;
  courier_name: string;
  courier_code?: string | null;
  price: number;
  currency: string;
  estimated_days?: number | null;
  is_default: boolean;
  is_active?: boolean;
}

export interface MarketplacePaymentIntent {
  checkout_url?: string;
  client_secret?: string;
  payment_intent_id?: string;
}

export interface MerchantSellerProfile {
  id?: number;
  seller_type?: 'private' | 'business' | string;
  business_name?: string | null;
  display_name?: string | null;
  bio?: string | null;
  business_registration?: string | null;
  business_address?: Record<string, string> | string | null;
  opening_hours?: Record<string, { open: string; close: string } | null> | string | null;
  avatar_url?: string | null;
  cover_image_url?: string | null;
  onboarding_completed_at?: string | null;
}

export interface MerchantOnboardingStatus {
  has_profile: boolean;
  onboarding_completed: boolean;
  profile: MerchantSellerProfile | null;
}

export interface MarketplaceStripeOnboardingStatus {
  stripe_onboarding_complete: boolean;
  stripe_account_id?: string | null;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
}

export interface MarketplaceSellerBalance {
  pending: number;
  available: number;
  currency: string;
  total_earned: number;
}

export interface MarketplaceSellerPayout {
  id: number;
  order_id: number;
  amount: number;
  platform_fee: number;
  seller_payout: number;
  currency: string;
  status: string;
  payout_status: string;
  payout_id?: string | null;
  paid_out_at?: string | null;
  created_at?: string | null;
}

export interface MerchantCoupon {
  id: number;
  code: string;
  title: string;
  description?: string | null;
  discount_type: 'percent' | 'fixed' | 'bogo';
  discount_value?: number | null;
  min_order_cents?: number | null;
  status: 'draft' | 'active' | 'paused' | 'expired';
  max_uses?: number | null;
  max_uses_per_member?: number | null;
  used_count?: number;
  usage_count?: number;
  valid_from?: string | null;
  valid_until?: string | null;
  applies_to?: 'all_listings' | 'listing_ids' | 'category_ids';
  applies_to_ids?: number[] | null;
}

export type PublicMerchantCoupon = MerchantCoupon;

export interface MerchantCouponQrPayload {
  token: string;
  expires_at: string;
  coupon_code: string;
}

export interface MerchantCouponRedemption {
  id: number;
  coupon_id: number;
  user_id: number;
  order_id?: number | null;
  discount_applied_cents: number;
  redeemed_at?: string | null;
  redemption_method?: string | null;
}

export interface MerchantCouponQrRedemptionResult {
  redemption_id: number;
  coupon_id: number;
  redeemed_at?: string | null;
}

export interface MarketplaceCollectionResponse<T> {
  data: T[];
  meta?: { cursor?: string | null; next_cursor?: string | null; has_more?: boolean };
}

export interface MarketplaceDataResponse<T> {
  data: T;
  meta?: Record<string, unknown> | null;
}

function getUploadFilename(uri: string): string {
  const cleanUri = uri.split('?')[0] ?? uri;
  const lastSegment = cleanUri.split('/').pop();
  return lastSegment && lastSegment.includes('.') ? lastSegment : 'marketplace.jpg';
}

function getMimeType(filename: string, fallback?: string | null): string {
  if (fallback?.startsWith('image/')) return fallback;
  if (fallback?.startsWith('video/')) return fallback;
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'mp4') return 'video/mp4';
  if (extension === 'webm') return 'video/webm';
  if (extension === 'mov') return 'video/quicktime';
  return 'image/jpeg';
}

async function appendMarketplaceImageFile(formData: FormData, uri: string, index: number): Promise<void> {
  const filename = getUploadFilename(uri);

  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    const type = getMimeType(filename, blob.type);
    if (typeof File !== 'undefined') {
      formData.append(`image_${index}`, new File([blob], filename, { type }));
      return;
    }
    formData.append(`image_${index}`, blob, filename);
    return;
  }

  const type = getMimeType(filename);
  formData.append(`image_${index}`, { uri, name: filename, type } as unknown as Blob);
}

async function appendMarketplaceVideoFile(formData: FormData, asset: MarketplaceVideoUpload): Promise<void> {
  const filename = asset.fileName || getUploadFilename(asset.uri);

  if (Platform.OS === 'web') {
    const response = await fetch(asset.uri);
    const blob = await response.blob();
    const type = getMimeType(filename, asset.mimeType ?? blob.type);
    if (typeof File !== 'undefined') {
      formData.append('video', new File([blob], filename, { type }));
      return;
    }
    formData.append('video', blob, filename);
    return;
  }

  const type = getMimeType(filename, asset.mimeType);
  formData.append('video', { uri: asset.uri, name: filename, type } as unknown as Blob);
}

export interface MarketplaceListingFilters {
  q?: string;
  category_id?: number;
  price_min?: number | string;
  price_max?: number | string;
  price_type?: MarketplacePriceType | '';
  condition?: MarketplaceCondition | string | '';
  seller_type?: 'private' | 'business' | '';
  delivery_method?: MarketplaceDeliveryMethod | '';
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'popular';
  posted_within?: number | string;
  cursor?: string | null;
  limit?: number;
  user_id?: number;
  status?: string;
}

export interface MarketplaceListingPayload {
  title: string;
  description: string;
  tagline?: string | null;
  price?: number | null;
  price_currency?: string | null;
  price_type?: MarketplacePriceType;
  time_credit_price?: number | null;
  category_id?: number | null;
  condition?: MarketplaceCondition | null;
  quantity?: number | null;
  inventory_count?: number | null;
  low_stock_threshold?: number | null;
  is_oversold_protected?: boolean;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  shipping_available?: boolean;
  local_pickup?: boolean;
  delivery_method?: MarketplaceDeliveryMethod;
  seller_type?: 'private' | 'business';
  status?: 'draft' | 'active';
  template_data?: Record<string, string> | null;
}

function addQueryValue(query: Record<string, string>, key: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  query[key] = String(value);
}

function collectionMeta<T>(response: MarketplaceCollectionResponse<T>) {
  return response.meta ?? {};
}

export function getMarketplaceListings(
  params: MarketplaceListingFilters = {},
): Promise<MarketplaceCollectionResponse<MarketplaceListingItem>> {
  const query: Record<string, string> = {};
  addQueryValue(query, 'q', params.q);
  addQueryValue(query, 'category_id', params.category_id);
  addQueryValue(query, 'price_min', params.price_min);
  addQueryValue(query, 'price_max', params.price_max);
  addQueryValue(query, 'price_type', params.price_type);
  addQueryValue(query, 'condition', params.condition);
  addQueryValue(query, 'seller_type', params.seller_type);
  addQueryValue(query, 'delivery_method', params.delivery_method);
  addQueryValue(query, 'sort', params.sort);
  addQueryValue(query, 'posted_within', params.posted_within);
  addQueryValue(query, 'cursor', params.cursor);
  addQueryValue(query, 'limit', params.limit ?? 20);
  addQueryValue(query, 'user_id', params.user_id);
  addQueryValue(query, 'status', params.status);
  return api.get<MarketplaceCollectionResponse<MarketplaceListingItem>>(`${API_V2}/marketplace/listings`, query);
}

export function getNearbyMarketplaceListings(params: {
  latitude: number;
  longitude: number;
  radius?: number;
  limit?: number;
}): Promise<MarketplaceDataResponse<MarketplaceNearbyListing[]>> {
  const query: Record<string, string> = {};
  addQueryValue(query, 'latitude', params.latitude);
  addQueryValue(query, 'longitude', params.longitude);
  addQueryValue(query, 'radius', params.radius ?? 25);
  addQueryValue(query, 'limit', params.limit ?? 20);
  return api.get<MarketplaceDataResponse<MarketplaceNearbyListing[]>>(`${API_V2}/marketplace/listings/nearby`, query);
}

export function getFeaturedMarketplaceListings(): Promise<MarketplaceDataResponse<MarketplaceListingItem[]>> {
  return api.get<MarketplaceDataResponse<MarketplaceListingItem[]>>(`${API_V2}/marketplace/listings/featured`);
}

export function getFreeMarketplaceListings(
  cursor?: string | null,
): Promise<MarketplaceCollectionResponse<MarketplaceListingItem>> {
  const query: Record<string, string> = {};
  addQueryValue(query, 'cursor', cursor);
  return api.get<MarketplaceCollectionResponse<MarketplaceListingItem>>(`${API_V2}/marketplace/listings/free`, query);
}

export function getMarketplaceCategories(): Promise<MarketplaceDataResponse<MarketplaceCategory[]>> {
  return api.get<MarketplaceDataResponse<MarketplaceCategory[]>>(`${API_V2}/marketplace/categories`);
}

export function getMarketplaceCategoryTemplate(id: number): Promise<MarketplaceDataResponse<MarketplaceCategoryTemplate>> {
  return api.get<MarketplaceDataResponse<MarketplaceCategoryTemplate>>(`${API_V2}/marketplace/categories/${id}/template`);
}

export function getMarketplaceListing(
  id: number,
  acceptedOfferId?: number | null,
): Promise<MarketplaceDataResponse<MarketplaceListingDetail>> {
  const endpoint = `${API_V2}/marketplace/listings/${id}`;
  return acceptedOfferId
    ? api.get<MarketplaceDataResponse<MarketplaceListingDetail>>(endpoint, { offer_id: String(acceptedOfferId) })
    : api.get<MarketplaceDataResponse<MarketplaceListingDetail>>(endpoint);
}

export function createMarketplaceListing(
  payload: MarketplaceListingPayload,
): Promise<MarketplaceDataResponse<MarketplaceListingDetail>> {
  return api.post<MarketplaceDataResponse<MarketplaceListingDetail>>(`${API_V2}/marketplace/listings`, payload);
}

export function updateMarketplaceListing(
  id: number,
  payload: Partial<MarketplaceListingPayload>,
): Promise<MarketplaceDataResponse<MarketplaceListingDetail>> {
  return api.put<MarketplaceDataResponse<MarketplaceListingDetail>>(`${API_V2}/marketplace/listings/${id}`, payload);
}

export function generateMarketplaceDescription(payload: {
  title: string;
  category?: string;
  condition?: string;
}): Promise<MarketplaceDataResponse<{ description: string }>> {
  return api.post<MarketplaceDataResponse<{ description: string }>>(`${API_V2}/marketplace/listings/generate-description`, payload);
}

export function deleteMarketplaceListing(id: number): Promise<void> {
  return api.delete<void>(`${API_V2}/marketplace/listings/${id}`);
}

export function saveMarketplaceListing(id: number): Promise<void> {
  return api.post<void>(`${API_V2}/marketplace/listings/${id}/save`);
}

export function reportMarketplaceListing(
  id: number,
  payload: { reason: string; description: string; evidence_urls?: string[] },
): Promise<MarketplaceDataResponse<MarketplaceReport>> {
  return api.post<MarketplaceDataResponse<MarketplaceReport>>(`${API_V2}/marketplace/listings/${id}/report`, payload);
}

export function unsaveMarketplaceListing(id: number): Promise<void> {
  return api.delete<void>(`${API_V2}/marketplace/listings/${id}/save`);
}

export function renewMarketplaceListing(id: number): Promise<MarketplaceDataResponse<MarketplaceListingDetail>> {
  return api.post<MarketplaceDataResponse<MarketplaceListingDetail>>(`${API_V2}/marketplace/listings/${id}/renew`, { duration_days: 30 });
}

export async function uploadMarketplaceImages(id: number, uris: string[]): Promise<MarketplaceDataResponse<MarketplaceImage[]>> {
  const formData = new FormData();
  await Promise.all(uris.map((uri, index) => appendMarketplaceImageFile(formData, uri, index)));
  return api.upload<MarketplaceDataResponse<MarketplaceImage[]>>(`${API_V2}/marketplace/listings/${id}/images`, formData);
}

export function deleteMarketplaceListingImage(id: number, imageId: number): Promise<void> {
  return api.delete<void>(`${API_V2}/marketplace/listings/${id}/images/${imageId}`);
}

export async function uploadMarketplaceVideo(id: number, asset: MarketplaceVideoUpload): Promise<MarketplaceDataResponse<{ video_url: string }>> {
  const formData = new FormData();
  await appendMarketplaceVideoFile(formData, asset);
  return api.upload<MarketplaceDataResponse<{ video_url: string }>>(`${API_V2}/marketplace/listings/${id}/video`, formData);
}

export function deleteMarketplaceVideo(id: number): Promise<void> {
  return api.delete<void>(`${API_V2}/marketplace/listings/${id}/video`);
}

export function getMyMarketplaceListings(
  cursor?: string | null,
  userId?: number,
  status?: string | null,
): Promise<MarketplaceCollectionResponse<MarketplaceListingItem>> {
  return getMarketplaceListings({ cursor, limit: 20, sort: 'newest', user_id: userId, status: status || undefined });
}

export function makeMarketplaceOffer(
  listingId: number,
  payload: { amount: number; message?: string | null },
): Promise<MarketplaceDataResponse<MarketplaceOffer>> {
  return api.post<MarketplaceDataResponse<MarketplaceOffer>>(`${API_V2}/marketplace/listings/${listingId}/offers`, payload);
}

export function getMarketplaceOffers(
  mode: 'sent' | 'received',
  cursor?: string | null,
): Promise<MarketplaceCollectionResponse<MarketplaceOffer>> {
  const query: Record<string, string> = {};
  addQueryValue(query, 'cursor', cursor);
  addQueryValue(query, 'per_page', 20);
  return api.get<MarketplaceCollectionResponse<MarketplaceOffer>>(`${API_V2}/marketplace/my-offers/${mode}`, query);
}

export function acceptMarketplaceOffer(id: number): Promise<MarketplaceDataResponse<MarketplaceOffer>> {
  return api.put<MarketplaceDataResponse<MarketplaceOffer>>(`${API_V2}/marketplace/offers/${id}/accept`);
}

export function counterMarketplaceOffer(
  id: number,
  payload: { amount: number; message?: string | null },
): Promise<MarketplaceDataResponse<MarketplaceOffer>> {
  return api.put<MarketplaceDataResponse<MarketplaceOffer>>(`${API_V2}/marketplace/offers/${id}/counter`, payload);
}

export function acceptMarketplaceCounterOffer(id: number): Promise<MarketplaceDataResponse<MarketplaceOffer>> {
  return api.put<MarketplaceDataResponse<MarketplaceOffer>>(`${API_V2}/marketplace/offers/${id}/accept-counter`);
}

export function declineMarketplaceOffer(id: number): Promise<MarketplaceDataResponse<MarketplaceOffer>> {
  return api.put<MarketplaceDataResponse<MarketplaceOffer>>(`${API_V2}/marketplace/offers/${id}/decline`);
}

export function withdrawMarketplaceOffer(id: number): Promise<MarketplaceDataResponse<{ message: string }>> {
  return api.delete<MarketplaceDataResponse<{ message: string }>>(`${API_V2}/marketplace/offers/${id}`);
}

export function getMarketplaceOrders(
  mode: 'purchases' | 'sales',
  cursor?: string | null,
  status?: string | null,
): Promise<MarketplaceCollectionResponse<MarketplaceOrder>> {
  const query: Record<string, string> = {};
  addQueryValue(query, 'cursor', cursor);
  addQueryValue(query, 'limit', 20);
  addQueryValue(query, 'status', status);
  return api.get<MarketplaceCollectionResponse<MarketplaceOrder>>(`${API_V2}/marketplace/orders/${mode}`, query);
}

/** Fetch one order so a deep link can resolve whether this member is its buyer or seller. */
export function getMarketplaceOrder(id: number): Promise<MarketplaceDataResponse<MarketplaceOrder>> {
  return api.get<MarketplaceDataResponse<MarketplaceOrder>>(`${API_V2}/marketplace/orders/${id}`);
}

export function shipMarketplaceOrder(
  id: number,
  payload: { tracking_number?: string | null; tracking_url?: string | null; shipping_method?: string | null },
): Promise<MarketplaceDataResponse<MarketplaceOrder>> {
  return api.put<MarketplaceDataResponse<MarketplaceOrder>>(`${API_V2}/marketplace/orders/${id}/ship`, payload);
}

export function confirmMarketplaceOrderDelivery(id: number): Promise<MarketplaceDataResponse<MarketplaceOrder>> {
  return api.put<MarketplaceDataResponse<MarketplaceOrder>>(`${API_V2}/marketplace/orders/${id}/confirm-delivery`);
}

export function cancelMarketplaceOrder(id: number, reason: string): Promise<MarketplaceDataResponse<MarketplaceOrder>> {
  return api.put<MarketplaceDataResponse<MarketplaceOrder>>(`${API_V2}/marketplace/orders/${id}/cancel`, { reason });
}

export function rateMarketplaceOrder(
  id: number,
  payload: { rating: number; comment?: string | null; is_anonymous?: boolean },
): Promise<MarketplaceDataResponse<MarketplaceOrderRating>> {
  return api.post<MarketplaceDataResponse<MarketplaceOrderRating>>(`${API_V2}/marketplace/orders/${id}/rate`, payload);
}

export function disputeMarketplaceOrder(
  id: number,
  payload: { reason: string; description: string; evidence_urls?: string[] },
): Promise<MarketplaceDataResponse<MarketplaceOrderDispute>> {
  return api.post<MarketplaceDataResponse<MarketplaceOrderDispute>>(`${API_V2}/marketplace/orders/${id}/dispute`, payload);
}

export function getMarketplaceOrderRatings(id: number): Promise<MarketplaceDataResponse<MarketplaceOrderRating[]>> {
  return api.get<MarketplaceDataResponse<MarketplaceOrderRating[]>>(`${API_V2}/marketplace/orders/${id}/ratings`);
}

export function getMarketplaceDeliveryOffers(orderId: number): Promise<MarketplaceDataResponse<MarketplaceDeliveryOffer[]>> {
  return api.get<MarketplaceDataResponse<MarketplaceDeliveryOffer[]>>(`${API_V2}/marketplace/orders/${orderId}/delivery-offers`);
}

export function createMarketplaceDeliveryOffer(
  orderId: number,
  payload: { time_credits: number; estimated_minutes?: number | null; notes?: string | null },
): Promise<MarketplaceDataResponse<MarketplaceDeliveryOffer>> {
  return api.post<MarketplaceDataResponse<MarketplaceDeliveryOffer>>(`${API_V2}/marketplace/orders/${orderId}/delivery-offers`, payload);
}

export function acceptMarketplaceDeliveryOffer(
  orderId: number,
  delivererId: number,
): Promise<MarketplaceDataResponse<{ message: string }>> {
  return api.put<MarketplaceDataResponse<{ message: string }>>(`${API_V2}/marketplace/orders/${orderId}/delivery-offers/${delivererId}/accept`);
}

export function confirmMarketplaceDeliveryOffer(
  orderId: number,
  delivererId: number,
): Promise<MarketplaceDataResponse<{ message: string }>> {
  return api.put<MarketplaceDataResponse<{ message: string }>>(`${API_V2}/marketplace/orders/${orderId}/delivery-offers/${delivererId}/confirm`);
}

export function createMarketplaceOrder(payload: {
  listing_id: number;
  offer_id?: number;
  quantity?: number;
  idempotency_key: string;
  shipping_option_id?: number | null;
  shipping_method?: 'pickup' | 'community_delivery';
  pickup_slot_id?: number;
  coupon_code?: string;
  payment_method?: 'cash' | 'time_credits' | 'free';
}): Promise<MarketplaceDataResponse<MarketplaceOrder>> {
  return api.post<MarketplaceDataResponse<MarketplaceOrder>>(`${API_V2}/marketplace/orders`, payload);
}

export function createMarketplacePaymentIntent(orderId: number): Promise<MarketplaceDataResponse<MarketplacePaymentIntent>> {
  return api.post<MarketplaceDataResponse<MarketplacePaymentIntent>>(`${API_V2}/marketplace/payments/create-intent`, {
    order_id: orderId,
  });
}

export function confirmMarketplacePayment(paymentIntentId: string): Promise<MarketplaceDataResponse<{
  payment_id: number;
  status: string;
  amount: number;
  currency: string;
  order_id: number;
}>> {
  return api.post<MarketplaceDataResponse<{
    payment_id: number;
    status: string;
    amount: number;
    currency: string;
    order_id: number;
  }>>(`${API_V2}/marketplace/payments/confirm`, {
    payment_intent_id: paymentIntentId,
  });
}

export function getMarketplaceListingPickupSlots(
  listingId: number,
  acceptedOfferId?: number | null,
): Promise<MarketplaceDataResponse<MarketplacePickupSlotOption[]>> {
  const endpoint = `${API_V2}/marketplace/listings/${listingId}/pickup-slots`;
  return acceptedOfferId
    ? api.get<MarketplaceDataResponse<MarketplacePickupSlotOption[]>>(endpoint, { offer_id: String(acceptedOfferId) })
    : api.get<MarketplaceDataResponse<MarketplacePickupSlotOption[]>>(endpoint);
}

export function reserveMarketplacePickup(orderId: number, slotId: number): Promise<MarketplaceDataResponse<MarketplacePickupReservation>> {
  return api.post<MarketplaceDataResponse<MarketplacePickupReservation>>(`${API_V2}/marketplace/orders/${orderId}/pickup-reservation`, {
    slot_id: slotId,
  });
}

export function validateMarketplaceCoupon(payload: {
  code: string;
  listing_id: number;
  shipping_option_id?: number;
  order_total_cents?: number;
}): Promise<MarketplaceDataResponse<{
  discount_amount: number;
  discount_cents: number;
  currency: string;
}>> {
  return api.post<MarketplaceDataResponse<{
    discount_amount: number;
    discount_cents: number;
    currency: string;
  }>>(`${API_V2}/coupons/validate`, payload);
}

export function getMerchantOnboardingStatus(): Promise<MarketplaceDataResponse<MerchantOnboardingStatus>> {
  return api.get<MarketplaceDataResponse<MerchantOnboardingStatus>>(`${API_V2}/merchant-onboarding/status`);
}

export function saveMerchantOnboardingStep1(payload: {
  seller_type: 'private' | 'business';
  business_name?: string | null;
  display_name: string;
  bio: string;
  business_registration?: string | null;
}): Promise<MarketplaceDataResponse<{ profile: MerchantSellerProfile }>> {
  return api.post<MarketplaceDataResponse<{ profile: MerchantSellerProfile }>>(`${API_V2}/merchant-onboarding/step-1`, payload);
}

export function saveMerchantOnboardingStep2(payload: {
  business_address: Record<string, string>;
  opening_hours?: Record<string, { open: string; close: string } | null>;
}): Promise<MarketplaceDataResponse<{ profile: MerchantSellerProfile }>> {
  return api.post<MarketplaceDataResponse<{ profile: MerchantSellerProfile }>>(`${API_V2}/merchant-onboarding/step-2`, payload);
}

export function saveMerchantOnboardingStep3(payload: {
  avatar_url: string;
  cover_image_url?: string | null;
}): Promise<MarketplaceDataResponse<{ profile: MerchantSellerProfile }>> {
  return api.post<MarketplaceDataResponse<{ profile: MerchantSellerProfile }>>(`${API_V2}/merchant-onboarding/step-3`, payload);
}

export function completeMerchantOnboarding(): Promise<MarketplaceDataResponse<MerchantSellerProfile & { badge_granted?: boolean }>> {
  return api.post<MarketplaceDataResponse<MerchantSellerProfile & { badge_granted?: boolean }>>(`${API_V2}/merchant-onboarding/complete`, {});
}

export function getMarketplaceStripeOnboardingStatus(): Promise<MarketplaceDataResponse<MarketplaceStripeOnboardingStatus>> {
  return api.get<MarketplaceDataResponse<MarketplaceStripeOnboardingStatus>>(`${API_V2}/marketplace/seller/onboard/status`);
}

export function getMarketplaceSellerBalance(): Promise<MarketplaceDataResponse<MarketplaceSellerBalance>> {
  return api.get<MarketplaceDataResponse<MarketplaceSellerBalance>>(`${API_V2}/marketplace/seller/balance`);
}

export function getMarketplaceSellerPayouts(page = 1, limit = 20): Promise<MarketplaceCollectionResponse<MarketplaceSellerPayout>> {
  const query: Record<string, string> = {};
  addQueryValue(query, 'page', page);
  addQueryValue(query, 'limit', limit);
  return api.get<MarketplaceCollectionResponse<MarketplaceSellerPayout>>(`${API_V2}/marketplace/seller/payouts`, query);
}

export function startMarketplaceStripeOnboarding(): Promise<MarketplaceDataResponse<{ account_id?: string; onboarding_url?: string; url?: string }>> {
  return api.post<MarketplaceDataResponse<{ account_id?: string; onboarding_url?: string; url?: string }>>(`${API_V2}/marketplace/seller/onboard`, {});
}

export function getMarketplaceSeller(id: number): Promise<MarketplaceDataResponse<MarketplaceSellerProfile>> {
  return api.get<MarketplaceDataResponse<MarketplaceSellerProfile>>(`${API_V2}/marketplace/sellers/${id}`);
}

export function getMarketplaceSellerListings(
  id: number,
  cursor?: string | null,
  perPage = 20,
): Promise<MarketplaceCollectionResponse<MarketplaceListingItem>> {
  const query: Record<string, string> = {};
  addQueryValue(query, 'cursor', cursor);
  addQueryValue(query, 'per_page', perPage);
  return api.get<MarketplaceCollectionResponse<MarketplaceListingItem>>(`${API_V2}/marketplace/sellers/${id}/listings`, query);
}

export function getMarketplaceDashboard(): Promise<MarketplaceDataResponse<MarketplaceDashboard>> {
  return api.get<MarketplaceDataResponse<MarketplaceDashboard>>(`${API_V2}/marketplace/seller/dashboard`);
}

export function getGroupMarketplaceListings(
  groupId: number,
  params: {
    category_id?: number | null;
    search?: string | null;
    price_min?: number | string;
    price_max?: number | string;
    condition?: string | null;
    sort?: 'newest' | 'price_asc' | 'price_desc' | 'popular';
    cursor?: string | null;
    limit?: number;
  } = {},
): Promise<MarketplaceCollectionResponse<MarketplaceListingItem>> {
  const query: Record<string, string> = {};
  addQueryValue(query, 'category_id', params.category_id);
  addQueryValue(query, 'search', params.search);
  addQueryValue(query, 'price_min', params.price_min);
  addQueryValue(query, 'price_max', params.price_max);
  addQueryValue(query, 'condition', params.condition);
  addQueryValue(query, 'sort', params.sort ?? 'newest');
  addQueryValue(query, 'cursor', params.cursor);
  addQueryValue(query, 'limit', params.limit ?? 20);
  return api.get<MarketplaceCollectionResponse<MarketplaceListingItem>>(`${API_V2}/marketplace/groups/${groupId}/listings`, query);
}

export function getGroupMarketplaceStats(groupId: number): Promise<MarketplaceDataResponse<MarketplaceGroupStats>> {
  return api.get<MarketplaceDataResponse<MarketplaceGroupStats>>(`${API_V2}/marketplace/groups/${groupId}/stats`);
}

export function getMarketplaceSavedSearches(): Promise<MarketplaceDataResponse<MarketplaceSavedSearch[]>> {
  return api.get<MarketplaceDataResponse<MarketplaceSavedSearch[]>>(`${API_V2}/marketplace/saved-searches`);
}

export function createMarketplaceSavedSearch(payload: {
  name: string;
  search_query?: string | null;
  filters?: Record<string, unknown> | null;
  alert_frequency?: 'instant' | 'daily' | 'weekly';
  alert_channel?: 'email' | 'push' | 'both';
}): Promise<MarketplaceDataResponse<MarketplaceSavedSearch>> {
  return api.post<MarketplaceDataResponse<MarketplaceSavedSearch>>(`${API_V2}/marketplace/saved-searches`, payload);
}

export function deleteMarketplaceSavedSearch(id: number): Promise<MarketplaceDataResponse<{ deleted: boolean }>> {
  return api.delete<MarketplaceDataResponse<{ deleted: boolean }>>(`${API_V2}/marketplace/saved-searches/${id}`);
}

export function getMarketplaceCollections(): Promise<MarketplaceDataResponse<MarketplaceCollection[]>> {
  return api.get<MarketplaceDataResponse<MarketplaceCollection[]>>(`${API_V2}/marketplace/collections`);
}

export function createMarketplaceCollection(payload: {
  name: string;
  description?: string | null;
  is_public?: boolean;
}): Promise<MarketplaceDataResponse<MarketplaceCollection>> {
  return api.post<MarketplaceDataResponse<MarketplaceCollection>>(`${API_V2}/marketplace/collections`, payload);
}

export function deleteMarketplaceCollection(id: number): Promise<MarketplaceDataResponse<{ deleted: boolean }>> {
  return api.delete<MarketplaceDataResponse<{ deleted: boolean }>>(`${API_V2}/marketplace/collections/${id}`);
}

export function getMarketplaceCollectionItems(
  id: number,
  cursor?: string | null,
  limit = 20,
): Promise<MarketplaceCollectionResponse<MarketplaceCollectionItem>> {
  const query: Record<string, string> = {};
  addQueryValue(query, 'cursor', cursor);
  addQueryValue(query, 'limit', limit);
  return api.get<MarketplaceCollectionResponse<MarketplaceCollectionItem>>(`${API_V2}/marketplace/collections/${id}/items`, query);
}

export function addMarketplaceCollectionItem(id: number, listingId: number, note?: string | null): Promise<MarketplaceDataResponse<{ added: boolean }>> {
  return api.post<MarketplaceDataResponse<{ added: boolean }>>(`${API_V2}/marketplace/collections/${id}/items`, {
    listing_id: listingId,
    note,
  });
}

export function removeMarketplaceCollectionItem(id: number, listingId: number): Promise<MarketplaceDataResponse<{ deleted: boolean }>> {
  return api.delete<MarketplaceDataResponse<{ deleted: boolean }>>(`${API_V2}/marketplace/collections/${id}/items/${listingId}`);
}

export function getMarketplacePromotionProducts(): Promise<MarketplaceDataResponse<MarketplacePromotionProduct[]>> {
  return api.get<MarketplaceDataResponse<MarketplacePromotionProduct[]>>(`${API_V2}/marketplace/promotions/products`);
}

export function getMyMarketplacePromotions(): Promise<MarketplaceDataResponse<MarketplacePromotion[]>> {
  return api.get<MarketplaceDataResponse<MarketplacePromotion[]>>(`${API_V2}/marketplace/promotions/mine`);
}

export function promoteMarketplaceListing(id: number, promotionType: MarketplacePromotionProduct['type']): Promise<MarketplaceDataResponse<MarketplacePromotion>> {
  return api.post<MarketplaceDataResponse<MarketplacePromotion>>(`${API_V2}/marketplace/listings/${id}/promote`, {
    promotion_type: promotionType,
  });
}

export function getMarketplacePickupSlots(): Promise<MarketplaceDataResponse<MarketplacePickupSlot[]>> {
  return api.get<MarketplaceDataResponse<MarketplacePickupSlot[]>>(`${API_V2}/marketplace/seller/pickup-slots`);
}

export function getMarketplaceShippingOptions(): Promise<MarketplaceDataResponse<MarketplaceShippingOption[]>> {
  return api.get<MarketplaceDataResponse<MarketplaceShippingOption[]>>(`${API_V2}/marketplace/seller/shipping-options`);
}

export function getMarketplaceSellerShippingOptions(
  sellerUserId: number,
): Promise<MarketplaceDataResponse<MarketplaceShippingOption[]>> {
  return api.get<MarketplaceDataResponse<MarketplaceShippingOption[]>>(
    `${API_V2}/marketplace/sellers/${sellerUserId}/shipping-options`,
  );
}

export function createMarketplaceShippingOption(payload: {
  courier_name: string;
  courier_code?: string | null;
  price: number;
  currency?: string;
  estimated_days?: number | null;
  is_default?: boolean;
}): Promise<MarketplaceDataResponse<MarketplaceShippingOption>> {
  return api.post<MarketplaceDataResponse<MarketplaceShippingOption>>(`${API_V2}/marketplace/seller/shipping-options`, payload);
}

export function updateMarketplaceShippingOption(
  id: number,
  payload: Partial<{
    courier_name: string;
    courier_code: string | null;
    price: number;
    currency: string;
    estimated_days: number | null;
    is_default: boolean;
    is_active: boolean;
  }>,
): Promise<MarketplaceDataResponse<MarketplaceShippingOption>> {
  return api.put<MarketplaceDataResponse<MarketplaceShippingOption>>(`${API_V2}/marketplace/seller/shipping-options/${id}`, payload);
}

export function deleteMarketplaceShippingOption(id: number): Promise<void> {
  return api.delete<void>(`${API_V2}/marketplace/seller/shipping-options/${id}`);
}

export function createMarketplacePickupSlot(payload: {
  slot_start: string;
  slot_end: string;
  capacity?: number;
  is_recurring?: boolean;
  recurring_pattern?: string | null;
  is_active?: boolean;
}): Promise<MarketplaceDataResponse<MarketplacePickupSlot>> {
  return api.post<MarketplaceDataResponse<MarketplacePickupSlot>>(`${API_V2}/marketplace/seller/pickup-slots`, payload);
}

export function updateMarketplacePickupSlot(
  id: number,
  payload: Partial<{
    slot_start: string;
    slot_end: string;
    capacity: number;
    is_recurring: boolean;
    recurring_pattern: string | null;
    is_active: boolean;
  }>,
): Promise<MarketplaceDataResponse<MarketplacePickupSlot>> {
  return api.put<MarketplaceDataResponse<MarketplacePickupSlot>>(`${API_V2}/marketplace/seller/pickup-slots/${id}`, payload);
}

export function deleteMarketplacePickupSlot(id: number): Promise<MarketplaceDataResponse<{ deleted: boolean }>> {
  return api.delete<MarketplaceDataResponse<{ deleted: boolean }>>(`${API_V2}/marketplace/seller/pickup-slots/${id}`);
}

export function getMyMarketplacePickups(): Promise<MarketplaceDataResponse<MarketplacePickupReservation[]>> {
  return api.get<MarketplaceDataResponse<MarketplacePickupReservation[]>>(`${API_V2}/marketplace/me/pickups`);
}

export function scanMarketplacePickup(qrCode: string): Promise<MarketplaceDataResponse<MarketplacePickupReservation>> {
  return api.post<MarketplaceDataResponse<MarketplacePickupReservation>>(`${API_V2}/marketplace/seller/pickup-scan`, { qr_code: qrCode });
}

export function getMerchantCoupons(): Promise<MarketplaceDataResponse<{ items: MerchantCoupon[] }>> {
  return api.get<MarketplaceDataResponse<{ items: MerchantCoupon[] }>>(`${API_V2}/marketplace/seller/coupons`);
}

export function createMerchantCoupon(payload: {
  title: string;
  code?: string | null;
  description?: string | null;
  discount_type: 'percent' | 'fixed' | 'bogo';
  discount_value?: number | null;
  min_order_cents?: number | null;
  max_uses?: number | null;
  max_uses_per_member?: number | null;
  valid_from?: string | null;
  valid_until?: string | null;
  status?: 'draft' | 'active' | 'paused' | 'expired';
  applies_to?: 'all_listings' | 'listing_ids' | 'category_ids';
}): Promise<MarketplaceDataResponse<MerchantCoupon>> {
  return api.post<MarketplaceDataResponse<MerchantCoupon>>(`${API_V2}/marketplace/seller/coupons`, payload);
}

export function updateMerchantCoupon(
  id: number,
  payload: Partial<{
    code: string | null;
    title: string;
    description: string | null;
    discount_type: 'percent' | 'fixed' | 'bogo';
    discount_value: number | null;
    min_order_cents: number | null;
    max_uses: number | null;
    max_uses_per_member: number | null;
    valid_from: string | null;
    valid_until: string | null;
    status: 'draft' | 'active' | 'paused' | 'expired';
    applies_to: 'all_listings' | 'listing_ids' | 'category_ids';
  }>,
): Promise<MarketplaceDataResponse<MerchantCoupon>> {
  return api.put<MarketplaceDataResponse<MerchantCoupon>>(`${API_V2}/marketplace/seller/coupons/${id}`, payload);
}

export function deleteMerchantCoupon(id: number): Promise<MarketplaceDataResponse<{ deleted: boolean }>> {
  return api.delete<MarketplaceDataResponse<{ deleted: boolean }>>(`${API_V2}/marketplace/seller/coupons/${id}`);
}

export function getMerchantCouponRedemptions(id: number): Promise<MarketplaceDataResponse<{ items: MerchantCouponRedemption[] }>> {
  return api.get<MarketplaceDataResponse<{ items: MerchantCouponRedemption[] }>>(`${API_V2}/marketplace/seller/coupons/${id}/redemptions`);
}

export function getPublicMerchantCoupons(): Promise<MarketplaceDataResponse<{ items: PublicMerchantCoupon[] }>> {
  return api.get<MarketplaceDataResponse<{ items: PublicMerchantCoupon[] }>>(`${API_V2}/coupons`);
}

export function getPublicMerchantCoupon(id: number): Promise<MarketplaceDataResponse<PublicMerchantCoupon>> {
  return api.get<MarketplaceDataResponse<PublicMerchantCoupon>>(`${API_V2}/coupons/${id}`);
}

export function generatePublicMerchantCouponQr(id: number): Promise<MarketplaceDataResponse<MerchantCouponQrPayload>> {
  return api.post<MarketplaceDataResponse<MerchantCouponQrPayload>>(`${API_V2}/coupons/${id}/qr`, {});
}

export function redeemPublicMerchantCouponQr(token: string): Promise<MarketplaceDataResponse<MerchantCouponQrRedemptionResult>> {
  return api.post<MarketplaceDataResponse<MerchantCouponQrRedemptionResult>>(`${API_V2}/coupons/redeem-qr`, { token });
}

export function marketplaceNextCursor<T>(response: MarketplaceCollectionResponse<T>): string | null {
  const meta = collectionMeta(response);
  return meta.cursor ?? meta.next_cursor ?? null;
}

export function marketplaceHasMore<T>(response: MarketplaceCollectionResponse<T>): boolean {
  const meta = collectionMeta(response);
  return Boolean(meta.has_more);
}
