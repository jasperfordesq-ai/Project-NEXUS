// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Public events API — the anonymous, read-only view of a community's events.
 *
 * The shape here mirrors the server's allowlist projection deliberately: it has
 * no RSVP state, no attendee data, no joining links and no organiser contact
 * details, because the public endpoint never sends them. Registration lives in
 * the authenticated events API.
 */

import { api, type ApiResponse } from '@/lib/api';

export interface PublicEventCategory {
  id: number;
  name: string | null;
  slug: string | null;
  color: string | null;
}

export interface PublicEvent {
  id: number;
  title: string | null;
  start_time: string | null;
  end_time: string | null;
  timezone: string | null;
  all_day: boolean;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  /** True when the event has ANY remote option (fully online or hybrid). */
  is_online: boolean;
  /** Mirrors the member contract's location.mode semantics. */
  attendance_mode: 'in_person' | 'online' | 'hybrid';
  /** Cancelled/postponed events stay listed but must say so. */
  operational_status: 'scheduled' | 'postponed' | 'cancelled' | 'completed';
  image_url: string | null;
  category: PublicEventCategory | null;
  organizer_name: string | null;
}

export interface PublicEventDetail extends PublicEvent {
  description: string | null;
  accessibility: {
    step_free: boolean | null;
    accessible_toilet: boolean | null;
    hearing_loop: boolean | null;
    quiet_space: boolean | null;
    seating: boolean | null;
    parking: boolean | null;
    notes: string | null;
  } | null;
}

export const publicEventsApi = {
  list: (params?: { when?: string; q?: string }): Promise<ApiResponse<PublicEvent[]>> => {
    const search = new URLSearchParams();
    if (params?.when) search.set('when', params.when);
    if (params?.q) search.set('q', params.q);
    const qs = search.toString();

    return api.get(`/v2/public/events${qs ? `?${qs}` : ''}`);
  },

  get: (id: number | string): Promise<ApiResponse<PublicEventDetail>> =>
    api.get(`/v2/public/events/${id}`),
};
