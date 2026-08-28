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
  match_type?: string;
  match_reasons?: string[];
  distance_km?: number | null;
  created_at?: string;

  // Listing extras
  listing_id?: number;
  type?: 'offer' | 'request';
  category_name?: string;
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

  // Volunteering extras
  organization_id?: number;

  // Event extras
  event_id?: number;
}

export interface MatchesMeta {
  total: number;
  modules: string[];
  min_score: number;
  needs_location: boolean;
  degraded: boolean;
  degraded_reason: 'no_coordinates' | 'safeguarding_policy_unavailable' | null;
  has_active_listings: boolean | null;
  paused: boolean;
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

/** Returns a stable per-card id used for scroll-to-highlight deep links. */
export function matchElementId(match: Pick<Match, 'module' | 'listing_id' | 'group_id' | 'organization_id' | 'event_id'>): string {
  const id = match.listing_id ?? match.group_id ?? match.organization_id ?? match.event_id ?? 0;
  return `${match.module}-${id}`;
}
