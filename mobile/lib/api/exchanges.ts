// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import i18n from 'i18next';
import { api, ApiResponseError } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';
import { Platform } from 'react-native';

export type ExchangeType = 'offer' | 'request';
export type ExchangeStatus = 'active' | 'expired' | 'deleted' | null;

export interface RelatedExchange {
  id: number;
  title: string;
  type: string;
  hours_estimate?: number | null;
}

export interface ExchangeCategory {
  id: number;
  name: string;
  slug?: string;
  color?: string | null;
}

export interface ExchangeImage {
  id: number;
  url: string;
  sort_order?: number | null;
  alt_text?: string | null;
}

export interface Exchange {
  id: number;
  title: string;
  description: string;
  type: ExchangeType;
  status: ExchangeStatus;
  /** Time estimate in hours (hours_estimate from backend) */
  hours_estimate: number | null;
  category_name: string | null;
  category_color: string | null;
  category_id?: number | null;
  image_url: string | null;
  images?: ExchangeImage[];
  location: string | null;
  distance_km?: number | null;
  service_type?: 'physical_only' | 'remote_only' | 'hybrid' | 'location_dependent' | null;
  skill_tags?: string[];
  user_id?: number;
  estimated_hours?: number | null;
  expires_at?: string | null;
  renewed_at?: string | null;
  renewal_count?: number;
  views_count?: number;
  view_count?: number;
  save_count?: number;
  contact_count?: number;
  responses_count?: number;
  author_name?: string;
  author_avatar?: string | null;
  author_verified?: boolean;
  author_rating?: number;
  author_reviews_count?: number;
  author_exchanges_count?: number;
  member_offers?: RelatedExchange[];
  member_requests?: RelatedExchange[];
  is_liked?: boolean;
  likes_count?: number;
  comments_count?: number;
  is_reported?: boolean;
  /**
   * 🔴 NULLABLE, because the server really does send `user: null` — seen in production on
   * 2026-08-25 for a listing whose `user_id` no longer resolves, alongside
   * `author_name: "Unknown"`. This was typed as always-present, so every reader was written
   * as though it could be trusted, and `ExchangeCard` quietly substituted a literal '?'.
   * The `author_*` fields below are the server's answer for exactly this case.
   */
  user?: {
    id: number;
    name?: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string | null;
    avatar?: string | null;
    tagline?: string | null;
    average_rating?: number | null;
    reviews_count?: number | null;
    member_since?: string | null;
  };
  created_at: string;
  is_favorited: boolean;
}

export interface ExchangeListResponse {
  data: Exchange[];
  meta: {
    per_page: number;
    has_more: boolean;
    cursor: string | null;
    total_items?: number;
    base_url?: string;
  };
}

export interface CreateExchangePayload {
  title: string;
  description: string;
  type: ExchangeType;
  hours_estimate?: number;
  category_id: number;
  location?: string;
  service_type?: 'physical_only' | 'remote_only' | 'hybrid' | 'location_dependent';
}

export interface ExchangeWorkflowStatus {
  exchange_workflow_enabled: boolean;
}

export interface ActiveExchange {
  id: number;
  status: string;
  role: string;
  proposed_hours: number;
}

export interface CreateExchangeRequestPayload {
  listing_id: number;
  proposed_hours?: number | null;
  prep_time?: number | null;
  message?: string | null;
}

export interface ExchangeLikeResult {
  liked: boolean;
  likes_count: number;
}

export interface ExchangeComment {
  id: number;
  content: string;
  created_at: string;
  edited?: boolean;
  author: {
    id: number;
    name: string;
    avatar_url?: string | null;
    avatar?: string | null;
  };
}

export interface ExchangeCommentsResponse {
  comments: ExchangeComment[];
  count: number;
}

export interface ReportExchangePayload {
  reason: string;
  details?: string;
}

export interface GenerateExchangeDescriptionPayload {
  title: string;
  category?: string;
  type?: ExchangeType;
  notes?: string;
}

/** GET /api/v2/listings — all open exchanges for the current tenant (cursor-based) */
export function getExchanges(
  cursor: string | null = null,
  params?: Record<string, string>,
): Promise<ExchangeListResponse> {
  return api.get<ExchangeListResponse>(`${API_V2}/listings`, {
    ...(cursor ? { cursor } : {}),
    ...params,
  });
}

/** GET /api/v2/listings/:id */
export function getExchange(id: number): Promise<{ data: Exchange }> {
  return api.get<{ data: Exchange }>(`${API_V2}/listings/${id}`);
}

export function getExchangeCategories(): Promise<{ data: ExchangeCategory[] }> {
  return api.get<{ data: ExchangeCategory[] }>(`${API_V2}/categories`, { type: 'listing' });
}

/** POST /api/v2/listings */
export function createExchange(payload: CreateExchangePayload): Promise<{ data: Exchange }> {
  return api.post<{ data: Exchange }>(`${API_V2}/listings`, payload);
}

/** PUT /api/v2/listings/:id/tags */
export function setExchangeTags(id: number, tags: string[]): Promise<{ data?: unknown }> {
  return api.put<{ data?: unknown }>(`${API_V2}/listings/${id}/tags`, { tags });
}

