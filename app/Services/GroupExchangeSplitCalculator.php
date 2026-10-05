<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

/**
 * The arithmetic for every kind of group exchange, in one place.
 *
 * One hour of time is one time credit. People giving time ("provider") earn,
 * people receiving time ("receiver") pay. Settlement, the start() check and the
 * preview every client shows all call this, so no client works out a split on
 * its own (the React page used to, and its "custom" preview disagreed with what
 * the server actually charged).
 *
 * Kinds, in the order members see them:
 *  - workshop: each giver earns their own hours, each attendee pays their own
 *    hours, and whatever attendees pay beyond what givers earn goes to the
 *    community time fund. Givers may not earn more than attendees pay.
 *  - team: each helper earns their own hours; the people helped share the cost
 *    of all of it equally.
 *  - equal / weighted: one total shared within each side, equally or by weight
 *    (unchanged from before these kinds existed).
 *  - custom: each person's own hours, which must balance.
 *
 * Within every shared total the LAST person absorbs the rounding remainder, so
 * each side sums exactly to its total and settlement never mints or destroys a
 * cent.
 */
final class GroupExchangeSplitCalculator
{
    public const KINDS = ['workshop', 'team', 'equal', 'weighted', 'custom'];

    /**
     * @param list<array{user_id:int, role:string, hours:float, weight:float}> $participants
     * @return array{
     *   lines: list<array{user_id:int, role:string, hours:float}>,
     *   community_fund_hours: float,
     *   earned: float,
     *   paid: float,
     *   problem: ?string
     * }
     */
    public static function compute(string $kind, float $totalHours, array $participants): array
    {
        if (! in_array($kind, self::KINDS, true)) {
            return self::result([], 0.0, 'SPLIT_TYPE_INVALID');
        }

        $givers = array_values(array_filter($participants, static fn (array $p): bool => $p['role'] === 'provider'));
        $receivers = array_values(array_filter($participants, static fn (array $p): bool => $p['role'] !== 'provider'));

        $lines = match ($kind) {
            'equal' => self::shareByRole($participants, $totalHours, static fn (): float => 1.0),
            'weighted' => self::shareByRole($participants, $totalHours, static fn (array $p): float => (float) ($p['weight'] ?: 1.0)),
            'team' => self::teamLines($givers, $receivers),
            default => array_map(static fn (array $p): array => self::line($p, (float) $p['hours']), $participants),
        };

        if ($givers === []) {
            return self::result($lines, 0.0, 'NO_GIVERS');
        }
        if ($receivers === []) {
            return self::result($lines, 0.0, 'NO_RECEIVERS');
        }

        $ownHours = match ($kind) {
            'workshop', 'custom' => $participants,
            'team' => $givers,
            default => [],
        };
        foreach ($ownHours as $p) {
            if (round((float) $p['hours'], 2) <= 0) {
                return self::result($lines, 0.0, 'HOURS_MISSING');
            }
        }

        [$earnedCents, $paidCents] = self::sideCents($lines);

        if ($kind === 'workshop') {
            if ($earnedCents > $paidCents) {
                return self::result($lines, 0.0, 'EARNED_EXCEEDS_PAID');
            }

            return self::result($lines, (float) (($paidCents - $earnedCents) / 100), null);
        }

        if ($earnedCents !== $paidCents) {
            return self::result($lines, 0.0, 'UNBALANCED');
        }

        return self::result($lines, 0.0, null);
    }

    /**
     * equal / weighted: share $totalHours within each role, last absorbs the
     * remainder. Moved unchanged from GroupExchangeService::calculateSplit().
     *
     * @param list<array{user_id:int, role:string, hours:float, weight:float}> $participants
     * @param callable(array): float $weightOf
     * @return list<array{user_id:int, role:string, hours:float}>
     */
    private static function shareByRole(array $participants, float $totalHours, callable $weightOf): array
    {
        $byRole = [];
        foreach ($participants as $p) {
            $byRole[$p['role']][] = $p;
        }

        $lines = [];
        foreach ($byRole as $roleParticipants) {
            $count = count($roleParticipants);
            $totalWeight = array_sum(array_map($weightOf, $roleParticipants));
            if ($totalWeight <= 0) {
                $totalWeight = $count;
            }

            $allocated = 0.0;
            foreach ($roleParticipants as $idx => $p) {
                if ($idx === $count - 1) {
                    $hours = round($totalHours - $allocated, 2);
                } else {
                    $hours = round(($weightOf($p) / $totalWeight) * $totalHours, 2);
                    $allocated += $hours;
                }
                $lines[] = self::line($p, $hours);
            }
        }

        return $lines;
    }

    /**
     * team: helpers earn their own hours; the people helped share the total.
     *
     * @return list<array{user_id:int, role:string, hours:float}>
     */
    private static function teamLines(array $givers, array $receivers): array
    {
        $lines = array_map(static fn (array $p): array => self::line($p, (float) $p['hours']), $givers);
        [$earnedCents] = self::sideCents($lines);

        return array_merge($lines, self::shareByRole($receivers, (float) ($earnedCents / 100), static fn (): float => 1.0));
    }

    /** @return array{user_id:int, role:string, hours:float} */
    private static function line(array $p, float $hours): array
    {
        return ['user_id' => (int) $p['user_id'], 'role' => (string) $p['role'], 'hours' => round($hours, 2)];
    }

    /**
     * Totals exactly as settlement applies them: 2 dp, entries <= 0 skipped.
     *
     * @return array{0:int, 1:int} [earned cents, paid cents]
     */
    private static function sideCents(array $lines): array
    {
        $earned = 0;
        $paid = 0;
        foreach ($lines as $line) {
            $cents = (int) round($line['hours'] * 100);
            if ($cents <= 0) {
                continue;
            }
            if ($line['role'] === 'provider') {
                $earned += $cents;
            } else {
                $paid += $cents;
            }
        }

        return [$earned, $paid];
    }

    private static function result(array $lines, float $fundHours, ?string $problem): array
    {
        [$earnedCents, $paidCents] = self::sideCents($lines);

        return [
            'lines' => $lines,
            'community_fund_hours' => round($fundHours, 2),
            'earned' => (float) ($earnedCents / 100),
            'paid' => (float) ($paidCents / 100),
            'problem' => $problem,
        ];
    }
}
