<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\Matching\CandidateRetriever;
use App\Services\MatchLearningService;
use App\Services\SmartMatchingEngine;
use App\Services\EmbeddingService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Support\Facades\DB;
use Mockery;

class SmartMatchingEngineTest extends TestCase
{
    private SmartMatchingEngine $engine;
    private $mockEmbedding;
    private $mockRetriever;
    private $mockLearning;

    protected function setUp(): void
    {
        parent::setUp();
        $this->mockEmbedding = Mockery::mock(EmbeddingService::class);
        $this->mockRetriever = Mockery::mock(CandidateRetriever::class);
        $this->mockLearning = Mockery::mock(MatchLearningService::class);
        // Default: no candidates unless a test says otherwise.
        $this->mockRetriever->shouldReceive('retrieveBatch')->andReturn([])->byDefault();
        $this->mockRetriever->shouldReceive('retrieveColdStart')->andReturn([])->byDefault();
        // Default: no learning history.
        $this->mockLearning->shouldReceive('getOwnerInteractionBoosts')->andReturn([])->byDefault();
        $this->mockLearning->shouldReceive('getCategoryAffinities')->andReturn([])->byDefault();
        $this->bindSafeguardingDecisions([]);
        $this->engine = new SmartMatchingEngine(
            $this->mockEmbedding, $this->mockRetriever, $this->mockLearning
        );
    }

