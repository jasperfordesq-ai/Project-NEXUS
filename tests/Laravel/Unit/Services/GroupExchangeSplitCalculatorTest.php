<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\GroupExchangeSplitCalculator as Calc;
use PHPUnit\Framework\TestCase;

/**
 * The arithmetic for the five kinds of group exchange. One hour of time is one
 * time credit: people giving time earn, people receiving time pay, and in a
 * workshop the hours left over go to the community time fund.
 */
final class GroupExchangeSplitCalculatorTest extends TestCase
{
    /** @return array{user_id:int, role:string, hours:float, weight:float} */
    private static function p(int $id, string $role, float $hours = 0, float $weight = 1): array
    {
        return ['user_id' => $id, 'role' => $role, 'hours' => $hours, 'weight' => $weight];
    }

    /** @return array<string, float> keyed "<user_id><p|r>" */
    private static function hoursById(array $result): array
    {
        $out = [];
        foreach ($result['lines'] as $line) {
            $out[$line['user_id'] . $line['role'][0]] = $line['hours'];
        }

        return $out;
    }

    public function test_workshop_giver_earns_own_hours_attendees_pay_theirs_leftover_to_fund(): void
    {
        $r = Calc::compute('workshop', 2, [
            self::p(1, 'provider', 2),
            self::p(2, 'receiver', 2), self::p(3, 'receiver', 2), self::p(4, 'receiver', 2), self::p(5, 'receiver', 2),
        ]);

        self::assertNull($r['problem']);
        self::assertSame(['1p' => 2.0, '2r' => 2.0, '3r' => 2.0, '4r' => 2.0, '5r' => 2.0], self::hoursById($r));
        self::assertSame(2.0, $r['earned']);
        self::assertSame(8.0, $r['paid']);
        self::assertSame(6.0, $r['community_fund_hours']);
    }

    public function test_workshop_attendee_who_left_early_pays_less(): void
    {
        $r = Calc::compute('workshop', 2, [self::p(1, 'provider', 2), self::p(2, 'receiver', 2), self::p(3, 'receiver', 1.5)]);

        self::assertSame(3.5, $r['paid']);
        self::assertSame(1.5, $r['community_fund_hours']);
    }

    public function test_workshop_with_nothing_left_over_has_zero_fund_share(): void
    {
        $r = Calc::compute('workshop', 1, [self::p(1, 'provider', 1), self::p(2, 'receiver', 1)]);

        self::assertNull($r['problem']);
        self::assertSame(0.0, $r['community_fund_hours']);
    }

    public function test_workshop_refuses_when_givers_would_earn_more_than_attendees_pay(): void
    {
        $r = Calc::compute('workshop', 1, [self::p(1, 'provider', 1), self::p(2, 'provider', 1), self::p(3, 'receiver', 1)]);

        self::assertSame('EARNED_EXCEEDS_PAID', $r['problem']);
    }

    public function test_team_person_helped_pays_every_helper(): void
    {
        $r = Calc::compute('team', 1, [self::p(1, 'provider', 1), self::p(2, 'provider', 1), self::p(3, 'receiver')]);

        self::assertNull($r['problem']);
        self::assertSame(['1p' => 1.0, '2p' => 1.0, '3r' => 2.0], self::hoursById($r));
        self::assertSame(0.0, $r['community_fund_hours']);
    }

    public function test_team_cost_shared_by_three_people_conserves_to_the_cent(): void
    {
        $r = Calc::compute('team', 1.25, [
            self::p(1, 'provider', 1.25), self::p(2, 'provider', 1.25),
            self::p(3, 'receiver'), self::p(4, 'receiver'), self::p(5, 'receiver'),
        ]);

        self::assertSame(['1p' => 1.25, '2p' => 1.25, '3r' => 0.83, '4r' => 0.83, '5r' => 0.84], self::hoursById($r));
        self::assertSame($r['earned'], $r['paid']);
    }

    /** @return iterable<string, array{string}> */
    public static function ownHoursKinds(): iterable
    {
        yield 'workshop' => ['workshop'];
        yield 'team' => ['team'];
        yield 'custom' => ['custom'];
    }

    /** @dataProvider ownHoursKinds */
    public function test_zero_or_missing_hours_are_refused_not_skipped(string $kind): void
    {
        $r = Calc::compute($kind, 1, [self::p(1, 'provider', 0), self::p(2, 'receiver', 1)]);

        self::assertSame('HOURS_MISSING', $r['problem']);
    }

    public function test_equal_split_is_unchanged(): void
    {
        $r = Calc::compute('equal', 10, [
            self::p(1, 'provider'), self::p(2, 'provider'),
            self::p(3, 'receiver'), self::p(4, 'receiver'), self::p(5, 'receiver'),
        ]);

        self::assertSame(['1p' => 5.0, '2p' => 5.0, '3r' => 3.33, '4r' => 3.33, '5r' => 3.34], self::hoursById($r));
        self::assertNull($r['problem']);
    }

    public function test_weighted_split_is_unchanged(): void
    {
        $r = Calc::compute('weighted', 6, [self::p(1, 'provider', 0, 2), self::p(2, 'provider', 0, 1), self::p(3, 'receiver')]);

        self::assertSame(['1p' => 4.0, '2p' => 2.0, '3r' => 6.0], self::hoursById($r));
    }

    public function test_custom_keeps_each_persons_hours_and_reports_an_imbalance(): void
    {
        $ok = Calc::compute('custom', 0, [self::p(1, 'provider', 3), self::p(2, 'receiver', 3)]);
        self::assertNull($ok['problem']);
        self::assertSame(['1p' => 3.0, '2r' => 3.0], self::hoursById($ok));

        $bad = Calc::compute('custom', 0, [self::p(1, 'provider', 3), self::p(2, 'receiver', 2)]);
        self::assertSame('UNBALANCED', $bad['problem']);
    }

    public function test_missing_roles_and_unknown_kind(): void
    {
        self::assertSame('NO_RECEIVERS', Calc::compute('workshop', 1, [self::p(1, 'provider', 1)])['problem']);
        self::assertSame('NO_GIVERS', Calc::compute('team', 1, [self::p(1, 'receiver', 1)])['problem']);
        $unknown = Calc::compute('banana', 1, [self::p(1, 'provider', 1), self::p(2, 'receiver', 1)]);
        self::assertSame('SPLIT_TYPE_INVALID', $unknown['problem']);
        self::assertSame([], $unknown['lines']);
    }

    public function test_kinds_are_listed_in_the_order_members_see_them(): void
    {
        self::assertSame(['workshop', 'team', 'equal', 'weighted', 'custom'], Calc::KINDS);
    }
}
