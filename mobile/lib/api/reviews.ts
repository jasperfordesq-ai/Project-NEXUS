// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export interface ReviewUser {
  id?: number | string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar?: string | null;
  avatar_url?: string | null;
}

export interface ReviewItem {
  id: number;
  rating: number;
  comment?: string | null;
  is_anonymous?: boolean;
  reviewer?: ReviewUser | null;
  reviewer_id?: number | string | null;
  receiver_id?: number | string | null;
  created_at: string;
  is_liked?: boolean;
  likes_count?: number;
  comments_count?: number;
  direction?: 'received' | 'given';
}

export interface PendingReview {
  exchange_id: number;
  exchange_title?: string | null;
  receiver_id: number;
  receiver_name: string;
  receiver_avatar?: string | null;
  transaction_id?: number | null;
  completed_at?: string | null;
}

export interface ReviewsPage {
  items: ReviewItem[];
  cursor: string | null;
  hasMore: boolean;
}

interface CollectionEnvelope {
  data?: ReviewItem[] | {
    items?: ReviewItem[];
    cursor?: string | null;
    has_more?: boolean;
  };
  items?: ReviewItem[];
  cursor?: string | null;
  has_more?: boolean;
  meta?: {
    cursor?: string | null;
    next_cursor?: string | null;
    has_more?: boolean;
  } | null;
}

type PendingEnvelope = PendingReview[] | { data?: PendingReview[] | { items?: PendingReview[] }; items?: PendingReview[] };

export async function getUserReviews(
  userId: number,
  options: { cursor?: string | null; perPage?: number } = {},
): Promise<ReviewsPage> {
  const params: Record<string, string> = { per_page: String(options.perPage ?? 20) };
  if (options.cursor) params.cursor = options.cursor;

  const response = await api.get<CollectionEnvelope>(`${API_V2}/reviews/user/${userId}`, params);
  const payload = response.data;
  const dataObject = !Array.isArray(payload) && payload ? payload : response;
  const items = Array.isArray(payload) ? payload : dataObject.items ?? [];

  return {
    items,
    cursor: dataObject.cursor ?? response.meta?.next_cursor ?? response.meta?.cursor ?? null,
    hasMore: dataObject.has_more ?? response.meta?.has_more ?? false,
  };
}

/**
 * GET /api/v2/reviews/given — the reviews the signed-in member has WRITTEN.
 *
 * 🔴 The Reviews screen used to derive its "Given" tab by filtering the received list, and
 * `ReviewService::getForUser()` scopes that query to `receiver_id` — so every row in it is
 * a review the member RECEIVED and the filter could never match. A member who had written
 * twenty reviews was told they had written none, and because Delete only renders on that
 * tab, they could never remove one either. This is the endpoint that answers the other
 * direction; it is registered ahead of `/v2/reviews/{id}` specifically so it resolves.
 * Found by the 2026-09-07 audit (F/F-2).
 */
export async function getGivenReviews(
  options: { cursor?: string | null; perPage?: number } = {},
): Promise<ReviewsPage> {
  const params: Record<string, string> = { per_page: String(options.perPage ?? 20) };
  if (options.cursor) params.cursor = options.cursor;

  const response = await api.get<CollectionEnvelope>(`${API_V2}/reviews/given`, params);
  const payload = response.data;
  const dataObject = !Array.isArray(payload) && payload ? payload : response;
  const items = Array.isArray(payload) ? payload : dataObject.items ?? [];

  return {
    items,
    cursor: dataObject.cursor ?? response.meta?.next_cursor ?? response.meta?.cursor ?? null,
    hasMore: dataObject.has_more ?? response.meta?.has_more ?? false,
  };
}

export async function getPendingReviews(): Promise<PendingReview[]> {
  const response = await api.get<PendingEnvelope>(`${API_V2}/reviews/pending`);
  const payload = Array.isArray(response) ? response : response.data ?? response.items ?? [];
  return Array.isArray(payload) ? payload : payload.items ?? [];
}

export function createReview(payload: {
  receiver_id: number;
  rating: number;
  comment?: string;
  transaction_id?: number;
}): Promise<unknown> {
  return api.post(`${API_V2}/reviews`, payload);
}

export function deleteReview(id: number): Promise<unknown> {
  return api.delete(`${API_V2}/reviews/${id}`);
}
