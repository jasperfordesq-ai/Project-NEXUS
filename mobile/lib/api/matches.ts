// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export type MatchSourceType = 'listing' | 'job' | 'volunteering' | 'group' | 'event';
export type MatchStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export interface MatchItem {
  id: number;
  source_type: MatchSourceType;
  source_id: number;
  match_score: number;
  title: string;
  description?: string | null;
  reasons: string[];
  matched_user?: {
    id: number;
    name: string;
    avatar_url?: string | null;
  } | null;
  matched_at: string;
  status?: MatchStatus;
  metadata?: {
    category?: string | null;
    location?: string | null;
    skills?: string[] | null;
  } | null;
}

/**
 * 🔴 The server does not speak `MatchItem`, and the Matches screen CRASHED because of it.
 *
 * `GET /v2/matches/all` (`CrossModuleMatchingService`) returns, per match:
 *   module, title, description, match_score, match_type, match_reasons[], created_at,
 *   distance_km, and one id field named after the module — `listing_id`,
 *   `organization_id` or `event_id` — plus `user_id`/`user_name`/`avatar_url` and
 *   `category_name` on listings only.
 *
 * The screen reads `source_type`, `source_id`, `id`, `reasons` and `matched_user`. NONE of
 * those exist in the response. Measured on a device 2026-08-23: "Render Error — Cannot
 * read property 'tone' of undefined", from `SOURCE_CONFIG[item.source_type]` with
 * `source_type` undefined. **The Matches screen was unusable for every member**, and there
 * was no schema check anywhere to say so.
 *
 * Normalised here rather than in the screen, so one adapter serves every consumer and the
 * server's own vocabulary stays in one place.
 */
interface RawMatch {
  module?: string;
  listing_id?: number;
  organization_id?: number;
  event_id?: number;
  title?: string | null;
  description?: string | null;
  match_score?: number;
  match_reasons?: string[] | null;
  created_at?: string | null;
  category_name?: string | null;
  user_id?: number;
  user_name?: string | null;
  avatar_url?: string | null;
  is_remote?: boolean;
  distance_km?: number | null;
}

interface MatchesPayload {
  matches?: RawMatch[];
  meta?: RawMatchesMeta;
}

/**
 * 🔴 The server explains an empty result and the app used to discard it.
 *
 * `GET /v2/matches/all` returns a `meta` block beside the list — `needs_location`,
 * `degraded`, `degraded_reason`, `has_active_listings`, `paused` — and this client read only
 * `matches`. Measured on 2026-08-24 with the fixture member: **zero listing matches**, and
 * the server's own answer was `needs_location: true, degraded: true, degraded_reason:
 * "no_coordinates"`. The member has no coordinates, so the engine's geographic gate cannot
 * consider any physical listing, and the app showed the generic "no matches yet" — which
 * reads as "nobody suits you" when the truth is "we cannot look until you add your area".
 *
 * That also explains something recorded as unexplained on 2026-08-23: a second candidate
 * listing "would not enter the engine's result set at all". It could not — no coordinates.
 */
export interface MatchesMeta {
  needsLocation: boolean;
  degraded: boolean;
  degradedReason: string | null;
  hasActiveListings: boolean;
  paused: boolean;
}

interface RawMatchesMeta {
  needs_location?: boolean;
  degraded?: boolean;
  degraded_reason?: string | null;
  has_active_listings?: boolean;
  paused?: boolean;
}

type RawMatchesResponse = RawMatch[] | MatchesPayload | { data?: RawMatch[] | MatchesPayload };

export interface MatchesResponse {
  data: MatchItem[];
  meta: MatchesMeta;
}

export type MatchNotificationFrequency = 'daily' | 'fortnightly' | 'monthly' | 'never';

export interface MatchPreferences {
  max_distance_km: number;
  min_match_score: number;
  notification_frequency: MatchNotificationFrequency;
  notify_hot_matches: boolean;
  notify_mutual_matches: boolean;
  matching_paused: boolean;
  categories: number[];
  availability: string[];
}

const DEFAULT_MATCH_PREFERENCES: MatchPreferences = {
  max_distance_km: 25,
  min_match_score: 50,
  notification_frequency: 'monthly',
  notify_hot_matches: true,
  notify_mutual_matches: true,
  matching_paused: false,
  categories: [],
  availability: [],
};

type MatchPreferencesEnvelope = Partial<MatchPreferences> | {
  data?: Partial<MatchPreferences>;
};

