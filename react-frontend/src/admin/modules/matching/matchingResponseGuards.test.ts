// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { parseMatchingStatsResponse } from './matchingResponseGuards';

/**
 * The exact envelope `GET /v2/admin/matching/stats` returns for a tenant with
 * no cached matches and no dismissals — captured from the Laravel container on
 * tenant 2 (hour-timebank). Every string-keyed count map comes back as `[]`
 * because PHP's `json_encode` cannot distinguish an empty map from an empty
 * list. Rejecting that shape blanked the whole Matching Analytics page.
 */
const EMPTY_TENANT_PAYLOAD = {
  overview: {
    total_cached_matches: 0,
    total_matches_month: 0,
    average_score: 0,
    average_distance_km: 0,
    match_type_breakdown: [],
    active_users_with_matches: 0,
    hot_matches: 0,
  },
  score_distribution: [
    { range: '0-20', count: 0 },
    { range: '21-40', count: 0 },
    { range: '41-60', count: 0 },
    { range: '61-80', count: 0 },
    { range: '81-100', count: 0 },
  ],
  distance_distribution: [
    { range: '0-5km', count: 0 },
    { range: '5-15km', count: 0 },
  ],
  broker_approval_enabled: true,
  pending_approvals: 0,
  approved_count: 0,
  rejected_count: 0,
  approval_rate: 0,
  gate_impact: {
    degraded_users_count: 4,
    active_users_count: 4,
    listings_without_coords: 1,
    remote_listings_count: 0,
    active_listings_count: 1,
    dismiss_reasons: [],
    algorithm_version_mix: [],
  },
  pillar_averages: { sample_size: 0, pillars: [] },
};

describe('parseMatchingStatsResponse', () => {
  it('accepts the live empty-tenant payload and normalizes empty PHP maps', () => {
    const parsed = parseMatchingStatsResponse(EMPTY_TENANT_PAYLOAD);

    expect(parsed).not.toBeNull();
    expect(parsed?.gate_impact?.dismiss_reasons).toEqual({});
    expect(parsed?.gate_impact?.algorithm_version_mix).toEqual({});
    expect(parsed?.pillar_averages).toEqual({ sample_size: 0, pillars: {} });
    expect(parsed?.overview.cache_entries).toBe(0);
    expect(parsed?.overview.active_users_matching).toBe(0);
  });

  it('keeps populated count maps intact', () => {
    const parsed = parseMatchingStatsResponse({
      ...EMPTY_TENANT_PAYLOAD,
      gate_impact: {
        ...EMPTY_TENANT_PAYLOAD.gate_impact,
        dismiss_reasons: { too_far: 3, not_interested: 1 },
        algorithm_version_mix: { v2: 40 },
      },
      pillar_averages: {
        sample_size: 12,
        pillars: { relevance: 0.71, feasibility: 0.6, trust: 0.83 },
      },
    });

    expect(parsed?.gate_impact?.dismiss_reasons).toEqual({ too_far: 3, not_interested: 1 });
    expect(parsed?.gate_impact?.algorithm_version_mix).toEqual({ v2: 40 });
    expect(parsed?.pillar_averages?.pillars.trust).toBe(0.83);
  });

  it('still rejects a populated array where a count map is required', () => {
    expect(
      parseMatchingStatsResponse({
        ...EMPTY_TENANT_PAYLOAD,
        gate_impact: { ...EMPTY_TENANT_PAYLOAD.gate_impact, dismiss_reasons: [3, 1] },
      })
    ).toBeNull();

    expect(
      parseMatchingStatsResponse({
        ...EMPTY_TENANT_PAYLOAD,
        pillar_averages: { sample_size: 2, pillars: [0.5] },
      })
    ).toBeNull();
  });

  it('still rejects non-numeric values inside a count map', () => {
    expect(
      parseMatchingStatsResponse({
        ...EMPTY_TENANT_PAYLOAD,
        gate_impact: {
          ...EMPTY_TENANT_PAYLOAD.gate_impact,
          algorithm_version_mix: { v2: 'lots' },
        },
      })
    ).toBeNull();
  });
});
