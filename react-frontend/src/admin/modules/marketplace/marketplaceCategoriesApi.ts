// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Marketplace & Freecycle — admin category endpoints.
 *
 * Lives beside the dashboard rather than in `admin/api/adminApi.ts` because
 * that file was mid-edit in another session when this feature landed
 * (17 Oct 2026). It uses the shared `api` client exactly as
 * MarketplaceAdmin.tsx does, so moving it later is a cut-and-paste.
 *
 * Contract: AdminMarketplaceCategoryController (routes/api-marketplace-admin.php).
 */

import { api, type ApiResponse } from '@/lib/api';

export interface MarketplaceAdminCategory {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  parent_id: number | null;
  sort_order: number;
  is_active: boolean;
  /** Shared platform category (tenant_id NULL) — read-only for every community. */
  is_platform: boolean;
  /** Active listings in this community using the category. */
  listing_count: number;
  updated_at: string | null;
}

export interface MarketplaceCategoryInput {
  name?: string;
  description?: string | null;
  icon?: string | null;
  parent_id?: number | null;
  sort_order?: number;
  is_active?: boolean;
}

/** Server error code when a delete is refused because listings still use the category. */
export const CATEGORY_IN_USE = 'CATEGORY_IN_USE';
/** Server error code when a write targets a shared platform category. */
export const CATEGORY_READ_ONLY = 'CATEGORY_READ_ONLY';

const BASE = '/v2/admin/marketplace/categories';

export const marketplaceCategoriesApi = {
  list: (): Promise<ApiResponse<MarketplaceAdminCategory[]>> =>
    api.get<MarketplaceAdminCategory[]>(BASE),

  create: (input: MarketplaceCategoryInput): Promise<ApiResponse<MarketplaceAdminCategory>> =>
    api.post<MarketplaceAdminCategory>(BASE, input),

  update: (id: number, input: MarketplaceCategoryInput): Promise<ApiResponse<MarketplaceAdminCategory>> =>
    api.put<MarketplaceAdminCategory>(`${BASE}/${id}`, input),

  reorder: (ids: number[]): Promise<ApiResponse<{ reordered: number }>> =>
    api.put<{ reordered: number }>(`${BASE}/reorder`, { ids }),

  remove: (id: number): Promise<ApiResponse<{ deleted: number }>> =>
    api.delete<{ deleted: number }>(`${BASE}/${id}`),
};
