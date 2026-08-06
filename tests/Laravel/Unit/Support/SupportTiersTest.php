<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Support;

use App\Support\Safeguarding\SupportTiers;
use PHPUnit\Framework\TestCase;

/**
 * SupportTiers is the permission arithmetic for the three-tier support model
 * (assist / co_decide / represent). Getting any of this wrong grants or
 * withholds real power over a supported member's listings and credits, so the
 * rules are pinned exhaustively:
 *
 * - legacy boolean rows resolve to the tiers that preserve today's behaviour;
 * - corrupted or unknown values degrade toward LESS power, never more;
 * - co_decide never satisfies an act-alone (represent) requirement;
 * - messages are not a capability at any tier;
 * - expansion detection is rank-based and one-directional;
 * - the staff ceiling clamps represent to co_decide.
 */
final class SupportTiersTest extends TestCase
{
    // ── resolve(): legacy boolean rows ────────────────────────────────────

    public function test_legacy_view_activity_true_resolves_to_assist(): void
    {
        $tiers = SupportTiers::resolve(['can_view_activity' => true]);

        $this->assertSame(SupportTiers::ASSIST, $tiers['activity']);
        $this->assertSame(SupportTiers::NONE, $tiers['listings']);
        $this->assertSame(SupportTiers::NONE, $tiers['credits']);
    }

    public function test_legacy_manage_listings_and_transact_resolve_to_represent(): void
    {
        $tiers = SupportTiers::resolve([
            'can_manage_listings' => true,
            'can_transact' => true,
        ]);

        $this->assertSame(SupportTiers::REPRESENT, $tiers['listings']);
        $this->assertSame(SupportTiers::REPRESENT, $tiers['credits']);
        $this->assertSame(SupportTiers::NONE, $tiers['activity']);
    }

    public function test_legacy_view_messages_resolves_to_nothing_at_all(): void
    {
        // can_view_messages was never enforced and maps to NO capability.
        $tiers = SupportTiers::resolve(['can_view_messages' => true]);

        $this->assertSame(SupportTiers::noneGranted(), $tiers);
    }

    public function test_all_false_row_and_empty_row_and_garbage_resolve_to_none(): void
    {
        $none = SupportTiers::noneGranted();

        $this->assertSame($none, SupportTiers::resolve([
            'can_view_activity' => false,
            'can_manage_listings' => false,
            'can_transact' => false,
            'can_view_messages' => false,
        ]));
        $this->assertSame($none, SupportTiers::resolve([]));
        $this->assertSame($none, SupportTiers::resolve(null));
        $this->assertSame($none, SupportTiers::resolve('not-an-array'));
    }

    // ── resolve(): explicit tiers object ──────────────────────────────────

    public function test_tiers_object_overrides_legacy_booleans_per_capability(): void
    {
        // Row has legacy can_manage_listings=true (represent) but the tiers
        // object downgrades listings to co_decide. The explicit tier wins.
        $tiers = SupportTiers::resolve([
            'can_manage_listings' => true,
            'can_view_activity' => true,
            'tiers' => ['listings' => SupportTiers::CO_DECIDE],
        ]);

        $this->assertSame(SupportTiers::CO_DECIDE, $tiers['listings']);
        // Capabilities absent from the tiers object keep their legacy floor.
        $this->assertSame(SupportTiers::ASSIST, $tiers['activity']);
    }

    public function test_invalid_tier_value_falls_back_to_legacy_never_to_more_power(): void
    {
        $tiers = SupportTiers::resolve([
            'can_manage_listings' => false,
            'tiers' => ['listings' => 'superuser'], // corrupted / unknown
        ]);

        $this->assertSame(SupportTiers::NONE, $tiers['listings']);
    }

    public function test_unknown_capability_in_tiers_object_is_ignored(): void
    {
        $tiers = SupportTiers::resolve([
            'tiers' => ['messages' => SupportTiers::REPRESENT, 'wallet' => SupportTiers::ASSIST],
        ]);

        $this->assertSame(SupportTiers::noneGranted(), $tiers);
        $this->assertArrayNotHasKey('messages', $tiers);
    }

    // ── atLeast(): the act-alone boundary ─────────────────────────────────

    public function test_co_decide_never_satisfies_a_represent_requirement(): void
    {
        $tiers = ['listings' => SupportTiers::CO_DECIDE, 'credits' => SupportTiers::CO_DECIDE, 'activity' => SupportTiers::CO_DECIDE];

        $this->assertFalse(SupportTiers::atLeast($tiers, 'listings', SupportTiers::REPRESENT));
        $this->assertFalse(SupportTiers::atLeast($tiers, 'credits', SupportTiers::REPRESENT));
        $this->assertTrue(SupportTiers::atLeast($tiers, 'listings', SupportTiers::CO_DECIDE));
        $this->assertTrue(SupportTiers::atLeast($tiers, 'listings', SupportTiers::ASSIST));
    }

    public function test_at_least_rejects_unknown_capability_and_unknown_required_tier(): void
    {
        $all = array_fill_keys(SupportTiers::CAPABILITIES, SupportTiers::REPRESENT);

        $this->assertFalse(SupportTiers::atLeast($all, 'messages', SupportTiers::ASSIST));
        $this->assertFalse(SupportTiers::atLeast($all, 'listings', 'superuser'));
    }

    public function test_at_least_treats_missing_or_non_string_held_tier_as_none(): void
    {
        $this->assertFalse(SupportTiers::atLeast([], 'listings', SupportTiers::ASSIST));
        $this->assertFalse(SupportTiers::atLeast(['listings' => 3], 'listings', SupportTiers::ASSIST));
    }

