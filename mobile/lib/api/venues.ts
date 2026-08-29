// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export interface PartnerVenue {
  id: number;
  name: string;
  slug?: string;
  category?: string | null;
  description?: string | null;
  offer_summary?: string | null;
  logo_url?: string | null;
  address_line?: string | null;
  city?: string | null;
  postcode?: string | null;
  website?: string | null;
}

export interface PartnerVenuePass {
  token: string;
  qr_url: string;
  status: string;
  last_used_at: string | null;
}

export interface PartnerVenueVisit {
  id: number;
  venue_id: number;
  venue_name: string;
  category?: string | null;
  visited_on: string;
  visited_at?: string | null;
}

export interface PartnerVenueVisitResult {
  status: 'recorded' | 'already_recorded_today' | 'needs_venue';
  member?: { id: number; name: string; avatar_url?: string | null };
  venue?: { id: number; name: string };
  venues?: { id: number; name: string }[];
  visits_this_month?: number;
  completed_challenges?: { id: number; title: string; xp_reward: number }[];
}

function unwrap<T>(response: T | { data: T }): T {
  return response && typeof response === 'object' && 'data' in response
    ? (response as { data: T }).data
    : response as T;
}

export async function getPartnerVenues(): Promise<PartnerVenue[]> {
  const result = unwrap(await api.get<{ data: { venues: PartnerVenue[] } } | { venues: PartnerVenue[] }>(`${API_V2}/partner-venues`));
  return result.venues ?? [];
}

export async function getPartnerVenuePass(): Promise<PartnerVenuePass> {
  return unwrap(await api.get<PartnerVenuePass | { data: PartnerVenuePass }>(`${API_V2}/partner-venues/pass`));
}

export async function rotatePartnerVenuePass(): Promise<PartnerVenuePass> {
  return unwrap(await api.post<PartnerVenuePass | { data: PartnerVenuePass }>(`${API_V2}/partner-venues/pass/rotate`, {}));
}

export async function getPartnerVenueVisits(): Promise<PartnerVenueVisit[]> {
  const result = unwrap(await api.get<{ data: { visits: PartnerVenueVisit[] } } | { visits: PartnerVenueVisit[] }>(`${API_V2}/partner-venues/my-visits`));
  return result.visits ?? [];
}

export async function recordPartnerVenueVisit(token: string, venueId?: number): Promise<PartnerVenueVisitResult> {
  return unwrap(await api.post<PartnerVenueVisitResult | { data: PartnerVenueVisitResult }>(
    `${API_V2}/partner-venues/visits/verify/${encodeURIComponent(token)}`,
    venueId ? { venue_id: venueId } : {},
  ));
}
