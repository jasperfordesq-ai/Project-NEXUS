// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

/**
 * The kinds of match `GET /v2/matches/all` returns. There is no `job` kind: the server has
 * never produced one, and the Jobs filter it implied could never fill.
 */
export type MatchSourceType = 'listing' | 'volunteering' | 'group' | 'event';
export type MatchStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export interface MatchItem {
  /**
   * Unique per card, built from the module and the id that module uses
   * (`listing-12`, `group-4`). The screen keys its list and tracks dismissals by it.
   */
  key: string;
  source_type: MatchSourceType;
  /**
   * The id of the record the card opens, read from the field that belongs to the module.
   * `null` when the server did not send one — the card is then shown without a way to open
   * it, because no link is better than a link to the wrong record.
   */
  source_id: number | null;
  match_score: number;
  match_type?: string | null;
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
    /** Where a volunteering opportunity or an event takes place. */
    location?: string | null;
    /** The organisation offering a volunteering opportunity. */
    organization_name?: string | null;
    /** When an event starts. */
    event_date?: string | null;
    /** How many people have said they are going to an event. */
    attendee_count?: number | null;
    skills?: string[] | null;
  } | null;
}

/**
 * 🔴 The server does not speak `MatchItem`, and the Matches screen CRASHED because of it.
 *
 * `GET /v2/matches/all` (`CrossModuleMatchingService`) returns, per match:
 *   module, title, description, match_score, match_type, match_reasons[], created_at,
 *   distance_km, and one id field named after what the match IS — `listing_id`, `group_id`,
 *   `opportunity_id` (volunteering) or `event_id` — plus `user_id`/`user_name`/`avatar_url`
 *   and `category_name` on listings only.
 *
 * The screen reads `source_type`, `source_id`, `key`, `reasons` and `matched_user`. NONE of
 * those exist in the response. Measured on a device 2026-08-23: "Render Error — Cannot
 * read property 'tone' of undefined", from `SOURCE_CONFIG[item.source_type]` with
 * `source_type` undefined. **The Matches screen was unusable for every member**, and there
 * was no schema check anywhere to say so.
 *
 * Normalised here rather than in the screen, so one adapter serves every consumer and the
 * server's own vocabulary stays in one place.
 *
 * 🔴 Two id mistakes lived here until November 2026, both from reading "whichever id field
 * is present" instead of the one that belongs to the module:
 *   - `group_id` was not read at all, so every group match had id 0: they all shared one
 *     list key and "Open match" opened group 0.
 *   - a volunteering match was opened with `organization_id` as if it were an opportunity
 *     id, which showed an unrelated opportunity. A volunteering match is an OPPORTUNITY and
 *     is opened by `opportunity_id` only; `organization_id` just names who is offering it.
 */
