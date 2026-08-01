// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner venues API — member pass, venue directory, staff-side visit
 * recording, and tenant-admin management.
 *
 * Engagement recording only: nothing here issues a coupon, prices a discount,
 * or moves credits.
 */

import { api, type ApiResponse } from '@/lib/api';

export interface PartnerVenue {
  id: number;
  name: string;
  slug?: string | null;
  description?: string | null;
  category?: string | null;
  offer_summary?: string | null;
  address_line?: string | null;
  city?: string | null;
  postcode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  website?: string | null;
  logo_url?: string | null;
}

export interface PartnerVenueAdminRow extends PartnerVenue {
  status: string;
  contact_email?: string | null;
  visit_count: number;
  member_count: number;
  staff_count: number;
}

export interface MemberPass {
  token: string;
  qr_url: string;
  status: string;
  last_used_at?: string | null;
}

export interface MyVisit {
  id: number;
  venue_id: number;
  venue_name: string;
  category?: string | null;
  visited_on: string;
  visited_at?: string | null;
}

export interface CompletedChallenge {
  id: number;
  title: string;
  xp_reward: number;
}

export interface RecordVisitResult {
  status: 'recorded' | 'already_recorded_today' | 'needs_venue';
  member?: { id: number; name: string; avatar_url?: string | null };
  venue?: { id: number; name: string };
  venues?: Array<{ id: number; name: string }>;
  visits_this_month?: number;
  xp_awarded?: number;
  completed_challenges?: CompletedChallenge[];
}

export interface VenueStaffRow {
  id: number;
  user_id: number;
  name: string;
  avatar_url?: string | null;
  role: string;
  status: string;
}

export interface VenueSummary {
  window_days: number;
  total_visits: number;
  venues: Array<{
    venue_id: number;
    venue_name: string;
    total_visits: number;
    unique_members: number;
    recent_visits: number;
  }>;
}

export const partnerVenuesApi = {
  directory: (): Promise<ApiResponse<{ venues: PartnerVenue[] }>> =>
    api.get('/v2/partner-venues'),

  pass: (): Promise<ApiResponse<MemberPass>> => api.get('/v2/partner-venues/pass'),

  rotatePass: (): Promise<ApiResponse<MemberPass>> =>
    api.post('/v2/partner-venues/pass/rotate', {}),

  myVisits: (): Promise<ApiResponse<{ visits: MyVisit[] }>> =>
    api.get('/v2/partner-venues/my-visits'),

  recordVisit: (token: string, venueId?: number): Promise<ApiResponse<RecordVisitResult>> =>
    api.post(
      `/v2/partner-venues/visits/verify/${encodeURIComponent(token)}`,
      venueId ? { venue_id: venueId } : {},
    ),

  // Tenant admin
  adminList: (status?: string): Promise<ApiResponse<{ venues: PartnerVenueAdminRow[] }>> =>
    api.get(`/v2/admin/partner-venues${status ? `?status=${encodeURIComponent(status)}` : ''}`),

  adminCreate: (payload: Partial<PartnerVenue>): Promise<ApiResponse<PartnerVenue>> =>
    api.post('/v2/admin/partner-venues', payload),

  adminUpdate: (id: number, payload: Partial<PartnerVenue>): Promise<ApiResponse<PartnerVenue>> =>
    api.put(`/v2/admin/partner-venues/${id}`, payload),

  adminArchive: (id: number): Promise<ApiResponse<{ message: string }>> =>
    api.post(`/v2/admin/partner-venues/${id}/archive`, {}),

  adminStaff: (id: number): Promise<ApiResponse<{ staff: VenueStaffRow[] }>> =>
    api.get(`/v2/admin/partner-venues/${id}/staff`),

  adminAddStaff: (id: number, userId: number, role = 'member'): Promise<ApiResponse<{ staff: VenueStaffRow[] }>> =>
    api.post(`/v2/admin/partner-venues/${id}/staff`, { user_id: userId, role }),

  adminRemoveStaff: (id: number, userId: number): Promise<ApiResponse<{ staff: VenueStaffRow[] }>> =>
    api.delete(`/v2/admin/partner-venues/${id}/staff/${userId}`),

  adminSummary: (days = 30): Promise<ApiResponse<VenueSummary>> =>
    api.get(`/v2/admin/partner-venues/reports/summary?days=${days}`),

  adminExportCsv: (filters: { venueId?: number; from?: string; to?: string } = {}) => {
    const query = new URLSearchParams();
    if (filters.venueId) query.set('venue_id', String(filters.venueId));
    if (filters.from) query.set('from', filters.from);
    if (filters.to) query.set('to', filters.to);
    const suffix = query.toString();
    return api.download(`/v2/admin/partner-venues/visits/export.csv${suffix ? `?${suffix}` : ''}`);
  },
};