    // ── sanitizeTiers() ───────────────────────────────────────────────────

    public function test_sanitize_keeps_valid_entries_and_drops_everything_else(): void
    {
        $clean = SupportTiers::sanitizeTiers([
            'listings' => SupportTiers::CO_DECIDE,
            'credits' => 'superuser',          // invalid tier → dropped
            'messages' => SupportTiers::ASSIST, // unknown capability → dropped
            'activity' => 7,                    // non-string → dropped
        ]);

        $this->assertSame(['listings' => SupportTiers::CO_DECIDE], $clean);
        $this->assertSame([], SupportTiers::sanitizeTiers('garbage'));
        $this->assertSame([], SupportTiers::sanitizeTiers(null));
    }

    // ── isExpansion() ─────────────────────────────────────────────────────

    public function test_raising_any_capability_is_an_expansion(): void
    {
        $before = SupportTiers::noneGranted();
        $after = SupportTiers::noneGranted();
        $after['credits'] = SupportTiers::ASSIST;

        $this->assertTrue(SupportTiers::isExpansion($before, $after));
    }

    public function test_shrinking_or_unchanged_is_never_an_expansion(): void
    {
        $before = ['activity' => SupportTiers::ASSIST, 'listings' => SupportTiers::REPRESENT, 'credits' => SupportTiers::CO_DECIDE];
        $shrunk = ['activity' => SupportTiers::NONE, 'listings' => SupportTiers::CO_DECIDE, 'credits' => SupportTiers::NONE];

        $this->assertFalse(SupportTiers::isExpansion($before, $shrunk));
        $this->assertFalse(SupportTiers::isExpansion($before, $before));
    }

    public function test_simultaneous_shrink_and_raise_is_an_expansion(): void
    {
        // Dropping listings while raising credits still needs fresh consent —
        // the raise is what matters, not the net.
        $before = ['activity' => SupportTiers::NONE, 'listings' => SupportTiers::REPRESENT, 'credits' => SupportTiers::NONE];
        $after = ['activity' => SupportTiers::NONE, 'listings' => SupportTiers::NONE, 'credits' => SupportTiers::ASSIST];

        $this->assertTrue(SupportTiers::isExpansion($before, $after));
    }

    // ── toLegacyBooleans(): round-trip with today's readers ───────────────

    public function test_legacy_projection_matches_what_each_boolean_always_meant(): void
    {
        $booleans = SupportTiers::toLegacyBooleans([
            'activity' => SupportTiers::ASSIST,
            'listings' => SupportTiers::CO_DECIDE,  // may NOT act alone
            'credits' => SupportTiers::REPRESENT,
        ]);

        $this->assertSame([
            'can_view_activity' => true,
            'can_manage_listings' => false, // co_decide is not act-alone
            'can_transact' => true,
            'can_view_messages' => false,
        ], $booleans);
    }

    public function test_legacy_projection_never_emits_view_messages_true(): void
    {
        $maxEverything = array_fill_keys(SupportTiers::CAPABILITIES, SupportTiers::REPRESENT);

        $this->assertFalse(SupportTiers::toLegacyBooleans($maxEverything)['can_view_messages']);
    }

    public function test_legacy_row_round_trips_unchanged_through_resolve_and_project(): void
    {
        // Pre-tier rows must keep exactly today's behaviour after a
        // resolve → project cycle: this is the no-data-migration guarantee.
        $legacyRow = [
            'can_view_activity' => true,
            'can_manage_listings' => true,
            'can_transact' => false,
            'can_view_messages' => true, // stored by an old client; stays dead
        ];

        $projected = SupportTiers::toLegacyBooleans(SupportTiers::resolve($legacyRow));

        $this->assertSame([
            'can_view_activity' => true,
            'can_manage_listings' => true,
            'can_transact' => false,
            'can_view_messages' => false,
        ], $projected);
    }

    // ── legacyRequirement(): the boolean-vocabulary translation point ─────

    public function test_legacy_requirement_maps_the_three_real_permissions(): void
    {
        $this->assertSame(['activity', SupportTiers::ASSIST], SupportTiers::legacyRequirement('can_view_activity'));
        $this->assertSame(['listings', SupportTiers::REPRESENT], SupportTiers::legacyRequirement('can_manage_listings'));
        $this->assertSame(['credits', SupportTiers::REPRESENT], SupportTiers::legacyRequirement('can_transact'));
    }

    public function test_legacy_requirement_is_null_for_messages_and_unknown_keys(): void
    {
        $this->assertNull(SupportTiers::legacyRequirement('can_view_messages'));
        $this->assertNull(SupportTiers::legacyRequirement('tiers'));
        $this->assertNull(SupportTiers::legacyRequirement('can_do_anything'));
    }

    // ── capForStaff(): the broker ceiling ─────────────────────────────────

    public function test_staff_cap_clamps_represent_to_co_decide_and_leaves_lower_tiers_alone(): void
    {
        $capped = SupportTiers::capForStaff([
            'activity' => SupportTiers::ASSIST,
            'listings' => SupportTiers::REPRESENT,
            'credits' => SupportTiers::CO_DECIDE,
        ]);

        $this->assertSame([
            'activity' => SupportTiers::ASSIST,
            'listings' => SupportTiers::CO_DECIDE,
            'credits' => SupportTiers::CO_DECIDE,
        ], $capped);
    }
}
