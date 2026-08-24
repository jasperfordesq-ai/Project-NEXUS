// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';
import type { Exchange } from '@/lib/api/exchanges';

export interface Member {
  id: number;
  /** May be empty string — use first_name + last_name as fallback */
  name: string;
  first_name: string;
  /**
   * 🔴 NOT sent by `GET /v2/users/{id}` — measured 2026-08-24. That is deliberate: another
   * member sees `name` and `first_name`, and surnames are withheld. Declaring it required
   * promised a value that is always `undefined`.
   */
  last_name?: string;
  /** List endpoint returns `avatar`; single-user endpoint returns `avatar_url` */
  avatar?: string | null;
  avatar_url?: string | null;
  tagline: string | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  /** NOT sent by `GET /v2/users/{id}` — measured 2026-08-24. */
  is_verified?: boolean;
  rating: number | null;
  total_hours_given: number;
  total_hours_received: number;
}

export interface MemberListResponse {
  data: Member[];
  meta: {
    total_items: number;
    per_page: number;
    offset: number;
    has_more: boolean;
  };
}

export interface MemberReview {
  id: number | string;
  reviewer?: {
    id?: number | string | null;
    first_name?: string;
    last_name?: string;
    name?: string;
    avatar?: string | null;
    avatar_url?: string | null;
  } | null;
  rating: number;
  comment?: string | null;
  listing_id?: number | null;
  listing_title?: string | null;
  created_at: string;
  partner?: {
    id?: number | string;
    name: string;
    slug?: string | null;
  } | null;
  verified?: boolean;
}

/** GET /api/v2/users — paginated member directory for the current tenant */
export function getMembers(
  offset = 0,
  search?: string,
): Promise<MemberListResponse> {
  const params: Record<string, string> = { offset: String(offset) };
  if (search) params.q = search;
  return api.get<MemberListResponse>(`${API_V2}/users`, params);
}

/** GET /api/v2/users/:id */
export function getMember(id: number): Promise<{ data: Member }> {
  return api.get<{ data: Member }>(`${API_V2}/users/${id}`);
}

/** GET /api/v2/users/:id/listings */
export function getMemberListings(id: number, limit = 6): Promise<{ data: Exchange[] }> {
  return api.get<{ data: Exchange[] }>(`${API_V2}/users/${id}/listings`, { limit: String(limit) });
}

/** GET /api/v2/reviews/user/:id */
export function getMemberReviews(id: number, perPage = 6): Promise<{ data: MemberReview[] }> {
  return api.get<{ data: MemberReview[] }>(`${API_V2}/reviews/user/${id}`, { per_page: String(perPage) });
}