/** GET /api/v2/exchanges/config */
export function getExchangeWorkflowConfig(): Promise<{ data: ExchangeWorkflowStatus } | ExchangeWorkflowStatus> {
  return api.get<{ data: ExchangeWorkflowStatus } | ExchangeWorkflowStatus>(`${API_V2}/exchanges/config`);
}

/** GET /api/v2/exchanges/check?listing_id=:id */
export function checkActiveExchange(listingId: number): Promise<{ data: ActiveExchange | null } | ActiveExchange | null> {
  return api.get<{ data: ActiveExchange | null } | ActiveExchange | null>(`${API_V2}/exchanges/check`, { listing_id: String(listingId) });
}

/** POST /api/v2/exchanges */
export function createExchangeRequest(payload: CreateExchangeRequestPayload): Promise<{ data: ActiveExchange }> {
  return api.post<{ data: ActiveExchange }>(`${API_V2}/exchanges`, payload);
}

export function saveExchange(id: number): Promise<{ data?: unknown }> {
  return api.post<{ data?: unknown }>(`${API_V2}/listings/${id}/save`, {});
}

export function unsaveExchange(id: number): Promise<void> {
  return api.delete<void>(`${API_V2}/listings/${id}/save`);
}

export function renewExchange(id: number): Promise<{ data?: { renewed?: boolean; new_expires_at?: string } }> {
  return api.post<{ data?: { renewed?: boolean; new_expires_at?: string } }>(`${API_V2}/listings/${id}/renew`, {});
}

export function toggleExchangeLike(id: number): Promise<{ data?: ExchangeLikeResult; success?: boolean; status?: string; action?: string; likes_count?: number }> {
  return api.post<{ data?: ExchangeLikeResult; success?: boolean; status?: string; action?: string; likes_count?: number }>(`${API_V2}/feed/like`, {
    target_type: 'listing',
    target_id: id,
  });
}

export function getExchangeComments(id: number): Promise<{ data?: ExchangeCommentsResponse } | ExchangeCommentsResponse> {
  return api.get<{ data?: ExchangeCommentsResponse } | ExchangeCommentsResponse>(`${API_V2}/comments`, {
    target_type: 'listing',
    target_id: String(id),
  });
}

export function submitExchangeComment(id: number, content: string): Promise<{ data?: ExchangeComment }> {
  return api.post<{ data?: ExchangeComment }>(`${API_V2}/comments`, {
    target_type: 'listing',
    target_id: id,
    content,
  });
}

export function reportExchange(id: number, payload: ReportExchangePayload): Promise<{ data?: unknown; success?: boolean; code?: string }> {
  return api.post<{ data?: unknown; success?: boolean; code?: string }>(`${API_V2}/listings/${id}/report`, payload);
}

export function generateExchangeDescription(payload: GenerateExchangeDescriptionPayload): Promise<{ data: { description: string } }> {
  return api.post<{ data: { description: string } }>(`${API_V2}/listings/generate-description`, payload);
}

/** PUT /api/v2/listings/:id */
export function updateExchange(
  id: number,
  payload: Partial<CreateExchangePayload>,
): Promise<{ data: Exchange }> {
  return api.put<{ data: Exchange }>(`${API_V2}/listings/${id}`, payload);
}

type UploadExchangeImageResponse = {
  data?: { image_url?: string | null } | null;
  image_url?: string | null;
  message?: string;
};

function getUploadFilename(uri: string): string {
  const cleanUri = uri.split('?')[0] ?? uri;
  const lastSegment = cleanUri.split('/').pop();
  return lastSegment && lastSegment.includes('.') ? lastSegment : 'listing.jpg';
}

function getMimeType(filename: string, fallback?: string | null): string {
  if (fallback?.startsWith('image/')) return fallback;
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  return 'image/jpeg';
}

async function appendExchangeImageFile(formData: FormData, uri: string): Promise<void> {
  const filename = getUploadFilename(uri);

  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    const type = getMimeType(filename, blob.type);

    if (typeof File !== 'undefined') {
      formData.append('image', new File([blob], filename, { type }));
      return;
    }

    formData.append('image', blob, filename);
    return;
  }

  const type = getMimeType(filename);
  formData.append('image', { uri, name: filename, type } as unknown as Blob);
}

export async function uploadExchangeImage(id: number, uri: string): Promise<{ data: { image_url: string } }> {
  const formData = new FormData();
  await appendExchangeImageFile(formData, uri);

  const response = await api.upload<UploadExchangeImageResponse>(`${API_V2}/listings/${id}/image`, formData);
  const imageUrl = response.data?.image_url ?? response.image_url ?? null;

  if (!imageUrl) {
    throw new ApiResponseError(502, response.message ?? i18n.t('common:errors.uploadIncomplete'));
  }

  return { data: { image_url: imageUrl } };
}

export function deleteExchangeImage(id: number): Promise<void> {
  return api.delete<void>(`${API_V2}/listings/${id}/image`);
}

/** DELETE /api/v2/listings/:id */
export function deleteExchange(id: number): Promise<void> {
  return api.delete<void>(`${API_V2}/listings/${id}`);
}
