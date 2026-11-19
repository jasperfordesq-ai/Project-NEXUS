<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Matching;

/**
 * MatchScoreResult — immutable outcome of scoring one searcher↔candidate pair.
 *
 * score is 0–100. pillars/signals hold the 0–1 component values that produced
 * it (persisted to match_cache.score_breakdown for analytics and the member
 * "why this score" UI). adjustments are the bounded additive deltas applied
 * on top of the geometric-mean core.
 */
final class MatchScoreResult
{
    /**
     * @param float $score       Final score 0–100
     * @param array $pillars     ['relevance' => float, 'feasibility' => float, 'trust' => float] (0–1)
     * @param array $signals     Per-signal 0–1 values keyed by pillar; null = unknown, left out of its pillar
     * @param array $adjustments Additive deltas applied (e.g. ['mutual' => 8.0, 'freshness' => 2.5])
     * @param array $reasons     Human-readable match reasons
     * @param string $matchType  one_way | potential | mutual
     * @param float|null $distanceKm Null when unresolvable/remote
     * @param string $serviceType Candidate listing service_type
     * @param string[] $flags    Findings that shaped the score (e.g. 'different_kinds_of_help')
     * @param array{you_offer?: string, they_offer?: string}|null $exchange
     *        In a two-way match found in the members' listings: what each side gives
     */
    public function __construct(
        public readonly float $score,
        public readonly array $pillars,
        public readonly array $signals,
        public readonly array $adjustments,
        public readonly array $reasons,
        public readonly string $matchType,
        public readonly ?float $distanceKm,
        public readonly string $serviceType,
        public readonly array $flags = [],
        public readonly ?array $exchange = null,
    ) {}

    /** Legacy-shaped array for callers of the v1 calculateMatchScore contract. */
    public function toLegacyArray(): array
    {
        return [
            'score' => $this->score,
            'reasons' => $this->reasons,
            'breakdown' => $this->signals,
            'distance' => $this->distanceKm,
            'type' => $this->matchType,
            'service_type' => $this->serviceType,
            'exchange' => $this->exchange,
        ];
    }

    /**
     * Structured breakdown persisted to match_cache.score_breakdown. An
     * unknown signal stays null (the "why this score" panel leaves it out);
     * as 0.0 it would read as the worst possible value.
     */
    public function toBreakdownArray(): array
    {
        $round = fn ($v) => $v === null ? null : round((float) $v, 4);

        $breakdown = [
            'pillars' => array_map($round, $this->pillars),
            'signals' => array_map(
                fn ($group) => is_array($group) ? array_map($round, $group) : $round($group),
                $this->signals
            ),
            'adjustments' => array_map(fn ($v) => round((float) $v, 2), $this->adjustments),
        ];
        if ($this->flags !== []) {
            $breakdown['flags'] = array_values($this->flags);
        }

        return $breakdown;
    }
}
