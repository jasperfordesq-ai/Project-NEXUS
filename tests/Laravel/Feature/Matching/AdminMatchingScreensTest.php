<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Matching;

use App\Models\Category;
use App\Models\Listing;
use App\Models\User;
use App\Services\SafeguardingInteractionPolicy;
use App\Services\SmartMatchingAnalyticsService;
use App\Services\SmartMatchingEngine;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * The endpoints behind the admin, broker and platform-team smart-matching
 * screens, against a real database.
 *
 * Each test pins one thing an admin or broker used to see wrongly
 * (audit of 17 November 2026):
 *  - a "Broker approval" switch and a band "Score" column that changed nothing;
 *  - settings saved with no limits (a maximum distance of -5, a minimum score
 *    of 500);
 *  - analytics that counted expired matches, dropped scores such as 40.70
 *    between two buckets, and counted "hot" at a fixed 80;
 *  - one "…not found" answer for three different refused approvals;
 *  - tab counts for the last 30 days above all-time lists;
 *  - "Diagnose" buttons that printed the same figures for every id.
 */
class AdminMatchingScreensTest extends TestCase
{
    use DatabaseTransactions;

    private const OTHER_TENANT_ID = 999;

    protected function setUp(): void
    {
        parent::setUp();
        // The engine is a container singleton with an in-process config cache.
        app(SmartMatchingEngine::class)->clearCache();
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create();
    }

