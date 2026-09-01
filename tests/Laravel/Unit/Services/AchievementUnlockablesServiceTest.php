<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\AchievementUnlockablesService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Real-DB tests for AchievementUnlockablesService (profile themes/frames/etc.
 * unlocked through level + badges).
 *
 * Previously the DB-touching tests used DB::shouldReceive() stubs, which assert
 * nothing about real behaviour. They now create real users / user_badges rows
 * and assert the real unlock logic (level requirements, badge requirements,
 * available vs locked partitioning).
 *
 * SCHEMA NOTE (corrected 2026-09-01) — three of these tests used to be skipped,
 * on the grounds that `user_active_unlockables.tenant_id` was missing from the
 * test database and that this was "schema drift, not a logic bug". That reading
 * was backwards. The committed schema dump, the development database and the
 * test database all agree the column has never existed; the service was querying
 * a column that was never there, so every equip, unequip and read of an equipped
 * item threw "SQLSTATE[42S22] Unknown column 'tenant_id'" in production too.
 * The service now scopes by user_id alone — a user belongs to exactly one tenant,
 * so the row is already scoped — and these tests exercise the real round trip.
 */
class AchievementUnlockablesServiceTest extends TestCase
{
    use DatabaseTransactions;

    // --- Static data (no DB) — kept as real structural assertions ---

    public function test_constants_defined(): void
    {
        $this->assertNotEmpty(AchievementUnlockablesService::TYPES);
        $this->assertArrayHasKey('theme', AchievementUnlockablesService::TYPES);
        $this->assertArrayHasKey('avatar_frame', AchievementUnlockablesService::TYPES);
    }

    public function test_getAllUnlockables_returns_expected_categories(): void
    {
        $all = AchievementUnlockablesService::getAllUnlockables();

        $this->assertArrayHasKey('themes', $all);
        $this->assertArrayHasKey('frames', $all);
        $this->assertArrayHasKey('name_colors', $all);
        $this->assertArrayHasKey('banners', $all);
        $this->assertArrayHasKey('special_emojis', $all);
    }

    public function test_getAllUnlockables_themes_have_required_fields(): void
    {
        $all = AchievementUnlockablesService::getAllUnlockables();

        foreach ($all['themes'] as $key => $theme) {
            $this->assertArrayHasKey('name', $theme, "Theme $key missing name");
            $this->assertArrayHasKey('type', $theme, "Theme $key missing type");
            $this->assertArrayHasKey('requirement', $theme, "Theme $key missing requirement");
            $this->assertSame('theme', $theme['type']);
        }
    }

    // --- Real-DB unlock logic (converted from DB::shouldReceive stubs) ---

    public function test_getUserUnlockables_returns_available_and_locked(): void
    {
        // A level-1 user with no badges: nothing is unlocked (lowest level
        // requirement is frame_bronze at level 5).
        $user = User::factory()->forTenant($this->testTenantId)->create(['level' => 1]);
        TenantContext::setById($this->testTenantId);

        $result = AchievementUnlockablesService::getUserUnlockables((int) $user->id);

        $this->assertArrayHasKey('available', $result);
        $this->assertArrayHasKey('locked', $result);

        // Nothing unlocked at level 1 with no badges.
        $this->assertSame([], $result['available']);

        // theme_dark_gold (requires level 10) must be locked for a level-1 user.
        $this->assertArrayHasKey('themes', $result['locked']);
        $this->assertArrayHasKey('theme_dark_gold', $result['locked']['themes']);
        $this->assertFalse($result['locked']['themes']['theme_dark_gold']['unlocked']);
    }

