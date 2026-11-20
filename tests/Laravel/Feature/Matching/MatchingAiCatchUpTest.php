<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Matching;

use App\Jobs\DiscoverMatchesForListingJob;
use App\Jobs\ReadTextForMatchingJob;
use App\Models\Listing;
use App\Models\User;
use App\Services\Matching\MatchAiCatchUpService;
use App\Services\SmartMatchingEngine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The half-hourly matching run queues the AI work that is still owed for a
 * community: skills, opportunities and events not yet read, and listings
 * the AI has not yet looked for matches for. A few each run, so switching
 * AI on never floods the provider.
 */
class MatchingAiCatchUpTest extends TestCase
{
    use DatabaseTransactions;

    private function aiSwitch(bool $on): void
    {
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'ai_enabled'],
            ['setting_value' => $on ? 'true' : 'false', 'updated_at' => now()]
        );
        app(SmartMatchingEngine::class)->clearCache();
    }

    private function aSkillAndAListingNotYetLookedAt(): Listing
    {
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        DB::table('user_skills')->insert([
            'user_id' => $member->id, 'tenant_id' => $this->testTenantId, 'skill_name' => 'Zzyx unicycle repair',
            'proficiency' => 'intermediate', 'is_offering' => 1, 'is_requesting' => 0,
        ]);
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $member->id, 'type' => 'request', 'status' => 'active', 'moderation_status' => 'approved',
            'title' => 'Zzyx harp needs tuning',
        ]);
        Cache::flush(); // creating a listing queues real AI work that fails here and sets pauses

        return $listing;
    }

    public function test_work_still_owed_is_queued_a_few_at_a_time(): void
    {
        $this->aiSwitch(true);
        $listing = $this->aSkillAndAListingNotYetLookedAt();
        Bus::fake([ReadTextForMatchingJob::class, DiscoverMatchesForListingJob::class]);

        $queued = app(MatchAiCatchUpService::class)->queueFor($this->testTenantId);

        // Which texts come first is the reading service's business (and is
        // tested there); here, that what it lists is queued for this community.
        Bus::assertDispatched(ReadTextForMatchingJob::class, fn ($job) => $job->tenantId === $this->testTenantId
            && in_array($job->source, ['skill', 'opportunity', 'event'], true) && $job->text !== '');
        Bus::assertDispatched(DiscoverMatchesForListingJob::class, fn ($job) => $job->listingId === $listing->id);
        $this->assertGreaterThanOrEqual(1, $queued['readings']);
        $this->assertGreaterThanOrEqual(1, $queued['discoveries']);
        $this->assertLessThanOrEqual(MatchAiCatchUpService::READINGS_PER_RUN, $queued['readings']);
        $this->assertLessThanOrEqual(MatchAiCatchUpService::DISCOVERIES_PER_RUN, $queued['discoveries']);
    }

    public function test_nothing_is_queued_for_a_community_with_ai_off(): void
    {
        $this->aiSwitch(true);
        $this->aSkillAndAListingNotYetLookedAt();
        $this->aiSwitch(false);
        Bus::fake([ReadTextForMatchingJob::class, DiscoverMatchesForListingJob::class]);

        $queued = app(MatchAiCatchUpService::class)->queueFor($this->testTenantId);

        Bus::assertNotDispatched(ReadTextForMatchingJob::class);
        Bus::assertNotDispatched(DiscoverMatchesForListingJob::class);
        $this->assertSame(['readings' => 0, 'discoveries' => 0], $queued);
    }
}