    /** The Matching diagnostic page is the platform team's. */
    private function platformTeam(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => 1,
            'role' => 'super_admin',
            'is_super_admin' => true,
            'is_god' => true,
        ]);
    }

    private function member(array $attrs = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => 1,
            'latitude' => 51.5000,
            'longitude' => -0.1200,
            'last_active_at' => now(),
        ], $attrs));
    }

    private function listing(User $owner, array $attrs = []): Listing
    {
        return Listing::factory()->forTenant($this->testTenantId)->create(array_merge([
            'user_id' => $owner->id,
            'type' => 'offer',
            'status' => 'active',
            'title' => 'Gardening help ' . uniqid(),
            'service_type' => 'physical_only',
            'latitude' => 51.5000,
            'longitude' => -0.1200,
        ], $attrs));
    }

    private function cacheRow(User $user, Listing $listing, float $score, array $attrs = []): void
    {
        DB::table('match_cache')->insert(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'listing_id' => $listing->id,
            'match_score' => $score,
            'distance_km' => 3.2,
            'match_type' => 'one_way',
            'match_reasons' => json_encode([]),
            'algorithm_version' => 'v2',
            'status' => 'new',
            'created_at' => now(),
            'expires_at' => now()->addDays(7),
        ], $attrs));
    }

    /** @return array<string, mixed> the stored smart_matching block */
    private function storedConfig(): array
    {
        $json = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $config = $json ? json_decode((string) $json, true) : [];

        return $config['algorithms']['smart_matching'] ?? [];
    }

    private function storeConfig(array $smartMatching): void
    {
        $json = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $config = $json ? (json_decode((string) $json, true) ?: []) : [];
        $config['algorithms']['smart_matching'] = $smartMatching;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
        app(SmartMatchingEngine::class)->clearCache();
    }

    private function pendingApproval(?User $matchedUser = null, ?User $owner = null, array $attrs = []): int
    {
        $matchedUser ??= $this->member();
        $owner ??= $this->member();

        return (int) DB::table('match_approvals')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $matchedUser->id,
            'listing_id' => $this->listing($owner)->id,
            'listing_owner_id' => $owner->id,
            'match_score' => 82.50,
            'match_type' => 'one_way',
            'match_reasons' => json_encode(['Nearby']),
            'status' => 'pending',
            'submitted_at' => now(),
        ], $attrs));
    }

    private function denyContact(): void
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateLocalContact')->andReturn(new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::DENY,
            code: 'VETTING_REQUIRED',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
        ));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }

    // =====================================================================
    // Settings: what is returned
    // =====================================================================

    public function test_config_no_longer_offers_the_approval_switch_or_band_scores(): void
    {
        Sanctum::actingAs($this->admin());

        $data = $this->apiGet('/v2/admin/matching/config')->assertStatus(200)->json('data');

        $this->assertArrayNotHasKey('broker_approval_enabled', $data);
        $this->assertCount(5, $data['proximity_bands']);
        foreach ($data['proximity_bands'] as $band) {
            $this->assertSame(['distance_km'], array_keys($band), 'A band is a distance; its score is fixed in the scorer');
        }
        $this->assertArrayHasKey('pillars', $data);
        $this->assertArrayHasKey('engine_version', $data);
    }

    // =====================================================================
    // Settings: what is refused
    // =====================================================================

    /** @return array<string, array{0: array<string, mixed>, 1: string}> */
    public static function refusedSettings(): array
    {
        $bands = fn (array $km) => array_map(fn ($d) => ['distance_km' => $d], $km);

        return [
            'negative maximum distance' => [['max_distance_km' => -5], 'max_distance_km'],
            'zero maximum distance' => [['max_distance_km' => 0], 'max_distance_km'],
            'maximum distance beyond the planet' => [['max_distance_km' => 20001], 'max_distance_km'],
            'maximum distance that is not a number' => [['max_distance_km' => 'far'], 'max_distance_km'],
            'minimum score above 100' => [['min_match_score' => 500], 'min_match_score'],
            'minimum score below 0' => [['min_match_score' => -1], 'min_match_score'],
            'hot score above 100' => [['hot_match_threshold' => 101], 'hot_match_threshold'],
            'hot score below the minimum' => [['min_match_score' => 70, 'hot_match_threshold' => 60], 'hot_match_threshold'],
            'bands out of order' => [['proximity_bands' => $bands([5, 30, 15, 50, 100])], 'proximity_bands'],
            'two bands the same' => [['proximity_bands' => $bands([5, 15, 15, 50, 100])], 'proximity_bands'],
            'a band of zero' => [['proximity_bands' => $bands([0, 15, 30, 50, 100])], 'proximity_bands'],
            'four bands' => [['proximity_bands' => $bands([5, 15, 30, 50])], 'proximity_bands'],
            'all three weights zero' => [['pillars' => ['relevance' => 0, 'feasibility' => 0, 'trust' => 0]], 'pillars'],
            'a weight above 100%' => [['pillars' => ['relevance' => 1.5, 'feasibility' => 0.3, 'trust' => 0.2]], 'pillars'],
            'an older weight above 100%' => [['category_weight' => 2], 'category_weight'],
        ];
    }

    /**
     * @dataProvider refusedSettings
     * @param array<string, mixed> $payload
     */
    public function test_update_config_refuses_values_that_would_break_matching(array $payload, string $field): void
    {
        Sanctum::actingAs($this->admin());
        $before = $this->storedConfig();

        $response = $this->apiPut('/v2/admin/matching/config', $payload);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
        $response->assertJsonPath('errors.0.field', $field);
        $this->assertNotSame('', (string) $response->json('errors.0.message'));
        $this->assertStringNotContainsString('api.matching_', (string) $response->json('errors.0.message'), 'The message must be translated text, not its key');
        $this->assertSame($before, $this->storedConfig(), 'A refused save must not change anything');
    }

    public function test_changing_the_matching_settings_and_clearing_stored_matches_leave_a_record(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $this->apiPut('/v2/admin/matching/config', ['enabled' => false, 'min_match_score' => 35])->assertStatus(200);
        $this->apiPost('/v2/admin/matching/cache/clear')->assertStatus(200);

        $actions = DB::table('org_audit_log')->where('tenant_id', $this->testTenantId)->where('user_id', $admin->id)
            ->whereIn('action', ['matching_config_updated', 'match_cache_cleared'])->pluck('details', 'action');
        $this->assertTrue($actions->has('matching_config_updated'), 'Switching matching off for a whole community left no record of who or when');
        $this->assertTrue($actions->has('match_cache_cleared'));
        $this->assertStringContainsString('enabled', (string) $actions['matching_config_updated']);
    }

    public function test_the_diagnosis_does_not_call_a_member_with_profile_skills_unmatchable(): void
    {
        $member = $this->member();
        DB::table('user_skills')->insert([
            'user_id' => $member->id, 'tenant_id' => $this->testTenantId, 'skill_name' => 'Gardening',
            'proficiency' => 'intermediate', 'is_offering' => 1, 'is_requesting' => 0,
        ]);
        Sanctum::actingAs($this->platformTeam());

        $data = $this->apiGet("/v2/admin/matching/diagnose/user/{$member->id}")->assertStatus(200)->json('data');

        $this->assertNotContains('no_active_listings', $data['findings'], 'Members with no listing have been matched by their profile skills since 18 Nov 2026');
    }

    public function test_the_diagnosis_knows_the_community_centre_stands_in_for_a_missing_location(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'latitude' => 53.3498, 'longitude' => -6.2603, 'service_area' => 'local',
        ]);
        app(SmartMatchingEngine::class)->clearCache();
        $member = $this->member(['latitude' => null, 'longitude' => null]);
        $listing = $this->listing($this->member(['latitude' => null, 'longitude' => null]), [
            'latitude' => null, 'longitude' => null, 'service_type' => 'physical_only',
        ]);
        Sanctum::actingAs($this->platformTeam());

        $forMember = $this->apiGet("/v2/admin/matching/diagnose/user/{$member->id}")->assertStatus(200)->json('data');
        $forListing = $this->apiGet("/v2/admin/matching/diagnose/listing/{$listing->id}")->assertStatus(200)->json('data');

        $this->assertNotContains('no_location_remote_only', $forMember['findings'], 'The engine places such a member at the community centre: they are not limited to remote listings');
        $this->assertNotContains('no_location_in_person', $forListing['findings']);
    }

    public function test_the_diagnosis_says_an_expired_listing_is_not_being_matched(): void
    {
        $listing = $this->listing($this->member(), ['expires_at' => now()->subDay()]);
        Sanctum::actingAs($this->platformTeam());

        $data = $this->apiGet("/v2/admin/matching/diagnose/listing/{$listing->id}")->assertStatus(200)->json('data');

        $this->assertContains('listing_not_active', $data['findings'], 'The engine never offers a listing past its expiry date');
    }

    public function test_the_admin_figures_leave_out_matches_the_member_has_hidden(): void
    {
        $searcher = $this->member();
        $owner = $this->member();
        $this->cacheRow($searcher, $this->listing($owner), 90.00, ['match_type' => 'mutual']);
        $this->cacheRow($searcher, $this->listing($owner), 95.00, ['match_type' => 'mutual', 'status' => 'dismissed']);
        Sanctum::actingAs($this->admin());

        $overview = $this->apiGet('/v2/admin/matching/stats')->assertStatus(200)->json('data.overview');

        $this->assertSame(1, $overview['total_cached_matches'], 'A match the member hid was still counted as a match');
        $this->assertSame(1, $overview['mutual_matches_count']);
        $this->assertEqualsWithDelta(90.0, (float) $overview['average_score'], 0.01);
    }

    public function test_update_config_keeps_the_gate_and_ai_settings_the_page_has_no_control_for(): void
    {
        // Both are read by the engine and neither has a control on the page.
        // The save rebuilt each block from the page's own keys, so any save
        // put them back to their defaults.
        $this->storeConfig([
            'gates' => ['community_centre_fallback' => false, 'dormancy_days' => 120],
            'ai' => ['listing_enrichment' => false, 'semantic_signal' => true],
        ]);
        Sanctum::actingAs($this->admin());

        $this->apiPut('/v2/admin/matching/config', [
            'enabled' => true,
            'max_distance_km' => 75,
            'min_match_score' => 35,
            'hot_match_threshold' => 70,
            'gates' => ['dormancy_days' => 60],
            'ai' => ['semantic_signal' => false],
        ])->assertStatus(200);

        $stored = $this->storedConfig();
        $this->assertFalse($stored['gates']['community_centre_fallback']);
        $this->assertSame(60, $stored['gates']['dormancy_days']);
        $this->assertFalse($stored['ai']['listing_enrichment']);
        $this->assertFalse($stored['ai']['semantic_signal']);
    }

    public function test_the_page_reads_and_saves_a_switch_for_each_part_of_the_ai_layer(): void
    {
        // Each part costs the community's own AI key, so each has its own switch.
        $switches = ['listing_enrichment', 'wider_reading', 'discovery', 'alert_check'];
        Sanctum::actingAs($this->admin());

        $shown = $this->apiGet('/v2/admin/matching/config')->assertStatus(200)->json('data.ai');
        foreach ($switches as $switch) {
            $this->assertTrue($shown[$switch] ?? null, "{$switch} is on until a community turns it off");
        }

        $this->apiPut('/v2/admin/matching/config', [
            'enabled' => true, 'max_distance_km' => 50, 'min_match_score' => 40, 'hot_match_threshold' => 80,
            'ai' => ['wider_reading' => false, 'discovery' => false, 'alert_check' => false, 'listing_enrichment' => false],
        ])->assertStatus(200);

        $stored = $this->storedConfig();
        $shown = $this->apiGet('/v2/admin/matching/config')->assertStatus(200)->json('data.ai');
        foreach ($switches as $switch) {
            $this->assertFalse($stored['ai'][$switch] ?? null, "{$switch} was not saved");
            $this->assertFalse($shown[$switch] ?? null, "{$switch} is not shown as off");
        }

        // A save that does not mention them leaves them as they are.
        $this->apiPut('/v2/admin/matching/config', [
            'enabled' => true, 'max_distance_km' => 50, 'min_match_score' => 40, 'hot_match_threshold' => 80,
        ])->assertStatus(200);
        $this->assertFalse($this->storedConfig()['ai']['discovery']);
    }

    public function test_the_page_is_told_which_model_matching_uses_and_what_the_ai_has_done(): void
    {
        $set = fn (string $key, string $value) => DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
            ['setting_value' => $value, 'updated_at' => now()]
        );
        $set('ai_enabled', 'true');
        $set('ai_provider', 'anthropic');
        $set('claude_model', 'claude-sonnet-5-5');
        DB::table('ai_settings')->where('tenant_id', $this->testTenantId)->where('setting_key', 'openai_api_key')->delete();

        $owner = $this->member();
        $read = $this->listing($owner);
        $this->listing($owner);
        \Illuminate\Support\Facades\Cache::flush();
        DB::table('listing_match_enrichments')->where('tenant_id', $this->testTenantId)->delete();
        DB::table('listing_match_discoveries')->where('tenant_id', $this->testTenantId)->delete();
        DB::table('match_text_readings')->where('tenant_id', $this->testTenantId)->delete();
        DB::table('listing_match_enrichments')->insert([
            'tenant_id' => $this->testTenantId, 'listing_id' => $read->id, 'content_hash' => str_repeat('a', 64),
            'terms' => '[]', 'concepts' => '[]', 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('listing_match_discoveries')->insert([
            'tenant_id' => $this->testTenantId, 'listing_id' => $read->id, 'content_hash' => str_repeat('a', 64),
            'fits' => '{"l":{},"s":{}}', 'considered' => 3, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('match_text_readings')->insert([
            'tenant_id' => $this->testTenantId, 'text_hash' => str_repeat('b', 64), 'source' => 'skill',
            'terms' => '[]', 'concepts' => '[]', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->cacheRow($this->member(), $read, 30.00, ['ai_rerank_delta' => -15.0]);
        Sanctum::actingAs($this->admin());

        $data = $this->apiGet('/v2/admin/matching/config')->assertStatus(200)->json('data');

        $this->assertSame('anthropic', $data['ai']['provider']);
        $this->assertSame('claude-sonnet-5-5', $data['ai']['model']);
        $this->assertFalse($data['ai']['semantic_available'],
            'The "similar meaning" figures need an OpenAI key; this community has none');
        $status = $data['ai_status'];
        $this->assertSame(1, $status['listings_read']);
        $this->assertSame(1, $status['listings_searched']);
        $this->assertGreaterThanOrEqual(2, $status['listings_active']);
        $this->assertSame(1, $status['texts_read']);
        $this->assertSame(1, $status['poor_fits']);
        $this->assertFalse($status['paused']);

        // The provider refused a request: the catch-up is paused, and the page says so.
        \Illuminate\Support\Facades\Cache::put(\App\Services\Matching\MatchDiscoveryService::backoffKey($this->testTenantId), 1, now()->addHour());
        $this->assertTrue($this->apiGet('/v2/admin/matching/config')->json('data.ai_status.paused'));
    }

    public function test_update_config_saves_valid_settings_and_keeps_what_it_does_not_manage(): void
    {
        // A community that still has the old approval flag and tuned
        // adjustments stored: neither is this screen's to change.
        $this->storeConfig([
            'broker_approval_enabled' => false,
            'adjustments' => ['mutual_bonus' => 11],
        ]);
        Sanctum::actingAs($this->admin());

        $this->apiPut('/v2/admin/matching/config', [
            'enabled' => false,
            'max_distance_km' => 75,
            'min_match_score' => 35,
            'hot_match_threshold' => 70,
            'proximity_bands' => [
                ['distance_km' => 2], ['distance_km' => 10], ['distance_km' => 25],
                ['distance_km' => 60], ['distance_km' => 150],
            ],
            'pillars' => ['relevance' => 0.6, 'feasibility' => 0.3, 'trust' => 0.1],
            // Sent by an old client: must be ignored, not stored.
            'broker_approval_enabled' => true,
        ])->assertStatus(200);

        $stored = $this->storedConfig();
        $this->assertFalse($stored['enabled']);
        $this->assertSame(75, $stored['max_distance_km']);
        $this->assertSame(35, $stored['min_match_score']);
        $this->assertSame(70, $stored['hot_match_threshold']);
        $this->assertSame(
            ['walking_km' => 2, 'local_km' => 10, 'city_km' => 25, 'regional_km' => 60, 'max_km' => 150],
            $stored['proximity']
        );
        $this->assertEqualsWithDelta(0.6, $stored['pillars']['relevance'], 0.0001);
        $this->assertFalse($stored['broker_approval_enabled'], 'The stored flag is left exactly as it was');
        $this->assertSame(11, $stored['adjustments']['mutual_bonus']);

        // …and the engine reads the new values back.
        app(SmartMatchingEngine::class)->clearCache();
        $data = $this->apiGet('/v2/admin/matching/config')->assertStatus(200)->json('data');
        $this->assertFalse($data['enabled']);
        $this->assertSame(75, $data['max_distance_km']);
        $this->assertSame([2, 10, 25, 60, 150], array_column($data['proximity_bands'], 'distance_km'));
    }

    // =====================================================================
    // Analytics
    // =====================================================================

    public function test_stats_count_live_rows_only_in_buckets_without_gaps_and_use_the_configured_hot_score(): void
    {
        $this->storeConfig(['hot_match_threshold' => 40, 'min_match_score' => 10]);
        // Start from a clean cache for this community (rolled back afterwards).
        DB::table('match_cache')->where('tenant_id', $this->testTenantId)->delete();

        $searcher = $this->member();
        $owner = $this->member();
        $this->cacheRow($searcher, $this->listing($owner), 19.99, ['distance_km' => 4.99]);
        $this->cacheRow($searcher, $this->listing($owner), 20.00, ['distance_km' => 5.00]);
        $this->cacheRow($searcher, $this->listing($owner), 40.70, ['distance_km' => 49.99, 'match_type' => 'mutual']);
        $this->cacheRow($searcher, $this->listing($owner), 100.00, ['distance_km' => null]);
        // Expired: the engine no longer stands behind it, so it counts nowhere.
        $this->cacheRow($searcher, $this->listing($owner), 90.00, ['expires_at' => now()->subDay()]);
        // Another community's match must never leak in.
        $otherOwner = User::factory()->forTenant(self::OTHER_TENANT_ID)->create();
        $otherListing = Listing::factory()->forTenant(self::OTHER_TENANT_ID)->create(['user_id' => $otherOwner->id]);
        DB::table('match_cache')->insert([
            'tenant_id' => self::OTHER_TENANT_ID, 'user_id' => $otherOwner->id, 'listing_id' => $otherListing->id,
            'match_score' => 95, 'match_type' => 'one_way', 'match_reasons' => '[]', 'algorithm_version' => 'v2',
            'status' => 'new', 'created_at' => now(), 'expires_at' => now()->addDays(7),
        ]);

        Sanctum::actingAs($this->admin());
        $data = $this->apiGet('/v2/admin/matching/stats')->assertStatus(200)->json('data');

        $this->assertArrayNotHasKey('broker_approval_enabled', $data);

        $overview = $data['overview'];
        $this->assertSame(4, $overview['total_cached_matches']);
        $this->assertSame(4, $overview['total_matches_today']);
        $this->assertSame(4, $overview['total_matches_week']);
        $this->assertSame(4, $overview['total_matches_month']);
        $this->assertSame(1, $overview['mutual_matches_count']);
        $this->assertSame(1, $overview['active_users_with_matches']);
        // 40.70 and 100.00 reach the community's own hot score of 40.
        $this->assertSame(2, $overview['hot_matches']);
        $this->assertArrayNotHasKey('cache_hit_rate', $overview);

        $this->assertSame(
            ['0-20' => 1, '20-40' => 1, '40-60' => 1, '60-80' => 0, '80-100' => 1],
            array_column($data['score_distribution'], 'count', 'range'),
            'Every live score lands in exactly one bucket (40.70 used to land in none)'
        );
        $this->assertSame(4, array_sum(array_column($data['score_distribution'], 'count')));

        $this->assertSame(
            ['0-5' => 1, '5-15' => 1, '15-30' => 0, '30-50' => 1, '50+' => 0, 'unknown' => 1],
            array_column($data['distance_distribution'], 'count', 'range')
        );
    }

    // =====================================================================
    // Approvals: a refusal says which refusal
    // =====================================================================

    public function test_approve_blocked_by_safeguarding_says_so_and_leaves_the_match_waiting(): void
    {
        $id = $this->pendingApproval();
        $this->denyContact();
        Sanctum::actingAs($this->admin());

        $response = $this->apiPost("/v2/admin/matching/approvals/{$id}/approve");

        $response->assertStatus(409);
        $response->assertJsonPath('errors.0.code', 'MATCH_CONTACT_NOT_ALLOWED');
        $this->assertSame(__('api.match_approval_contact_blocked'), $response->json('errors.0.message'));
        $this->assertStringNotContainsString('api.match_approval', (string) $response->json('errors.0.message'));
        $this->assertSame('pending', DB::table('match_approvals')->where('id', $id)->value('status'));
        $this->assertNull(DB::table('match_approvals')->where('id', $id)->value('reviewed_by'));
    }

    public function test_approving_or_rejecting_a_decided_match_says_already_reviewed(): void
    {
        $admin = $this->admin();
        $id = $this->pendingApproval(null, null, ['status' => 'approved', 'reviewed_by' => $admin->id, 'reviewed_at' => now()]);
        Sanctum::actingAs($admin);

        $approve = $this->apiPost("/v2/admin/matching/approvals/{$id}/approve");
        $approve->assertStatus(409);
        $approve->assertJsonPath('errors.0.code', 'MATCH_ALREADY_REVIEWED');
        $this->assertSame(__('api.match_approval_already_reviewed'), $approve->json('errors.0.message'));

        $reject = $this->apiPost("/v2/admin/matching/approvals/{$id}/reject", ['reason' => 'Changed my mind']);
        $reject->assertStatus(409);
        $reject->assertJsonPath('errors.0.code', 'MATCH_ALREADY_REVIEWED');
        $this->assertSame('approved', DB::table('match_approvals')->where('id', $id)->value('status'));
    }

    public function test_a_match_that_does_not_exist_or_is_another_communitys_is_not_found(): void
    {
        $otherMember = User::factory()->forTenant(self::OTHER_TENANT_ID)->create();
        $otherOwner = User::factory()->forTenant(self::OTHER_TENANT_ID)->create();
        $otherListing = Listing::factory()->forTenant(self::OTHER_TENANT_ID)->create(['user_id' => $otherOwner->id]);
        $foreignId = (int) DB::table('match_approvals')->insertGetId([
            'tenant_id' => self::OTHER_TENANT_ID, 'user_id' => $otherMember->id, 'listing_id' => $otherListing->id,
            'listing_owner_id' => $otherOwner->id, 'match_score' => 80, 'status' => 'pending', 'submitted_at' => now(),
        ]);
        Sanctum::actingAs($this->admin());

        foreach ([$foreignId, 99999999] as $id) {
            $response = $this->apiPost("/v2/admin/matching/approvals/{$id}/approve");
            $response->assertStatus(404);
            $response->assertJsonPath('errors.0.code', 'NOT_FOUND');
            $this->assertSame(__('api.match_approval_not_found'), $response->json('errors.0.message'));
        }
        $this->assertSame('pending', DB::table('match_approvals')->where('id', $foreignId)->value('status'));
    }

    public function test_a_pending_match_can_still_be_approved_and_rejected(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $approveId = $this->pendingApproval();
        $this->apiPost("/v2/admin/matching/approvals/{$approveId}/approve")->assertStatus(200)->assertJsonPath('data.approved', true);
        $this->assertSame('approved', DB::table('match_approvals')->where('id', $approveId)->value('status'));

        $rejectId = $this->pendingApproval();
        $this->apiPost("/v2/admin/matching/approvals/{$rejectId}/reject", ['reason' => 'Not suitable'])
            ->assertStatus(200)->assertJsonPath('data.rejected', true);
        $this->assertSame('rejected', DB::table('match_approvals')->where('id', $rejectId)->value('status'));
    }

    public function test_approval_tab_counts_cover_the_same_rows_as_the_lists(): void
    {
        DB::table('match_approvals')->where('tenant_id', $this->testTenantId)->delete();
        $admin = $this->admin();
        $longAgo = now()->subDays(120);
        $this->pendingApproval(null, null, ['status' => 'approved', 'reviewed_by' => $admin->id, 'submitted_at' => $longAgo, 'reviewed_at' => $longAgo]);
        $this->pendingApproval(null, null, ['status' => 'approved', 'reviewed_by' => $admin->id, 'reviewed_at' => now()]);
        $this->pendingApproval(null, null, ['status' => 'rejected', 'reviewed_by' => $admin->id, 'submitted_at' => $longAgo, 'reviewed_at' => $longAgo]);
        $this->pendingApproval(null, null, ['submitted_at' => $longAgo]);
        Sanctum::actingAs($admin);

        $stats = $this->apiGet('/v2/admin/matching/approvals/stats?days=30')->assertStatus(200)->json('data');

        foreach (['pending' => 1, 'approved' => 2, 'rejected' => 1] as $status => $expected) {
            $list = $this->apiGet("/v2/admin/matching/approvals?status={$status}")->assertStatus(200);
            $this->assertSame($expected, $list->json('meta.total'));
            $this->assertSame($expected, $stats["{$status}_count"], "The {$status} tab count must equal the {$status} list");
        }
        $this->assertEqualsWithDelta(66.7, $stats['approval_rate'], 0.01);
    }

    // =====================================================================
    // Diagnosis: the facts (service) — and the endpoints that serve them
    // =====================================================================

    public function test_member_diagnosis_reports_the_facts_that_decide_matching(): void
    {
        DB::table('match_cache')->where('tenant_id', $this->testTenantId)->delete();
        $category = Category::factory()->create(['tenant_id' => $this->testTenantId, 'type' => 'listing']);
        $member = $this->member(['latitude' => null, 'longitude' => null, 'last_active_at' => now()->subDays(3)]);
        $this->listing($member, ['type' => 'offer', 'category_id' => $category->id]);
        $this->listing($member, ['type' => 'offer', 'category_id' => $category->id, 'moderation_status' => 'pending_review']);
        $this->listing($member, ['type' => 'request', 'category_id' => null]);
        $this->listing($member, ['status' => 'paused']); // not active: not counted
        DB::table('match_preferences')->insert([
            'user_id' => $member->id, 'tenant_id' => $this->testTenantId,
            'max_distance_km' => 12, 'min_match_score' => 65, 'matching_paused' => 1,
        ]);
        $owner = $this->member();
        $seen = $this->listing($owner);
        $this->cacheRow($member, $seen, 71.25);
        $this->cacheRow($member, $this->listing($owner), 88.50);
        $this->cacheRow($member, $this->listing($owner), 99.00, ['expires_at' => now()->subHour()]); // expired
        DB::table('match_dismissals')->insert([
            ['tenant_id' => $this->testTenantId, 'user_id' => $member->id, 'listing_id' => $seen->id, 'reason' => 'too_far', 'created_at' => now()],
            ['tenant_id' => $this->testTenantId, 'user_id' => $member->id, 'listing_id' => $this->listing($owner)->id, 'reason' => 'other', 'created_at' => now()->subDays(200)],
        ]);
        $this->pendingApproval($member, $owner);

        $facts = app(SmartMatchingAnalyticsService::class)->diagnoseUser($member->id);

        $this->assertNotNull($facts);
        $this->assertSame($member->id, $facts['member']['id']);
        $this->assertSame('active', $facts['member']['status']);
        $this->assertFalse($facts['member']['has_coordinates']);
        $this->assertSame(3, $facts['member']['days_since_active']);
        $this->assertSame(3, $facts['listings']['active_count']);
        $this->assertSame(1, $facts['listings']['awaiting_or_refused_review_count']);
        $this->assertSame(['offer' => 2, 'request' => 1], (array) $facts['listings']['by_type']);
        $this->assertContains(
            ['type' => 'offer', 'category_name' => $category->name, 'count' => 2],
            $facts['listings']['by_category']
        );
        $this->assertContains(['type' => 'request', 'category_name' => null, 'count' => 1], $facts['listings']['by_category']);
        $this->assertTrue($facts['preferences']['has_saved_preferences']);
        $this->assertTrue($facts['preferences']['matching_paused']);
        $this->assertSame(65, $facts['preferences']['min_match_score']);
        $this->assertSame(12, $facts['preferences']['max_distance_km']);
        $this->assertSame(2, $facts['cache']['cached_matches']);
        $this->assertSame(88.5, $facts['cache']['best_score']);
        $this->assertSame(2, $facts['dismissals']['total']);
        $this->assertSame(1, $facts['dismissals']['last_90_days']);
        $this->assertSame(1, $facts['held_for_approval_count']);
    }

    public function test_listing_diagnosis_reports_the_facts_that_decide_matching(): void
    {
        DB::table('match_cache')->where('tenant_id', $this->testTenantId)->delete();
        $category = Category::factory()->create(['tenant_id' => $this->testTenantId, 'type' => 'listing']);
        $owner = $this->member(['status' => 'suspended', 'last_active_at' => now()->subDays(200), 'latitude' => null, 'longitude' => null]);
        $listing = $this->listing($owner, [
            'type' => 'request', 'category_id' => $category->id, 'service_type' => 'location_dependent',
            'moderation_status' => 'approved', 'latitude' => null, 'longitude' => null,
        ]);
        $first = $this->member();
        $second = $this->member();
        $this->cacheRow($first, $listing, 55.5);
        $this->cacheRow($second, $listing, 91.0);
        DB::table('match_dismissals')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $first->id, 'listing_id' => $listing->id, 'reason' => 'not_relevant',
        ]);

        $service = app(SmartMatchingAnalyticsService::class);
        $facts = $service->diagnoseListing($listing->id);

        $this->assertNotNull($facts);
        $this->assertSame($listing->id, $facts['listing']['id']);
        $this->assertSame('active', $facts['listing']['status']);
        $this->assertSame('approved', $facts['listing']['moderation_status']);
        $this->assertSame('request', $facts['listing']['type']);
        $this->assertSame($category->name, $facts['listing']['category_name']);
        $this->assertSame('location_dependent', $facts['listing']['service_type']);
        $this->assertFalse($facts['listing']['has_coordinates']);
        $this->assertSame($owner->id, $facts['owner']['id']);
        $this->assertSame('suspended', $facts['owner']['status']);
        $this->assertFalse($facts['owner']['has_coordinates']);
        $this->assertSame(200, $facts['owner']['days_since_active']);
        $this->assertSame(2, $facts['cache']['members_cached']);
        $this->assertSame(91.0, $facts['cache']['best_score']);
        $this->assertSame(1, $facts['dismissals']['total']);
    }

    public function test_diagnosis_knows_nothing_about_another_community(): void
    {
        $otherMember = User::factory()->forTenant(self::OTHER_TENANT_ID)->create();
        $otherListing = Listing::factory()->forTenant(self::OTHER_TENANT_ID)->create(['user_id' => $otherMember->id]);

        $service = app(SmartMatchingAnalyticsService::class);

        $this->assertNull($service->diagnoseUser($otherMember->id));
        $this->assertNull($service->diagnoseListing($otherListing->id));
        $this->assertNull($service->diagnoseUser(99999999));
    }

    public function test_member_diagnosis_endpoint_explains_what_is_holding_matches_back(): void
    {
        $this->storeConfig(['enabled' => false, 'min_match_score' => 45, 'max_distance_km' => 30]);
        $member = $this->member(['latitude' => null, 'longitude' => null]);
        DB::table('match_preferences')->insert([
            'user_id' => $member->id, 'tenant_id' => $this->testTenantId,
            'max_distance_km' => 500, 'min_match_score' => null, 'matching_paused' => 1,
        ]);
        Sanctum::actingAs($this->platformTeam());

        $data = $this->apiGet("/v2/admin/matching/diagnose/user/{$member->id}")->assertStatus(200)->json('data');

        $this->assertSame($member->id, $data['member']['id']);
        $this->assertFalse($data['community']['matching_enabled']);
        // No floor of their own: the community's applies. Their 500 km cannot
        // exceed the community's 30.
        $this->assertSame(['min_match_score' => 45, 'max_distance_km' => 30], $data['effective']);
        $this->assertFalse($data['needs_coordinator_approval']);
        $this->assertSame(
            ['matching_off', 'matching_paused', 'no_active_listings', 'no_location_remote_only'],
            $data['findings']
        );
    }

    public function test_member_diagnosis_endpoint_says_when_nothing_is_in_the_way(): void
    {
        $this->storeConfig(['enabled' => true]);
        $member = $this->member();
        $this->listing($member);
        Sanctum::actingAs($this->platformTeam());

        $data = $this->apiGet("/v2/admin/matching/diagnose/user/{$member->id}")->assertStatus(200)->json('data');

        $this->assertSame(['nothing_blocking'], $data['findings']);
        $this->assertTrue($data['member']['has_coordinates']);
        $this->assertSame(1, $data['listings']['active_count']);
    }

    public function test_listing_diagnosis_endpoint_explains_why_a_listing_is_not_offered(): void
    {
        $this->storeConfig(['enabled' => true, 'gates' => ['dormancy_days' => 90, 'geo_hard_gate' => true]]);
        $owner = $this->member(['status' => 'suspended', 'last_active_at' => now()->subDays(200), 'latitude' => null, 'longitude' => null]);
        $listing = $this->listing($owner, ['status' => 'paused', 'moderation_status' => 'rejected', 'latitude' => null, 'longitude' => null]);
        Sanctum::actingAs($this->platformTeam());

        $data = $this->apiGet("/v2/admin/matching/diagnose/listing/{$listing->id}")->assertStatus(200)->json('data');

        $this->assertSame($listing->id, $data['listing']['id']);
        $this->assertSame(90, $data['community']['dormancy_days']);
        $this->assertSame(
            ['listing_not_active', 'listing_not_approved', 'owner_not_active', 'owner_dormant', 'no_location_in_person'],
            $data['findings']
        );
    }

    public function test_listing_diagnosis_names_an_owner_who_is_deactivated_or_awaiting_approval(): void
    {
        // The engine takes listings of ACTIVE members only, so the diagnosis
        // must say so for every other state, not just suspended and banned.
        $this->storeConfig(['enabled' => true]);
        Sanctum::actingAs($this->platformTeam());

        foreach (['inactive', 'pending', 'rejected', 'banned'] as $status) {
            $listing = $this->listing($this->member(['status' => $status]));
            $data = $this->apiGet("/v2/admin/matching/diagnose/listing/{$listing->id}")->assertStatus(200)->json('data');
            $this->assertContains('owner_not_active', $data['findings'], "owner status {$status}");
        }

        $fine = $this->listing($this->member());
        $data = $this->apiGet("/v2/admin/matching/diagnose/listing/{$fine->id}")->assertStatus(200)->json('data');
        $this->assertSame(['nothing_blocking'], $data['findings']);
    }

    public function test_diagnosis_endpoints_are_platform_team_only_and_scoped_to_the_community(): void
    {
        $member = $this->member();
        $listing = $this->listing($member);
        $otherMember = User::factory()->forTenant(self::OTHER_TENANT_ID)->create();
        $otherListing = Listing::factory()->forTenant(self::OTHER_TENANT_ID)->create(['user_id' => $otherMember->id]);

        // Not signed in.
        $this->apiGet("/v2/admin/matching/diagnose/user/{$member->id}")->assertStatus(401);

        // A member, a broker and a community admin: the page is the platform
        // team's (the full tier list is in Security/PlatformTeamLocks).
        foreach ([$this->member(), User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker']), $this->admin()] as $caller) {
            Sanctum::actingAs($caller);
            $this->apiGet("/v2/admin/matching/diagnose/user/{$member->id}")->assertStatus(403);
            $this->apiGet("/v2/admin/matching/diagnose/listing/{$listing->id}")->assertStatus(403);
        }

        // Asking about another community's member or listing gets the same
        // answer as for an id that does not exist.
        Sanctum::actingAs($this->platformTeam());
        foreach ([$otherMember->id, 99999999] as $id) {
            $response = $this->apiGet("/v2/admin/matching/diagnose/user/{$id}");
            $response->assertStatus(404);
            $response->assertJsonPath('errors.0.code', 'NOT_FOUND');
        }
        foreach ([$otherListing->id, 99999999] as $id) {
            $response = $this->apiGet("/v2/admin/matching/diagnose/listing/{$id}");
            $response->assertStatus(404);
            $response->assertJsonPath('errors.0.code', 'NOT_FOUND');
        }
    }
}