    public function test_getUserUnlockables_unlocks_by_level_and_badge(): void
    {
        // High level + a badge: level-gated items and the matching badge-gated
        // item must both land in `available`.
        $user = User::factory()->forTenant($this->testTenantId)->create(['level' => 50]);
        DB::table('user_badges')->insert([
            'tenant_id'  => $this->testTenantId,
            'user_id'    => $user->id,
            'badge_key'  => 'volunteer_5',
            'awarded_at' => now(),
        ]);
        TenantContext::setById($this->testTenantId);

        $result = AchievementUnlockablesService::getUserUnlockables((int) $user->id);

        // Level-gated theme (level 10) unlocked for a level-50 user.
        $this->assertArrayHasKey('themes', $result['available']);
        $this->assertArrayHasKey('theme_dark_gold', $result['available']['themes']);
        $this->assertTrue($result['available']['themes']['theme_dark_gold']['unlocked']);
        $this->assertSame('themes', $result['available']['themes']['theme_dark_gold']['category']);
        $this->assertSame('theme_dark_gold', $result['available']['themes']['theme_dark_gold']['key']);

        // Badge-gated theme (requires badge volunteer_5) is unlocked via the badge.
        $this->assertArrayHasKey('theme_forest', $result['available']['themes']);

        // Highest level item (theme_legendary, level 50) is unlocked at exactly level 50.
        $this->assertArrayHasKey('theme_legendary', $result['available']['themes']);

        // A badge the user does NOT hold keeps its item locked (emoji_fire needs streak_7).
        $this->assertArrayHasKey('special_emojis', $result['locked']);
        $this->assertArrayHasKey('emoji_fire', $result['locked']['special_emojis']);
    }

    public function test_setActiveUnlockable_returns_false_when_not_unlocked(): void
    {
        // A level-1 user has unlocked nothing, so setActiveUnlockable must return
        // false before it writes anything.
        $user = User::factory()->forTenant($this->testTenantId)->create(['level' => 1]);
        TenantContext::setById($this->testTenantId);

        $result = AchievementUnlockablesService::setActiveUnlockable(
            (int) $user->id,
            'theme',
            'theme_legendary'
        );

        $this->assertFalse($result);
    }

    // --- Equipping: the real round trip against user_active_unlockables ---

    public function test_getUserActiveUnlockables_returns_equipped_items_keyed_by_type(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['level' => 50]);
        TenantContext::setById($this->testTenantId);

        DB::table('user_active_unlockables')->insert([
            'user_id'         => $user->id,
            'unlockable_type' => 'theme',
            'unlockable_key'  => 'theme_legendary',
            'activated_at'    => now(),
        ]);

        $active = AchievementUnlockablesService::getUserActiveUnlockables((int) $user->id);

        $this->assertSame(['theme' => 'theme_legendary'], $active);
    }

    public function test_setActiveUnlockable_persists_the_choice(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['level' => 50]);
        TenantContext::setById($this->testTenantId);

        $result = AchievementUnlockablesService::setActiveUnlockable(
            (int) $user->id,
            'theme',
            'theme_legendary'
        );

        $this->assertTrue($result);
        $this->assertSame(
            ['theme' => 'theme_legendary'],
            AchievementUnlockablesService::getUserActiveUnlockables((int) $user->id)
        );
    }

    public function test_setActiveUnlockable_replaces_rather_than_duplicates(): void
    {
        // The upsert's conflict target must match the real unique index,
        // `unique_user_type` (user_id, unlockable_type). If it names a column
        // that is not in that index, equipping a second theme either throws or
        // leaves the member with two equipped themes at once.
        $user = User::factory()->forTenant($this->testTenantId)->create(['level' => 50]);
        TenantContext::setById($this->testTenantId);

        AchievementUnlockablesService::setActiveUnlockable((int) $user->id, 'theme', 'theme_legendary');
        AchievementUnlockablesService::setActiveUnlockable((int) $user->id, 'theme', 'theme_dark_gold');

        $rows = DB::table('user_active_unlockables')
            ->where('user_id', $user->id)
            ->where('unlockable_type', 'theme')
            ->get();

        $this->assertCount(1, $rows, 'Equipping a second theme must replace the first, not add a row.');
        $this->assertSame('theme_dark_gold', $rows[0]->unlockable_key);
    }

    public function test_removeActiveUnlockable_deletes_the_equipped_row(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['level' => 50]);
        TenantContext::setById($this->testTenantId);

        AchievementUnlockablesService::setActiveUnlockable((int) $user->id, 'theme', 'theme_legendary');
        $this->assertNotEmpty(AchievementUnlockablesService::getUserActiveUnlockables((int) $user->id));

        $result = AchievementUnlockablesService::removeActiveUnlockable((int) $user->id, 'theme');

        $this->assertTrue($result);
        $this->assertSame([], AchievementUnlockablesService::getUserActiveUnlockables((int) $user->id));
    }
}
