// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export interface Organisation {
  id: number;
  name: string;
  description: string | null;
  /**
   * 🔴 `GET /v2/volunteering/organisations/{id}` sends `logo_url`, not `logo` — measured
   * 2026-08-24. Both are kept because the list and detail endpoints have differed in the
   * past, and every consumer already reads `logo ?? logo_url`.
   */
  logo?: string | null;
  logo_url?: string | null;
  website: string | null;
  contact_email?: string | null;
  /** NOT sent by the organisation endpoints — measured 2026-08-24. */
  location?: string | null;
  members_count?: number;
  listings_count?: number;
  opportunity_count?: number;
  total_hours?: number;
  volunteer_count?: number;
  average_rating?: number | null;
  verified?: boolean;
  status?: string | null;
  created_at: string;
}

export interface OrganisationsResponse {
  data: Organisation[];
  meta: {
    has_more: boolean;
    cursor: string | null;
  };
}

export interface CreateOrganisationPayload {
  name: string;
  description: string;
  contact_email: string;
  website?: string;
}

/**
 * GET /api/v2/volunteering/organisations — list organisations for the current tenant.
 * Supports cursor-based pagination and optional full-text search.
 */
export function getOrganisations(
  cursor: string | null,
  search?: string,
): Promise<OrganisationsResponse> {
  return api.get<OrganisationsResponse>(`${API_V2}/volunteering/organisations`, {
    ...(cursor ? { cursor } : {}),
    ...(search ? { search } : {}),
  });
}

/**
 * GET /api/v2/volunteering/organisations/{id} — get a single organisation by ID.
 */
export function getOrganisation(id: number): Promise<{ data: Organisation }> {
  return api.get<{ data: Organisation }>(`${API_V2}/volunteering/organisations/${id}`);
}

/**
 * POST /api/v2/volunteering/organisations — register a new volunteer organisation.
 */
export function createOrganisation(payload: CreateOrganisationPayload): Promise<{ data: Organisation }> {
  return api.post<{ data: Organisation }>(`${API_V2}/volunteering/organisations`, payload);
}