    /** @param array<int,string> $statusesByRecipient */
    private function bindSafeguardingDecisions(array $statusesByRecipient): void
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateLocalContact')
            ->zeroOrMoreTimes()
            ->andReturnUsing(function (int $senderId, int $recipientId) use ($statusesByRecipient) {
                $status = $statusesByRecipient[$recipientId] ?? SafeguardingInteractionDecision::ALLOW;

                return new SafeguardingInteractionDecision(
                    status: $status,
                    code: $status === SafeguardingInteractionDecision::ALLOW
                        ? 'SAFEGUARDING_ALLOWED'
                        : ($status === SafeguardingInteractionDecision::UNAVAILABLE
                            ? 'SAFEGUARDING_POLICY_UNAVAILABLE'
                            : 'VETTING_REQUIRED'),
                    recipientTenantId: 1,
                    purposeCode: 'safeguarded_member_contact',
                    scopeType: 'tenant',
                    scopeIdentifier: '',
                );
            });
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }

    // ── getConfig ──

    /**
     * 🔴 A member's skills were almost entirely invisible to matching, and matching is the
     * whole point of a timebank.
     *
     * `SkillTaxonomyService::getProficiencyWeightedSkills()` keys skills by the raw
     * lowercased name; listing text goes through `KeywordExtractor::extract()`, which
     * splits AND stems. `calculateSkillScore()` compared the two with `array_intersect`, so
     * they agreed only when a skill name already equalled its own stem. Measured with the
     * real stemmer on 2026-08-23:
     *
     *   gardening -> 'garden' | cleaning -> 'clean' | plumbing -> 'plumb'
     *   tutoring  -> 'tutor'  | "dog walking" -> 'dog','walk'
     *
     * Every one of those failed to match a listing about the same thing. Multi-word skills
     * could never match at all, being held as a single key with a space in it.
     *
     * These tests drive the private scorer directly through reflection, deliberately: the
     * effect could not be shown end to end because a member's OWN listing text usually
     * already supplies the overlapping token, which masks the fault in exactly the cases
     * that are easiest to construct.
     */
    private function skillScore(array $userData, array $myListing, array $candidate): float
    {
        $method = new \ReflectionMethod(SmartMatchingEngine::class, 'calculateSkillScore');
        $method->setAccessible(true);

        return (float) $method->invoke($this->engine, $userData, $myListing, $candidate);
    }

    public function test_a_skill_matches_a_listing_about_the_same_thing_despite_stemming(): void
    {
        // The member's own listing deliberately shares no word with the candidate, so the
        // only thing that can produce a match is the skill itself.
        $myListing = ['title' => 'Bicycle repairs', 'description' => 'I fix bikes.'];
        $candidate = ['title' => 'Gardening help wanted', 'description' => 'Weeding and planting.'];

        $withSkill = $this->skillScore(
            ['skills_weighted' => ['gardening' => 1.3]],
            $myListing,
            $candidate,
        );
        $withoutSkill = $this->skillScore([], $myListing, $candidate);

        $this->assertGreaterThan(
            $withoutSkill,
            $withSkill,
            'a "gardening" skill must score higher against a gardening listing than no skill at all',
        );
    }

    public function test_a_multi_word_skill_is_split_into_matchable_words(): void
    {
        $myListing = ['title' => 'Bicycle repairs', 'description' => 'I fix bikes.'];
        $candidate = ['title' => 'Dog walker needed', 'description' => 'Two short walks a day.'];

        $withSkill = $this->skillScore(
            ['skills_weighted' => ['dog walking' => 1.6]],
            $myListing,
            $candidate,
        );

        $this->assertGreaterThan(
            0.0,
            $withSkill,
            '"dog walking" must be split into words; as one key with a space it can never match',
        );
    }

    public function test_a_higher_proficiency_scores_at_least_as_well_as_a_lower_one(): void
    {
        $myListing = ['title' => 'Bicycle repairs', 'description' => 'I fix bikes.'];
        $candidate = ['title' => 'Gardening help wanted', 'description' => 'Weeding and planting.'];

        $expert = $this->skillScore(['skills_weighted' => ['gardening' => 1.6]], $myListing, $candidate);
        $beginner = $this->skillScore(['skills_weighted' => ['gardening' => 0.6]], $myListing, $candidate);

        $this->assertGreaterThanOrEqual($beginner, $expert);
    }

    public function test_getConfig_returns_defaults(): void
    {
        DB::shouldReceive('table->where->value')->andReturnNull();

        $config = $this->engine->getConfig();
        $this->assertTrue($config['enabled']);
        $this->assertEquals(50, $config['max_distance_km']);
        $this->assertEquals(40, $config['min_match_score']);
        $this->assertEquals(80, $config['hot_match_threshold']);
        $this->assertArrayHasKey('weights', $config);
        $this->assertArrayHasKey('proximity', $config);
        // Hard-gate defaults (Phase 1 geo fix)
        $this->assertTrue($config['gates']['geo_hard_gate']);
        $this->assertSame('remote_only', $config['gates']['missing_coords_mode']);
        $this->assertSame(90, $config['gates']['dormancy_days']);
    }

    public function test_getConfig_partial_tenant_gates_keep_defaults_for_missing_keys(): void
    {
        // Tenant saved only one gate key — the others must fall back to defaults,
        // not vanish (array_merge on the top level used to wipe nested blocks).
        DB::shouldReceive('table->where->value')->andReturn(json_encode([
            'algorithms' => ['smart_matching' => ['gates' => ['dormancy_days' => 30]]],
        ]));

        $config = $this->engine->getConfig();
        $this->assertSame(30, $config['gates']['dormancy_days']);
        $this->assertTrue($config['gates']['geo_hard_gate']);
        $this->assertSame('remote_only', $config['gates']['missing_coords_mode']);
        $this->assertArrayHasKey('category', $config['weights']);
    }

    public function test_getConfig_caches_result(): void
    {
        DB::shouldReceive('table->where->value')->once()->andReturnNull();

        $this->engine->getConfig();
        $this->engine->getConfig(); // should not call DB again
    }

    // ── clearCache ──

    public function test_clearCache_resets_internal_state(): void
    {
        // getConfig() caches its result in-memory; clearCache() resets it so the
        // next getConfig() re-queries the DB. With a single getConfig() the
        // tenants config row is read once; clearing the cache between two calls
        // forces a second read — proving the cache was reset.
        DB::shouldReceive('table->where->value')->twice()->andReturnNull();

        $this->engine->getConfig();   // 1st DB read
        $this->engine->clearCache();
        $this->engine->getConfig();   // 2nd DB read (cache was cleared)
    }

    protected function tearDown(): void
    {
        // warmUpCache tests set tenant state; reset so it never leaks to siblings.
        \App\Core\TenantContext::reset();
        parent::tearDown();
    }

    /**
     * Set tenant context without a DB round-trip. getId() returns the cached id
     * first, so this avoids setById()'s tenant-row fetch.
     */
    private function setTenantId(int $id): void
    {
        $prop = new \ReflectionProperty(\App\Core\TenantContext::class, 'cachedId');
        $prop->setAccessible(true);
        $prop->setValue(null, $id);
    }

    // ── warmUpCache ──
    // Regression: the static legacy writer was removed in the Laravel migration
    // (commit 7bc2a1629), so the 30-min "warm-match-cache" cron called an
    // undefined method every run and the match_cache table had no writer at all.

    public function test_warmUpCache_writes_scores_unscaled_on_the_0_100_scale(): void
    {
        $this->setTenantId(7);

        // Partial mock: real warmUpCache(), stubbed findMatchesForUser().
        $engine = Mockery::mock(
            SmartMatchingEngine::class . '[findMatchesForUser]',
            [$this->mockEmbedding, $this->mockRetriever, $this->mockLearning]
        );
        $engine->shouldReceive('findMatchesForUser')
            ->once()->withArgs(fn ($id, $opts) => $id === 1 && $opts === ['limit' => 20])
            ->andReturn([[
                'id' => 123,
                'match_score' => 85.0,   // engine scores are 0–100
                'distance_km' => 3.2,
                'match_type' => 'mutual',
                'match_reasons' => ['Same category'],
            ]]);

        // One candidate user returned by the warm-up SELECT.
        DB::shouldReceive('select')->once()->andReturn([(object) ['id' => 1]]);

        // Regression (score-scale corruption): warmUpCache used to clamp the
        // 0–100 engine score with min(1.0, …) * 100, writing every row as
        // exactly 100.00. It must now pass 85.0 through unchanged.
        DB::shouldReceive('insert')->once()->withArgs(function ($sql, $bindings) {
            return is_string($sql)
                && str_contains($sql, 'match_cache')
                && $bindings[0] === 1                          // user_id
                && $bindings[1] === 123                        // listing_id
                && (int) $bindings[2] === 7                    // tenant_id
                && abs(((float) $bindings[3]) - 85.0) < 0.01   // score NOT rescaled
                && $bindings[5] === 'mutual';                  // match_type
        })->andReturn(true);

        $result = $engine->warmUpCache(20);

        $this->assertSame(['processed' => 1, 'cached' => 1], $result);
    }

    public function test_warmUpCache_clamps_out_of_range_scores_to_0_100(): void
    {
        $this->setTenantId(7);

        $engine = Mockery::mock(
            SmartMatchingEngine::class . '[findMatchesForUser]',
            [$this->mockEmbedding, $this->mockRetriever, $this->mockLearning]
        );
        $engine->shouldReceive('findMatchesForUser')->once()->andReturn([
            ['id' => 1, 'match_score' => 130.0, 'distance_km' => 1.0, 'match_type' => 'one_way', 'match_reasons' => []],
            ['id' => 2, 'match_score' => -5.0, 'distance_km' => 1.0, 'match_type' => 'one_way', 'match_reasons' => []],
        ]);

        DB::shouldReceive('select')->once()->andReturn([(object) ['id' => 1]]);

        $written = [];
        DB::shouldReceive('insert')->twice()->withArgs(function ($sql, $bindings) use (&$written) {
            $written[$bindings[1]] = (float) $bindings[3];
            return true;
        })->andReturn(true);

        $engine->warmUpCache(20);

        $this->assertEqualsWithDelta(100.0, $written[1], 0.01);
        $this->assertEqualsWithDelta(0.0, $written[2], 0.01);
    }

    public function test_warmUpCache_with_no_eligible_users_caches_nothing(): void
    {
        $this->setTenantId(7);

        DB::shouldReceive('select')->once()->andReturn([]); // no eligible users
        DB::shouldReceive('insert')->never();

        $result = $this->engine->warmUpCache(20);

        $this->assertSame(['processed' => 0, 'cached' => 0], $result);
    }

    public function test_warmUpCache_defaults_absent_match_type_to_one_way_not_null(): void
    {
        $this->setTenantId(7);

        $engine = Mockery::mock(
            SmartMatchingEngine::class . '[findMatchesForUser]',
            [$this->mockEmbedding, $this->mockRetriever, $this->mockLearning]
        );
        $engine->shouldReceive('findMatchesForUser')->once()->andReturn([[
            'id' => 55,
            'match_score' => 50.0,
            'distance_km' => 1.0,
            // match_type intentionally absent — must fall back to 'one_way', not null.
            'match_reasons' => [],
        ]]);

        DB::shouldReceive('select')->once()->andReturn([(object) ['id' => 9]]);
        DB::shouldReceive('insert')->once()->withArgs(function ($sql, $bindings) {
            return $bindings[5] === 'one_way'; // not null
        })->andReturn(true);

        $result = $engine->warmUpCache(20);

        $this->assertSame(1, $result['cached']);
    }

    public function test_warmUpCache_resets_singleton_in_process_cache_so_tenants_dont_leak_config(): void
    {
        $this->setTenantId(7);

        // Simulate a previous tenant having populated the singleton's config cache.
        $prop = new \ReflectionProperty(SmartMatchingEngine::class, 'configCache');
        $prop->setAccessible(true);
        $prop->setValue($this->engine, ['min_match_score' => 999]); // "tenant N" sentinel

        DB::shouldReceive('select')->once()->andReturn([]); // no users → returns quickly

        $this->engine->warmUpCache(20);

        $this->assertNull(
            $prop->getValue($this->engine),
            'warmUpCache must clear the singleton config cache so the next tenant re-reads its own config'
        );
    }

    // ── extractKeywords ──

    public function test_extractKeywords_removes_stop_words(): void
    {
        $keywords = $this->engine->extractKeywords('I am looking for help with gardening');
        $this->assertNotContains('looking', $keywords);
        $this->assertNotContains('for', $keywords);
        $this->assertContains('garden', $keywords); // stemmed from gardening
    }

    public function test_extractKeywords_stems_words(): void
    {
        $keywords = $this->engine->extractKeywords('cooking and cleaning services');
        $this->assertContains('cook', $keywords);
        $this->assertContains('clean', $keywords);
        $this->assertContains('servic', $keywords);
    }

    public function test_extractKeywords_includes_short_domain_terms(): void
    {
        $keywords = $this->engine->extractKeywords('AI and ML development');
        $this->assertContains('ai', $keywords);
        $this->assertContains('ml', $keywords);
    }

    public function test_extractKeywords_returns_unique_values(): void
    {
        $keywords = $this->engine->extractKeywords('test test test testing');
        $this->assertCount(count(array_unique($keywords)), $keywords);
    }

    // ── calculateMatchScore ──

    public function test_calculateMatchScore_returns_expected_structure(): void
    {
        DB::shouldReceive('table->where->value')->andReturnNull();
        DB::shouldReceive('select')->andReturn([]);
        DB::shouldReceive('table->where->where->select->first')->andReturnNull();
        DB::shouldReceive('selectOne')->andReturnNull();

        $userData = [
            'latitude' => 53.35, 'longitude' => -6.26, 'skills' => 'gardening',
            'skills_weighted' => [], 'skills_proficiency_keys' => null,
        ];
        $userListings = [['type' => 'offer', 'category_id' => 1, 'title' => 'Gardening', 'description' => '']];
        $myListing = ['type' => 'offer', 'category_id' => 1, 'title' => 'Gardening', 'description' => ''];
        $candidate = [
            'id' => 10, 'user_id' => 2, 'category_id' => 1, 'title' => 'Need gardening help',
            'description' => 'Looking for someone to help with garden', 'created_at' => now()->toDateTimeString(),
            'latitude' => 53.36, 'longitude' => -6.25, 'image_url' => null,
            'category_name' => 'Gardening', 'author_rating' => null,
        ];

        $result = $this->engine->calculateMatchScore($userData, $userListings, $myListing, $candidate);

        $this->assertArrayHasKey('score', $result);
        $this->assertArrayHasKey('reasons', $result);
        $this->assertArrayHasKey('breakdown', $result);
        $this->assertArrayHasKey('distance', $result);
        $this->assertArrayHasKey('type', $result);
        $this->assertIsFloat($result['score']);
        $this->assertIsArray($result['reasons']);
    }

    // ── calculateMatchScore: service_type awareness (Phase 1 geo fix) ──

    public function test_calculateMatchScore_remote_only_is_distance_exempt(): void
    {
        DB::shouldReceive('table->where->value')->andReturnNull();
        DB::shouldReceive('select')->andReturn([]); // reciprocity lookup

        $userData = ['latitude' => 0, 'longitude' => 0, 'skills' => ''];
        $userListings = [['type' => 'offer', 'category_id' => 1, 'title' => 'Gardening', 'description' => '']];
        $candidate = [
            'id' => 10, 'user_id' => 2, 'category_id' => 1,
            'title' => 'Remote garden planning', 'description' => 'Plan your garden over video call',
            'service_type' => 'remote_only', 'created_at' => now()->toDateTimeString(),
        ];

        $result = $this->engine->calculateMatchScore($userData, $userListings, $userListings[0], $candidate);

        $this->assertEqualsWithDelta(0.9, $result['breakdown']['proximity'], 0.001);
        $this->assertNull($result['distance'], 'remote match with unknown coords must not leak a distance');
        $this->assertContains('Can be done remotely', $result['reasons']);
        $this->assertSame('remote_only', $result['service_type']);
    }

    public function test_calculateMatchScore_physical_with_unknown_distance_is_heavily_penalised(): void
    {
        DB::shouldReceive('table->where->value')->andReturnNull();
        DB::shouldReceive('select')->andReturn([]);

        // Neither party has coordinates; candidate is physical (default service_type).
        $userData = ['latitude' => 0, 'longitude' => 0, 'skills' => ''];
        $userListings = [['type' => 'offer', 'category_id' => 1, 'title' => 'Gardening', 'description' => '']];
        $candidate = [
            'id' => 10, 'user_id' => 2, 'category_id' => 1,
            'title' => 'Need gardening help', 'description' => 'Hedges and lawn',
            'created_at' => now()->toDateTimeString(),
        ];

        $result = $this->engine->calculateMatchScore($userData, $userListings, $userListings[0], $candidate);

        $this->assertEqualsWithDelta(0.05, $result['breakdown']['proximity'], 0.001);
        // Regression: the old code returned round(PHP_FLOAT_MAX, 1) here.
        $this->assertNull($result['distance']);
    }

    public function test_calculateMatchScore_hybrid_with_unknown_distance_is_neutral(): void
    {
        DB::shouldReceive('table->where->value')->andReturnNull();
        DB::shouldReceive('select')->andReturn([]);

        $userData = ['latitude' => 0, 'longitude' => 0, 'skills' => ''];
        $userListings = [['type' => 'offer', 'category_id' => 1, 'title' => 'Tutoring', 'description' => '']];
        $candidate = [
            'id' => 10, 'user_id' => 2, 'category_id' => 1,
            'title' => 'Maths tutoring wanted', 'description' => 'Online or in person',
            'service_type' => 'hybrid', 'created_at' => now()->toDateTimeString(),
        ];

        $result = $this->engine->calculateMatchScore($userData, $userListings, $userListings[0], $candidate);

        $this->assertEqualsWithDelta(0.5, $result['breakdown']['proximity'], 0.001);
        $this->assertNull($result['distance']);
    }

    // ── findMatchesForUser ──

    public function test_findMatchesForUser_returns_empty_for_nonexistent_user(): void
    {
        DB::shouldReceive('table->where->value')->andReturnNull();
        DB::shouldReceive('select')->andReturn([]);

        $meta = null;
        $result = $this->engine->findMatchesForUser(0, [], $meta);
        $this->assertIsArray($result);
        $this->assertFalse($meta['has_active_listings']);
    }

    public function test_findMatchesForUser_without_coords_sets_degraded_meta_and_scores_remote_candidates(): void
    {
        $this->setTenantId(7);
        DB::shouldReceive('table->where->value')->andReturnNull(); // tenant config → defaults

        // Sequential DB::select returns:
        //   match_preferences → user row → own listings → candidate owner listings (reciprocity)
        DB::shouldReceive('select')->andReturn(
            [], // no saved preferences
            [(object) [
                'id' => 1, 'tenant_id' => 7, 'latitude' => 0.0, 'longitude' => 0.0,
                'skills' => '', 'avg_rating' => null, 'transaction_count' => 0,
            ]],
            [(object) [
                'id' => 11, 'user_id' => 1, 'type' => 'offer', 'category_id' => 3,
                'title' => 'Gardening help offered', 'description' => '', 'category_name' => 'Gardening',
            ]],
            [] // reciprocity: candidate owner has no listings
        );

        // Degraded mode: the retriever must be called with NULL coords so it can
        // restrict candidates to remote/hybrid.
        $this->mockRetriever->shouldReceive('retrieveBatch')
            ->once()
            ->withArgs(function ($tenantId, $userId, $targetType, $catIds, $catFilter, $lat, $lon, $maxDist, $gates) {
                return $tenantId === 7 && $userId === 1 && $targetType === 'request'
                    && $lat === null && $lon === null
                    && ($gates['missing_coords_mode'] ?? null) === 'remote_only';
            })
            ->andReturn([[
                'id' => 99, 'user_id' => 2, 'type' => 'request', 'category_id' => 3,
                'title' => 'Remote garden planning wanted',
                'description' => 'Help me plan my vegetable garden over a video call this spring',
                'service_type' => 'remote_only', 'created_at' => now()->toDateTimeString(),
                'category_name' => 'Gardening',
            ]]);

        $this->mockEmbedding->shouldReceive('findSimilar')->andReturn([]);
        \Illuminate\Support\Facades\Cache::shouldReceive('get')->andReturn(null);

        $meta = null;
        $matches = $this->engine->findMatchesForUser(1, [], $meta);

        $this->assertTrue($meta['needs_location']);
        $this->assertTrue($meta['degraded']);
        $this->assertSame('no_coordinates', $meta['degraded_reason']);
        $this->assertTrue($meta['has_active_listings']);

        $this->assertCount(1, $matches);
        $this->assertSame(99, $matches[0]['id']);
        $this->assertNull($matches[0]['distance_km'], 'no-coords match must not fabricate a distance');
    }

    public function test_findMatchesForUser_semantic_boost_raises_score_instead_of_collapsing_it(): void
    {
        $this->setTenantId(7);
        DB::shouldReceive('table->where->value')->andReturnNull();

        DB::shouldReceive('select')->andReturn(
            [],
            [(object) [
                'id' => 1, 'tenant_id' => 7, 'latitude' => 0.0, 'longitude' => 0.0,
                'skills' => '', 'avg_rating' => null, 'transaction_count' => 0,
            ]],
            [(object) [
                'id' => 11, 'user_id' => 1, 'type' => 'offer', 'category_id' => 3,
                'title' => 'Gardening help offered', 'description' => '', 'category_name' => 'Gardening',
            ]],
            []
        );

        $this->mockRetriever->shouldReceive('retrieveBatch')->once()->andReturn([[
            'id' => 99, 'user_id' => 2, 'type' => 'request', 'category_id' => 3,
            'title' => 'Remote garden planning wanted',
            'description' => 'Help me plan my vegetable garden over a video call this spring',
            'service_type' => 'remote_only', 'created_at' => now()->toDateTimeString(),
            'category_name' => 'Gardening',
        ]]);

        // Listing 99 is semantically similar → boost applies.
        $this->mockEmbedding->shouldReceive('findSimilar')->andReturn([99]);
        \Illuminate\Support\Facades\Cache::shouldReceive('get')->andReturn(null);

        $matches = $this->engine->findMatchesForUser(1);

        // Regression (score-scale corruption): the old ×1.3 boost clamped with
        // min(1.0, …), collapsing every boosted match to a score of 1/100.
        $this->assertCount(1, $matches);
        $this->assertGreaterThan(40, $matches[0]['match_score']);
        $this->assertLessThanOrEqual(100, $matches[0]['match_score']);
        $this->assertContains('Similar to your listing', $matches[0]['match_reasons']);
    }

    public function test_findMatchesForUser_caps_listings_per_owner_per_page(): void
    {
        $this->setTenantId(7);
        DB::shouldReceive('table->where->value')->andReturnNull();

        DB::shouldReceive('select')->andReturn(
            [],
            [(object) [
                'id' => 1, 'tenant_id' => 7, 'latitude' => 0.0, 'longitude' => 0.0,
                'skills' => '', 'avg_rating' => null, 'transaction_count' => 0,
            ]],
            [(object) [
                'id' => 11, 'user_id' => 1, 'type' => 'offer', 'category_id' => 3,
                'title' => 'Gardening help offered', 'description' => '', 'category_name' => 'Gardening',
            ]],
            []
        );

        // THREE strong candidates, all owned by the same member.
        $candidate = static fn (int $id) => [
            'id' => $id, 'user_id' => 2, 'type' => 'request', 'category_id' => 3,
            'title' => "Remote garden planning wanted {$id}",
            'description' => 'Help me plan my vegetable garden over a video call this spring',
            'service_type' => 'remote_only', 'created_at' => now()->toDateTimeString(),
            'category_name' => 'Gardening',
        ];
        $this->mockRetriever->shouldReceive('retrieveBatch')->once()->andReturn([
            $candidate(101), $candidate(102), $candidate(103),
        ]);

        $this->mockEmbedding->shouldReceive('findSimilar')->andReturn([]);
        \Illuminate\Support\Facades\Cache::shouldReceive('get')->andReturn(null);

        $matches = $this->engine->findMatchesForUser(1);

        // Anti-monopoly: max 2 listings per owner per result page.
        $this->assertCount(2, $matches);
    }

    public function test_findMatchesForUser_applies_learning_penalty_from_owner_history(): void
    {
        $this->setTenantId(7);
        DB::shouldReceive('table->where->value')->andReturnNull();

        // SQL-aware DB mock (robust across BOTH engine runs, unlike a
        // sequential andReturn chain which the first run consumes).
        DB::shouldReceive('select')->andReturnUsing(function ($sql) {
            if (str_contains($sql, 'transaction_count')) {
                return [(object) [
                    'id' => 1, 'tenant_id' => 7, 'latitude' => 0.0, 'longitude' => 0.0,
                    'skills' => '', 'avg_rating' => null, 'transaction_count' => 0,
                ]];
            }
            if (str_contains($sql, 'category_name') && str_contains($sql, 'LIMIT 10')) {
                return [(object) [
                    'id' => 11, 'user_id' => 1, 'type' => 'offer', 'category_id' => 3,
                    'title' => 'Gardening help offered', 'description' => '', 'category_name' => 'Gardening',
                ]];
            }
            return [];
        });

        $candidate = [
            'id' => 99, 'user_id' => 2, 'type' => 'request', 'category_id' => 3,
            'title' => 'Remote garden planning wanted',
            'description' => 'Help me plan my vegetable garden over a video call this spring',
            'service_type' => 'remote_only', 'created_at' => now()->toDateTimeString(),
            'category_name' => 'Gardening',
        ];
        $this->mockRetriever->shouldReceive('retrieveBatch')->twice()->andReturn([$candidate]);

        $this->mockEmbedding->shouldReceive('findSimilar')->andReturn([]);
        \Illuminate\Support\Facades\Cache::shouldReceive('get')->andReturn(null);

        // Baseline run (default mocks: no history).
        $baseline = $this->engine->findMatchesForUser(1);

        // Second engine whose learning history says "this searcher keeps
        // dismissing owner 2" — the same candidate must now score lower.
        $penalisingLearning = Mockery::mock(MatchLearningService::class);
        $penalisingLearning->shouldReceive('getOwnerInteractionBoosts')->andReturn([2 => -10.0]);
        $penalisingLearning->shouldReceive('getCategoryAffinities')->andReturn([]);
        $engine2 = new SmartMatchingEngine(
            $this->mockEmbedding, $this->mockRetriever, $penalisingLearning
        );
        $penalised = $engine2->findMatchesForUser(1);

        $this->assertNotEmpty($baseline);
        $this->assertNotEmpty($penalised);
        $this->assertEqualsWithDelta(
            $baseline[0]['match_score'] - 10.0,
            $penalised[0]['match_score'],
            0.2,
            'owner-history penalty must reduce the score by the learning boost'
        );
    }

    // ── filterCandidatesByVettingRequirements ──

    public function test_filter_returns_empty_for_empty_candidates(): void
    {
        // No mock calls expected — early return
        $result = $this->engine->filterCandidatesByVettingRequirements([], 42);
        $this->assertSame([], $result);
    }

    public function test_filter_returns_unchanged_for_nonpositive_searcher(): void
    {
        $candidates = [['id' => 1, 'user_id' => 10]];
        $result = $this->engine->filterCandidatesByVettingRequirements($candidates, 0);
        $this->assertSame($candidates, $result);

        $result = $this->engine->filterCandidatesByVettingRequirements($candidates, -5);
        $this->assertSame($candidates, $result);
    }

    public function test_filter_does_not_bypass_policy_for_staff_in_ordinary_discovery(): void
    {
        $candidates = [
            ['id' => 1, 'user_id' => 10],
            ['id' => 2, 'user_id' => 20],
        ];
        $this->bindSafeguardingDecisions([
            10 => SafeguardingInteractionDecision::DENY,
            20 => SafeguardingInteractionDecision::ALLOW,
        ]);

        $result = $this->engine->filterCandidatesByVettingRequirements($candidates, 42);

        $this->assertSame([2], array_column($result, 'id'));
    }

    public function test_filter_returns_all_candidates_when_none_require_vetting(): void
    {
        $candidates = [
            ['id' => 1, 'user_id' => 10],
            ['id' => 2, 'user_id' => 20],
        ];

        $result = $this->engine->filterCandidatesByVettingRequirements($candidates, 42);
        $this->assertCount(2, $result);
    }

    public function test_filter_includes_candidate_when_searcher_holds_required_vetting(): void
    {
        $candidates = [['id' => 99, 'user_id' => 10]];
        $this->bindSafeguardingDecisions([10 => SafeguardingInteractionDecision::ALLOW]);

        $result = $this->engine->filterCandidatesByVettingRequirements($candidates, 42);
        $this->assertCount(1, $result);
        $this->assertSame(99, $result[0]['id']);
    }

    public function test_filter_drops_candidate_when_searcher_lacks_required_vetting(): void
    {
        $candidates = [['id' => 99, 'user_id' => 10]];
        $this->bindSafeguardingDecisions([10 => SafeguardingInteractionDecision::DENY]);

        $result = $this->engine->filterCandidatesByVettingRequirements($candidates, 42);
        $this->assertEmpty($result);
    }

    public function test_filter_excludes_candidate_when_policy_is_unavailable(): void
    {
        $candidates = [['id' => 1, 'user_id' => 10]];
        $this->bindSafeguardingDecisions([10 => SafeguardingInteractionDecision::UNAVAILABLE]);

        $result = $this->engine->filterCandidatesByVettingRequirements($candidates, 42);

        $this->assertSame([], $result);
    }

    /**
     * An UNAVAILABLE drop is the gate failing closed, not protecting anyone —
     * the run must be marked degraded so the API can tell the member why the
     * list is short instead of showing a bare empty state (Sentry 134069538).
     */
    public function test_unavailable_drop_marks_the_run_degraded_for_the_member(): void
    {
        $this->bindSafeguardingDecisions([10 => SafeguardingInteractionDecision::UNAVAILABLE]);
        $this->engine->filterCandidatesByVettingRequirements([['id' => 1, 'user_id' => 10]], 42);

        $meta = ['degraded' => false, 'degraded_reason' => null];
        $this->applyVettingMeta($meta);

        $this->assertTrue($meta['degraded']);
        $this->assertSame('safeguarding_policy_unavailable', $meta['degraded_reason']);
    }

    /**
     * A DENY drop is the feature working as designed and must NOT surface as
     * degradation — advertising who is safeguarded would defeat the point.
     */
    public function test_deny_drop_does_not_mark_the_run_degraded(): void
    {
        $this->bindSafeguardingDecisions([10 => SafeguardingInteractionDecision::DENY]);
        $this->engine->filterCandidatesByVettingRequirements([['id' => 1, 'user_id' => 10]], 42);

        $meta = ['degraded' => false, 'degraded_reason' => null];
        $this->applyVettingMeta($meta);

        $this->assertFalse($meta['degraded']);
        $this->assertNull($meta['degraded_reason']);
    }

    public function test_existing_degraded_reason_keeps_precedence_over_vetting_unavailability(): void
    {
        $this->bindSafeguardingDecisions([10 => SafeguardingInteractionDecision::UNAVAILABLE]);
        $this->engine->filterCandidatesByVettingRequirements([['id' => 1, 'user_id' => 10]], 42);

        $meta = ['degraded' => true, 'degraded_reason' => 'no_coordinates'];
        $this->applyVettingMeta($meta);

        $this->assertSame('no_coordinates', $meta['degraded_reason']);
    }

    /** @param array<string, mixed> $meta */
    private function applyVettingMeta(array &$meta): void
    {
        $method = new \ReflectionMethod($this->engine, 'applyVettingUnavailabilityToMeta');
        $method->setAccessible(true);
        $args = [&$meta];
        $method->invokeArgs($this->engine, $args);
    }

    public function test_filter_mixed_candidates_drops_only_flagged_without_vetting(): void
    {
        $candidates = [
            ['id' => 1, 'user_id' => 10], // no requirements
            ['id' => 2, 'user_id' => 20], // denied
            ['id' => 3, 'user_id' => 30], // allowed
            ['id' => 4, 'user_id' => 40], // no requirements
        ];
        $this->bindSafeguardingDecisions([
            20 => SafeguardingInteractionDecision::DENY,
            30 => SafeguardingInteractionDecision::ALLOW,
        ]);

        $result = $this->engine->filterCandidatesByVettingRequirements($candidates, 42);

        // 1, 3, 4 kept (indexes reindexed); 2 dropped
        $ids = array_map(fn ($c) => $c['id'], $result);
        $this->assertContains(1, $ids);
        $this->assertNotContains(2, $ids);
        $this->assertContains(3, $ids);
        $this->assertContains(4, $ids);
    }

    public function test_filter_excludes_self_owned_candidates_from_vetting_lookup(): void
    {
        // Searcher=10 viewing candidates that include their own listing (user_id=10).
        // Self-owned candidates should not trigger a vetting lookup (you don't need
        // to vet yourself to see your own content).
        $candidates = [
            ['id' => 1, 'user_id' => 10], // self
            ['id' => 2, 'user_id' => 20],
        ];

        $result = $this->engine->filterCandidatesByVettingRequirements($candidates, 10);
        $this->assertCount(2, $result);
    }

    public function test_filter_fails_closed_when_policy_throws(): void
    {
        $candidates = [
            ['id' => 1, 'user_id' => 10],
            ['id' => 2, 'user_id' => 20],
        ];

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateLocalContact')->andThrow(new \RuntimeException('Policy unavailable'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $result = $this->engine->filterCandidatesByVettingRequirements($candidates, 42);

        $this->assertSame([], $result);
    }
}
