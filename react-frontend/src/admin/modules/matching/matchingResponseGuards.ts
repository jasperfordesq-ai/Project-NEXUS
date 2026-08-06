// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type {
  MatchingGateImpactStats,
  MatchingOverviewStats,
  MatchingPillarAverages,
  MatchingStatsResponse,
  SmartMatchingConfig,
} from "../../api/types";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isFiniteNumber)
  );
}

/**
 * Read a string-keyed count map.
 *
 * PHP has no distinct empty-map literal, so an empty string-keyed array is
 * serialized by `json_encode` as `[]`, not `{}` — every one of these maps
 * arrives as an array on a tenant with no data yet. Treat that (and only that)
 * empty-array form as an empty map; a populated array is still a contract
 * violation and is rejected.
 */
function parseNumberRecord(value: unknown): Record<string, number> | null {
  if (Array.isArray(value)) return value.length === 0 ? {} : null;
  return isNumberRecord(value) ? value : null;
}

function parseDistribution(value: unknown): Record<string, number> | null {
  if (isNumberRecord(value)) return value;
  if (!Array.isArray(value)) return null;

  const distribution: Record<string, number> = {};
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      return null;
    const row = item as Record<string, unknown>;
    if (
      typeof row.range !== "string" ||
      row.range.length === 0 ||
      !isFiniteNumber(row.count) ||
      Object.prototype.hasOwnProperty.call(distribution, row.range)
    )
      return null;
    distribution[row.range] = row.count;
  }
  return distribution;
}

function readFiniteNumber(
  record: Record<string, unknown>,
  keys: string[],
): number | null | undefined {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    return isFiniteNumber(record[key]) ? record[key] : null;
  }
  return undefined;
}

function parseGateImpact(value: unknown): MatchingGateImpactStats | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const impact = value as Record<string, unknown>;
  const counts = [
    "degraded_users_count",
    "active_users_count",
    "listings_without_coords",
    "remote_listings_count",
    "active_listings_count",
  ] as const;
  if (!counts.every((key) => isFiniteNumber(impact[key]))) return null;

  const dismissReasons = parseNumberRecord(impact.dismiss_reasons);
  const algorithmVersionMix = parseNumberRecord(impact.algorithm_version_mix);
  if (dismissReasons === null || algorithmVersionMix === null) return null;

  return {
    degraded_users_count: impact.degraded_users_count as number,
    active_users_count: impact.active_users_count as number,
    listings_without_coords: impact.listings_without_coords as number,
    remote_listings_count: impact.remote_listings_count as number,
    active_listings_count: impact.active_listings_count as number,
    dismiss_reasons: dismissReasons,
    algorithm_version_mix: algorithmVersionMix,
  };
}

function parsePillarAverages(value: unknown): MatchingPillarAverages | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const averages = value as Record<string, unknown>;
  if (!isFiniteNumber(averages.sample_size)) return null;

  const pillars = parseNumberRecord(averages.pillars);
  if (pillars === null) return null;

  return { sample_size: averages.sample_size, pillars };
}

/**
 * Validate and normalize the matching-stats envelope.
 *
 * Laravel's production response uses analytics-service names such as
 * `total_cached_matches` and `average_score`, while older frontend fixtures use
 * the canonical UI names. Missing metrics stay undefined so the UI can render
 * them as unknown rather than inventing a zero.
 */
