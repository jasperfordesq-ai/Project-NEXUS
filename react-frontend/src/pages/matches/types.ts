// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Smart Matching — shared types for the member-facing matches experience.
 *
 * Mirrors GET /v2/matches/all. All fields beyond the common shape are
 * optional so the UI degrades gracefully against older backends that
 * haven't shipped every field yet.
 */

export type MatchModule = 'listing' | 'group' | 'volunteering' | 'event';

export type DismissReason =
  | 'not_relevant'
  | 'too_far'
  | 'already_done'
  | 'not_my_skills'
  | 'not_interested'
  | 'other';

export interface ScoreBreakdownPillars {
  relevance: number;
  feasibility: number;
  trust: number;
}

export interface ScoreBreakdownSignals {
  relevance: {
    category?: number;
    skill?: number;
    semantic?: number;
  };
  feasibility: {
    proximity?: number;
    availability?: number;
    activity?: number;
  };
  trust: {
    reviews?: number;
    trust_tier?: number;
    completion?: number;
  };
}

export interface ScoreBreakdown {
  pillars: ScoreBreakdownPillars;
  signals: ScoreBreakdownSignals;
  adjustments?: Record<string, number>;
}

export interface Match {
  module: MatchModule;
  title: string;
  description?: string | null;
  match_score: number;
  /**
   * one_way | potential | mutual | cold_start | group_recommendation |
   * volunteering_recommendation | event_recommendation. `cold_start` items are
   * browsing suggestions for a member with nothing posted yet, not scored
   * matches, and are labelled as suggestions.
   */
  match_type?: string;
  match_reasons?: string[];
  distance_km?: number | null;
  created_at?: string | null;

  // Listing extras
  listing_id?: number;
  type?: 'offer' | 'request';
  category_name?: string | null;
  user_id?: number;
  user_name?: string;
  avatar_url?: string | null;
  is_remote?: boolean;
  is_mutual?: boolean;
  explanation?: string | null;
  explanation_source?: 'ai' | 'algorithmic';
  matched_listing?: unknown;
  score_breakdown?: ScoreBreakdown | null;

  // Group extras
  group_id?: number;
  image_url?: string | null;
  member_count?: number;
  visibility?: string;

  // Volunteering extras. The match is an OPPORTUNITY: `opportunity_id` is the
  // only id that may be linked to. `organization_id` names the organisation
  // offering it and must never be used as an opportunity id.
  opportunity_id?: number;
  organization_id?: number | null;
  organization_name?: string | null;

  // Volunteering and event extras
  location?: string | null;

  // Event extras
  event_id?: number;
  /** Start date-time of the event. */
  event_date?: string | null;
  attendee_count?: number;
}

export interface MatchesMeta {
  total: number;
  modules: string[];
  /** The minimum score the server applied (the member's saved one, else the community's). */
  min_score: number;
  needs_location: boolean;
  degraded: boolean;
  degraded_reason: 'no_coordinates' | 'safeguarding_policy_unavailable' | null;
  has_active_listings: boolean | null;
  paused: boolean;
  /** The community has switched matching off; `matches` is empty. */
  disabled: boolean;
}

export interface MatchesResponse {
  matches: Match[];
  meta: MatchesMeta;
}

export interface MatchPreferences {
  max_distance_km: number;
  min_match_score: number;
  notification_frequency: 'daily' | 'monthly' | 'fortnightly' | 'never';
  notify_hot_matches: boolean;
  notify_mutual_matches: boolean;
  matching_paused: boolean;
  categories: number[];
  availability: string[];
}

/**
 * What GET / PUT /v2/users/me/match-preferences answers with: the editable
 * preferences plus the community's own distance ceiling, which is read-only.
 */
export interface MatchPreferencesResponse extends MatchPreferences {
  max_distance_limit_km?: number;
}

/** Used for the distance slider when the server does not say what the community allows. */
export const FALLBACK_MAX_DISTANCE_LIMIT_KM = 100;

/**
 * The id of the record a match card opens, read from the field that belongs
 * to its module. A volunteering match is an opportunity, so only
 * `opportunity_id` counts — never `organization_id`, which names a different
 * kind of record and used to send members to an unrelated opportunity.
 */
export function matchDetailId(
  match: Pick<Match, 'module' | 'listing_id' | 'group_id' | 'opportunity_id' | 'event_id'>,
): number | undefined {
  const id = (() => {
    switch (match.module) {
      case 'listing':
        return match.listing_id;
      case 'group':
        return match.group_id;
      case 'volunteering':
        return match.opportunity_id;
      case 'event':
        return match.event_id;
      default:
        return undefined;
    }
  })();

  return typeof id === 'number' && Number.isFinite(id) && id > 0 ? id : undefined;
}

/** Returns a stable per-card id used for scroll-to-highlight deep links. */
export function matchElementId(
  match: Pick<Match, 'module' | 'listing_id' | 'group_id' | 'opportunity_id' | 'organization_id' | 'event_id'>,
): string {
  const id = matchDetailId(match);
  if (id !== undefined) return `${match.module}-${id}`;
  // A volunteering match from a server that has not sent the opportunity yet:
  // still give the card a distinct id so two of them never share a key.
  if (match.module === 'volunteering' && match.organization_id) {
    return `${match.module}-organisation-${match.organization_id}`;
  }
  return `${match.module}-0`;
}

/** The score a member is shown: a whole number from 0 to 100. */
export function displayScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/** A browsing suggestion for a member with nothing posted yet, not a scored match. */
export function isSuggestion(match: Pick<Match, 'match_type'>): boolean {
  return match.match_type === 'cold_start';
}
