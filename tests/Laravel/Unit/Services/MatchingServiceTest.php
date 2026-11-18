<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Models\User;
use App\Services\MatchingService;
use App\Services\SmartMatchingEngine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * A member's matching preferences, against a real database.
 *
 * This file used to test getSuggestionsForUser() / getHotMatches() /
 * getMutualMatches() / getMatchesByType() with a faked database. Those
 * methods returned random members, not matches, and were removed on
 * 17 Nov 2026 (see Matching\MatchNotificationService). What a member is
 * matched with is covered in Feature/Matching/MatchingJourneyTest.
 */
class MatchingServiceTest extends TestCase
{
    use DatabaseTransactions;

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => 1]);
    }

    private function setMatchingConfig(array $changes): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $config = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $config['algorithms']['smart_matching'] = array_merge($config['algorithms']['smart_matching'] ?? [], $changes);
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
        app(SmartMatchingEngine::class)->clearCache();
    }

    public function test_defaults_are_the_communitys_settings_and_every_key_is_present(): void
    {
        $this->setMatchingConfig(['max_distance_km' => 80, 'min_match_score' => 45]);

        $prefs = MatchingService::getPreferences($this->member()->id);

        $this->assertSame(80, $prefs['max_distance_km']);
        $this->assertSame(45, $prefs['min_match_score']);
        $this->assertSame(80, $prefs['max_distance_limit_km']);
        $this->assertSame('monthly', $prefs['notification_frequency']);
        $this->assertTrue($prefs['notify_hot_matches']);
        $this->assertTrue($prefs['notify_mutual_matches']);
        $this->assertFalse($prefs['matching_paused']);
        $this->assertSame([], $prefs['categories']);
        $this->assertSame([], $prefs['availability']);
    }

    public function test_saved_preferences_round_trip(): void
    {
        $member = $this->member();

        $this->assertTrue(MatchingService::savePreferences($member->id, [
            'max_distance_km' => 12,
            'min_match_score' => 65,
            'notification_frequency' => 'daily',
            'notify_hot_matches' => false,
            'notify_mutual_matches' => true,
            'matching_paused' => true,
            'categories' => [3, 5],
            'availability' => ['weekends'],
        ]));

        $prefs = MatchingService::getPreferences($member->id);

        $this->assertSame(12, $prefs['max_distance_km']);
        $this->assertSame(65, $prefs['min_match_score']);
        $this->assertSame('daily', $prefs['notification_frequency']);
        $this->assertFalse($prefs['notify_hot_matches']);
        $this->assertTrue($prefs['notify_mutual_matches']);
        $this->assertTrue($prefs['matching_paused']);
        $this->assertSame([3, 5], $prefs['categories']);
        $this->assertSame(['weekends'], $prefs['availability']);
    }

    public function test_a_saved_distance_above_the_communitys_ceiling_is_shown_as_the_ceiling(): void
    {
        $member = $this->member();
        MatchingService::savePreferences($member->id, ['max_distance_km' => 90]);
        $this->setMatchingConfig(['max_distance_km' => 30]);

        $prefs = MatchingService::getPreferences($member->id);

        $this->assertSame(30, $prefs['max_distance_km'], 'The engine caps at the community ceiling, so the page must show that figure');
        $this->assertSame(30, $prefs['max_distance_limit_km']);
    }

    public function test_clearing_the_category_choice_stores_null_meaning_all(): void
    {
        $member = $this->member();
        MatchingService::savePreferences($member->id, ['categories' => [4]]);
        MatchingService::savePreferences($member->id, ['categories' => []]);

        $this->assertNull(DB::table('match_preferences')->where('user_id', $member->id)->value('categories'));
        $this->assertSame([], MatchingService::getPreferences($member->id)['categories']);
    }
}