export function parseMatchingStatsResponse(
  value: unknown,
): MatchingStatsResponse | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;

  const stats = value as Record<string, unknown>;
  const overview = stats.overview;
  const scoreDistribution = parseDistribution(stats.score_distribution);
  const distanceDistribution = parseDistribution(stats.distance_distribution);
  if (
    typeof overview !== "object" ||
    overview === null ||
    Array.isArray(overview)
  )
    return null;
  if (scoreDistribution === null || distanceDistribution === null) return null;

  const overviewRecord = overview as Record<string, unknown>;
  const totalMatchesMonth = readFiniteNumber(overviewRecord, [
    "total_matches_month",
  ]);
  const hotMatchesCount = readFiniteNumber(overviewRecord, [
    "hot_matches_count",
    "hot_matches",
  ]);
  const avgMatchScore = readFiniteNumber(overviewRecord, [
    "avg_match_score",
    "average_score",
  ]);
  const avgDistanceKm = readFiniteNumber(overviewRecord, [
    "avg_distance_km",
    "average_distance_km",
  ]);
  const cacheEntries = readFiniteNumber(overviewRecord, [
    "cache_entries",
    "total_cached_matches",
  ]);
  const activeUsersMatching = readFiniteNumber(overviewRecord, [
    "active_users_matching",
    "active_users_with_matches",
  ]);
  const totalMatchesToday = readFiniteNumber(overviewRecord, [
    "total_matches_today",
  ]);
  const totalMatchesWeek = readFiniteNumber(overviewRecord, [
    "total_matches_week",
  ]);
  const mutualMatchesCount = readFiniteNumber(overviewRecord, [
    "mutual_matches_count",
  ]);
  const cacheHitRate = readFiniteNumber(overviewRecord, ["cache_hit_rate"]);

  const optionalOverview = [
    totalMatchesToday,
    totalMatchesWeek,
    mutualMatchesCount,
    cacheHitRate,
  ];

  if (
    !isFiniteNumber(totalMatchesMonth) ||
    !isFiniteNumber(hotMatchesCount) ||
    !isFiniteNumber(avgMatchScore) ||
    !isFiniteNumber(avgDistanceKm) ||
    !isFiniteNumber(cacheEntries) ||
    !isFiniteNumber(activeUsersMatching)
  )
    return null;
  if (optionalOverview.some((metric) => metric === null)) return null;
  if (typeof stats.broker_approval_enabled !== "boolean") return null;
  const pendingApprovals = stats.pending_approvals;
  const approvedCount = stats.approved_count;
  const rejectedCount = stats.rejected_count;
  const approvalRate = stats.approval_rate;
  if (
    !isFiniteNumber(pendingApprovals) ||
    !isFiniteNumber(approvedCount) ||
    !isFiniteNumber(rejectedCount) ||
    !isFiniteNumber(approvalRate)
  ) return null;
  const gateImpact =
    stats.gate_impact === undefined ? undefined : parseGateImpact(stats.gate_impact);
  const pillarAverages =
    stats.pillar_averages === undefined
      ? undefined
      : parsePillarAverages(stats.pillar_averages);
  if (gateImpact === null || pillarAverages === null) return null;

  const normalizedOverview: MatchingOverviewStats = {
    total_matches_month: totalMatchesMonth,
    hot_matches_count: hotMatchesCount,
    avg_match_score: avgMatchScore,
    avg_distance_km: avgDistanceKm,
    cache_entries: cacheEntries,
    active_users_matching: activeUsersMatching,
  };

  if (isFiniteNumber(totalMatchesToday))
    normalizedOverview.total_matches_today = totalMatchesToday;
  if (isFiniteNumber(totalMatchesWeek))
    normalizedOverview.total_matches_week = totalMatchesWeek;
  if (isFiniteNumber(mutualMatchesCount))
    normalizedOverview.mutual_matches_count = mutualMatchesCount;
  if (isFiniteNumber(cacheHitRate))
    normalizedOverview.cache_hit_rate = cacheHitRate;

  return {
    overview: normalizedOverview,
    score_distribution: scoreDistribution,
    distance_distribution: distanceDistribution,
    broker_approval_enabled: stats.broker_approval_enabled,
    pending_approvals: pendingApprovals,
    approved_count: approvedCount,
    rejected_count: rejectedCount,
    approval_rate: approvalRate,
    ...(gateImpact !== undefined
      ? { gate_impact: gateImpact }
      : {}),
    ...(pillarAverages !== undefined
      ? { pillar_averages: pillarAverages }
      : {}),
  };
}

export function isMatchingStatsResponse(value: unknown): boolean {
  return parseMatchingStatsResponse(value) !== null;
}

export function isSmartMatchingConfig(
  value: unknown,
): value is SmartMatchingConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;

  const config = value as Record<string, unknown>;
  const numericWeightKeys = [
    "category_weight",
    "skill_weight",
    "proximity_weight",
    "freshness_weight",
    "reciprocity_weight",
    "quality_weight",
  ];

  return (
    numericWeightKeys.every((key) => isFiniteNumber(config[key])) &&
    Array.isArray(config.proximity_bands) &&
    config.proximity_bands.every(
      (band) =>
        typeof band === "object" &&
        band !== null &&
        isFiniteNumber((band as Record<string, unknown>).distance_km) &&
        isFiniteNumber((band as Record<string, unknown>).score),
    )
  );
}