interface RawMatch {
  module?: string;
  listing_id?: number;
  group_id?: number;
  opportunity_id?: number;
  organization_id?: number | null;
  organization_name?: string | null;
  event_id?: number;
  event_date?: string | null;
  attendee_count?: number | null;
  location?: string | null;
  title?: string | null;
  description?: string | null;
  match_score?: number;
  match_type?: string | null;
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
 * `degraded`, `degraded_reason`, `has_active_listings`, `paused`, `disabled` — and this
 * client read only `matches`. Measured on 2026-08-24 with the fixture member: **zero
 * listing matches**, and the server's own answer was `needs_location: true, degraded: true,
 * degraded_reason: "no_coordinates"`. The member has no coordinates, so the engine's
 * geographic gate cannot consider any physical listing, and the app showed the generic "no
 * matches yet" — which reads as "nobody suits you" when the truth is "we cannot look until
 * you add your area".
 *
 * That also explains something recorded as unexplained on 2026-08-23: a second candidate
 * listing "would not enter the engine's result set at all". It could not — no coordinates.
 */
export interface MatchesMeta {
  needsLocation: boolean;
  degraded: boolean;
  /** `no_coordinates`, `safeguarding_policy_unavailable`, or null. */
  degradedReason: string | null;
  hasActiveListings: boolean;
  paused: boolean;
  /** The community has switched matching off; the list is empty. */
  disabled: boolean;
}

interface RawMatchesMeta {
  needs_location?: boolean;
  degraded?: boolean;
  degraded_reason?: string | null;
  has_active_listings?: boolean;
  paused?: boolean;
  disabled?: boolean;
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
  /**
   * Read-only: the furthest the community lets a member search, and so the top of the
   * distance slider. Never sent back to the server.
   */
  max_distance_limit_km: number;
}

/** Used for the distance slider when the server does not say what the community allows. */
export const FALLBACK_MAX_DISTANCE_LIMIT_KM = 100;

const DEFAULT_MATCH_PREFERENCES: MatchPreferences = {
  max_distance_km: 25,
  min_match_score: 50,
  notification_frequency: 'monthly',
  notify_hot_matches: true,
  notify_mutual_matches: true,
  matching_paused: false,
  categories: [],
  availability: [],
  max_distance_limit_km: FALLBACK_MAX_DISTANCE_LIMIT_KM,
};

type MatchPreferencesEnvelope = Partial<MatchPreferences> | {
  data?: Partial<MatchPreferences>;
};

function normalizeMatchPreferences(
  response: MatchPreferencesEnvelope,
  fallbackLimit: number = FALLBACK_MAX_DISTANCE_LIMIT_KM,
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
  const limit = payload.max_distance_limit_km;
  const validLimit = typeof limit === 'number' && Number.isFinite(limit) && limit >= 1
    ? Math.round(limit)
    : fallbackLimit;
  const distance = typeof payload.max_distance_km === 'number' && Number.isFinite(payload.max_distance_km)
    ? payload.max_distance_km
    : DEFAULT_MATCH_PREFERENCES.max_distance_km;

  return {
    ...DEFAULT_MATCH_PREFERENCES,
    ...payload,
    // Never show a distance the community does not allow.
    max_distance_km: Math.min(Math.max(1, distance), validLimit),
    max_distance_limit_km: validLimit,
    notification_frequency: validFrequency,
    categories: Array.isArray(payload.categories)
      ? payload.categories.filter((id: number): id is number => Number.isInteger(id))
      : [],
    availability: Array.isArray(payload.availability)
      ? payload.availability.filter((slot: string): slot is string => typeof slot === 'string')
      : [],
  };
}

const SOURCE_TYPES: readonly MatchSourceType[] = ['listing', 'volunteering', 'group', 'event'];

function sourceTypeOf(raw: RawMatch): MatchSourceType {
  const module = (raw.module ?? '').trim() as MatchSourceType;
  // Anything the app does not recognise is shown as a listing rather than crashing the
  // whole screen — a new module server-side must not take Matches down again. It carries
  // no `listing_id`, so the card is shown without a way to open it.
  return SOURCE_TYPES.includes(module) ? module : 'listing';
}

function positiveId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** The id that belongs to this module — never "whichever id field happens to be set". */
function sourceIdOf(raw: RawMatch, sourceType: MatchSourceType): number | null {
  switch (sourceType) {
    case 'listing':
      return positiveId(raw.listing_id);
    case 'group':
      return positiveId(raw.group_id);
    case 'volunteering':
      // An opportunity. `organization_id` is a different kind of record and must not be
      // used in its place.
      return positiveId(raw.opportunity_id);
    case 'event':
      return positiveId(raw.event_id);
    default:
      return null;
  }
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function normalizeMatch(raw: RawMatch, index: number): MatchItem {
  const sourceType = sourceTypeOf(raw);
  const sourceId = sourceIdOf(raw, sourceType);
  return {
    // The server sends no match id, so a key is derived. It is stable across refreshes for
    // every match that has an id; one without is told apart by its place in the list.
    key: sourceId !== null ? `${sourceType}-${sourceId}` : `${sourceType}-unlinked-${index}`,
    source_type: sourceType,
    source_id: sourceId,
    match_score: typeof raw.match_score === 'number' && Number.isFinite(raw.match_score) ? raw.match_score : 0,
    match_type: typeof raw.match_type === 'string' ? raw.match_type : null,
    title: (raw.title ?? '').trim(),
    description: raw.description ?? null,
    reasons: Array.isArray(raw.match_reasons) ? raw.match_reasons.filter((r) => typeof r === 'string') : [],
    matched_user: typeof raw.user_id === 'number'
      ? { id: raw.user_id, name: (raw.user_name ?? '').trim(), avatar_url: raw.avatar_url ?? null }
      : null,
    matched_at: raw.created_at ?? '',
    metadata: {
      category: raw.category_name ?? null,
      location: textOrNull(raw.location),
      organization_name: textOrNull(raw.organization_name),
      event_date: textOrNull(raw.event_date),
      attendee_count: typeof raw.attendee_count === 'number' && raw.attendee_count > 0 ? raw.attendee_count : null,
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
    disabled: raw?.disabled === true,
  };
}

/**
 * No `min_score` is sent, on purpose: left out, the server applies the minimum the member
 * saved in their match preferences (else the community's own). Sending one would override
 * what they chose.
 */
export async function getMatches(): Promise<MatchesResponse> {
  // 50, the number match alerts are worked out from. The server's default
  // is 20 across every kind of match, so a tapped alert could open this list
  // without the match it was about.
  const response = await api.get<RawMatchesResponse>(`${API_V2}/matches/all?limit=50`);
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

/**
 * Saves the member's preferences and returns what the server kept — which may differ from
 * what was sent (a distance beyond the community's limit is brought back to it).
 */
export async function updateMatchPreferences(
  preferences: MatchPreferences,
): Promise<MatchPreferences> {
  // The community's limit is the server's to state, not the member's to set.
  const body: Omit<MatchPreferences, 'max_distance_limit_km'> = {
    max_distance_km: preferences.max_distance_km,
    min_match_score: preferences.min_match_score,
    notification_frequency: preferences.notification_frequency,
    notify_hot_matches: preferences.notify_hot_matches,
    notify_mutual_matches: preferences.notify_mutual_matches,
    matching_paused: preferences.matching_paused,
    categories: preferences.categories,
    availability: preferences.availability,
  };
  const response = await api.put<MatchPreferencesEnvelope>(
    `${API_V2}/users/me/match-preferences`,
    body,
  );
  // A server that does not restate the limit has not changed it.
  return normalizeMatchPreferences(response, preferences.max_distance_limit_km);
}