function normalizeMatchPreferences(
  response: MatchPreferencesEnvelope,
): MatchPreferences {
  const payload: Partial<MatchPreferences> = 'data' in response
    ? response.data ?? {}
    : response as Partial<MatchPreferences>;
  const frequency = payload.notification_frequency;
  const validFrequency: MatchNotificationFrequency =
    frequency === 'daily'
    || frequency === 'fortnightly'
    || frequency === 'monthly'
    || frequency === 'never'
      ? frequency
      : DEFAULT_MATCH_PREFERENCES.notification_frequency;

  return {
    ...DEFAULT_MATCH_PREFERENCES,
    ...payload,
    notification_frequency: validFrequency,
    categories: Array.isArray(payload.categories)
      ? payload.categories.filter((id: number): id is number => Number.isInteger(id))
      : [],
    availability: Array.isArray(payload.availability)
      ? payload.availability.filter((slot: string): slot is string => typeof slot === 'string')
      : [],
  };
}

const SOURCE_TYPES: readonly MatchSourceType[] = ['listing', 'job', 'volunteering', 'group', 'event'];

function sourceTypeOf(raw: RawMatch): MatchSourceType {
  const module = (raw.module ?? '').trim() as MatchSourceType;
  // Anything the app does not recognise is shown as a listing rather than crashing the
  // whole screen — a new module server-side must not take Matches down again.
  return SOURCE_TYPES.includes(module) ? module : 'listing';
}

function sourceIdOf(raw: RawMatch): number {
  return raw.listing_id ?? raw.organization_id ?? raw.event_id ?? 0;
}

function normalizeMatch(raw: RawMatch): MatchItem {
  const sourceType = sourceTypeOf(raw);
  const sourceId = sourceIdOf(raw);
  return {
    // The server sends no match id, so one is derived. It has to be stable across
    // refreshes because the screen keys the list on it and tracks dismissals by it.
    id: Number(`${SOURCE_TYPES.indexOf(sourceType) + 1}${String(sourceId).padStart(9, '0')}`),
    source_type: sourceType,
    source_id: sourceId,
    match_score: typeof raw.match_score === 'number' ? raw.match_score : 0,
    title: (raw.title ?? '').trim(),
    description: raw.description ?? null,
    reasons: Array.isArray(raw.match_reasons) ? raw.match_reasons.filter((r) => typeof r === 'string') : [],
    matched_user: typeof raw.user_id === 'number'
      ? { id: raw.user_id, name: (raw.user_name ?? '').trim(), avatar_url: raw.avatar_url ?? null }
      : null,
    matched_at: raw.created_at ?? '',
    metadata: {
      category: raw.category_name ?? null,
      location: raw.is_remote ? null : null,
      skills: null,
    },
  };
}

function normalizeMeta(raw: RawMatchesMeta | undefined): MatchesMeta {
  return {
    needsLocation: raw?.needs_location === true,
    degraded: raw?.degraded === true,
    degradedReason: raw?.degraded_reason ?? null,
    // Absent means "not told" — and an unknown state must not read as "you have no
    // listings", which would put a wrong explanation in front of the member.
    hasActiveListings: raw?.has_active_listings !== false,
    paused: raw?.paused === true,
  };
}

export async function getMatches(): Promise<MatchesResponse> {
  const response = await api.get<RawMatchesResponse>(`${API_V2}/matches/all`);
  const payload =
    !Array.isArray(response) && response && 'data' in response && response.data !== undefined
      ? response.data
      : response;

  const raw = Array.isArray(payload)
    ? payload
    : payload && 'matches' in payload
      ? payload.matches ?? []
      : [];

  const meta = !Array.isArray(payload) && payload && 'meta' in payload ? payload.meta : undefined;

  return { data: raw.map(normalizeMatch), meta: normalizeMeta(meta) };
}

export function dismissMatch(listingId: number): Promise<unknown> {
  return api.post(`${API_V2}/matches/${listingId}/dismiss`, { reason: 'not_relevant' });
}

export async function getMatchPreferences(): Promise<MatchPreferences> {
  const response = await api.get<MatchPreferencesEnvelope>(`${API_V2}/users/me/match-preferences`);
  return normalizeMatchPreferences(response);
}

export async function updateMatchPreferences(
  preferences: MatchPreferences,
): Promise<MatchPreferences> {
  const response = await api.put<MatchPreferencesEnvelope>(
    `${API_V2}/users/me/match-preferences`,
    preferences,
  );
  return normalizeMatchPreferences(response);
}
