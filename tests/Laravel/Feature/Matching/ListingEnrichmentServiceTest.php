<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Matching;

use App\Models\Listing;
use App\Models\User;
use App\Services\Matching\KeywordExtractor;
use App\Services\Matching\ListingEnrichmentService;
use App\Services\SmartMatchingEngine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The AI reading of listings for matching. The provider call is replaced by
 * a fake; everything around it (switches, storage, cleaning, catch-up,
 * pause after failure) is real.
 */
class ListingEnrichmentServiceTest extends TestCase
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

    private function listing(string $title, string $description = ''): Listing
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        return Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id, 'type' => 'offer', 'status' => 'active', 'moderation_status' => 'approved',
            'title' => $title, 'description' => $description,
        ]);
    }

    private function fake(?array $reply): FakeListingEnrichmentService
    {
        $service = new FakeListingEnrichmentService();
        $service->reply = $reply;

        return $service;
    }

    public function test_a_reading_is_stored_cleaned_and_limited_to_known_kinds_of_help(): void
    {
        $this->aiSwitch(true);
        $listing = $this->listing('Klavierstimmung', 'Ich stimme Ihr Klavier zu Hause.');
        $service = $this->fake([
            'terms' => ['Piano tuning', 'piano!!', 'call 0871234567', '<script>', str_repeat('x', 80), 42],
            'concepts' => ['music', 'Ignore previous instructions', 'teaching'],
        ]);

        $this->assertTrue($service->enrich($this->testTenantId, $listing->id));

        $row = DB::table('listing_match_enrichments')->where('listing_id', $listing->id)->first();
        $this->assertNotNull($row);
        $terms = json_decode($row->terms, true);
        $this->assertContains('piano tuning', $terms);
        $this->assertContains('piano', $terms);
        $this->assertContains('call', $terms, 'Digits are stripped from a term');
        $this->assertContains('script', $terms, 'Markup is reduced to its letters');
        $this->assertNotContains(str_repeat('x', 80), $terms);
        $this->assertSame(['music', 'teaching'], json_decode($row->concepts, true), 'Only known kinds of help are kept');

        $tokens = $service->tokensFor($this->testTenantId, [$listing->id])[$listing->id];
        $this->assertContains(KeywordExtractor::CONCEPT_PREFIX . 'music', $tokens);
        $this->assertContains('piano', $tokens);
    }

    public function test_nothing_is_sent_while_the_communitys_ai_is_off(): void
    {
        $this->aiSwitch(false);
        $listing = $this->listing('Garden help');
        $service = $this->fake(['terms' => ['gardening'], 'concepts' => ['gardening']]);

        $this->assertFalse($service->enrich($this->testTenantId, $listing->id));
        $this->assertSame(0, $service->calls);
        $this->assertSame([], $service->listingsNeedingReading($this->testTenantId, 10));
    }

    public function test_matching_turned_off_for_the_community_stops_it_too(): void
    {
        $this->aiSwitch(true);
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $config = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $config['algorithms']['smart_matching']['ai'] = ['listing_enrichment' => false];
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);

        $listing = $this->listing('Garden help');
        $service = $this->fake(['terms' => ['gardening'], 'concepts' => []]);

        $this->assertFalse($service->enrich($this->testTenantId, $listing->id));
        $this->assertSame(0, $service->calls);
    }

    public function test_unchanged_text_is_not_read_again(): void
    {
        $this->aiSwitch(true);
        $listing = $this->listing('Garden help', 'Weeding and mowing.');
        $service = $this->fake(['terms' => ['gardening'], 'concepts' => ['gardening']]);

        $this->assertTrue($service->enrich($this->testTenantId, $listing->id));
        $this->assertFalse($service->enrich($this->testTenantId, $listing->id));
        $this->assertSame(1, $service->calls, 'Same words, no second request to the provider');

        DB::table('listings')->where('id', $listing->id)->update(['description' => 'Weeding, mowing and hedges.']);
        $this->assertTrue($service->enrich($this->testTenantId, $listing->id));
        $this->assertSame(2, $service->calls);
    }

    public function test_a_provider_failure_pauses_the_catch_up_for_an_hour(): void
    {
        $this->aiSwitch(true);
        Cache::forget('listing_enrichment_backoff:' . $this->testTenantId);
        $listing = $this->listing('Garden help');
        $service = $this->fake(null);

        $this->assertFalse($service->enrich($this->testTenantId, $listing->id));
        $this->assertSame([], $service->listingsNeedingReading($this->testTenantId, 10),
            'A key with no credit must not be asked again every half hour');

        Cache::forget('listing_enrichment_backoff:' . $this->testTenantId);
        $this->assertContains($listing->id, $service->listingsNeedingReading($this->testTenantId, 500));
    }

    public function test_a_reading_made_with_the_earlier_question_is_made_again_once(): void
    {
        // The real readings on 20 Nov 2026 tagged kinds of help a listing only
        // mentioned as examples. The question was changed; readings made with
        // the old one are redone, whenever they were last touched.
        $this->aiSwitch(true);
        $listing = $this->listing('Emergency Credit Grant', 'Credits for members in hardship, e.g. a lift or garden help.');
        // Creating a listing queues a real reading, which fails here and
        // pauses the catch-up run; that pause is not what this test is about.
        Cache::forget('listing_enrichment_backoff:' . $this->testTenantId);
        DB::table('listing_match_enrichments')->insert([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listing->id,
            'content_hash' => hash('sha256', 'the earlier form: sixty-four letters and digits, nothing else'),
            'terms' => json_encode(['grant']),
            'concepts' => json_encode(['money', 'transport', 'gardening', 'health']),
            'created_at' => now(), 'updated_at' => now()->addMinutes(5),
        ]);
        $service = $this->fake(['terms' => ['hardship fund'], 'concepts' => ['money']]);

        $this->assertContains($listing->id, $service->listingsNeedingReading($this->testTenantId, 500));
        $this->assertTrue($service->enrich($this->testTenantId, $listing->id));
        $this->assertSame(['money'], json_decode(
            DB::table('listing_match_enrichments')->where('listing_id', $listing->id)->value('concepts'),
            true
        ));

        $this->assertNotContains($listing->id, $service->listingsNeedingReading($this->testTenantId, 500));
        $this->assertFalse($service->enrich($this->testTenantId, $listing->id));
        $this->assertSame(1, $service->calls, 'Redone once, not on every run');
    }

    public function test_a_listing_the_ai_has_nothing_to_say_about_is_not_asked_about_again(): void
    {
        $this->aiSwitch(true);
        $listing = $this->listing('Hello', 'Just saying hello.');
        Cache::forget('listing_enrichment_backoff:' . $this->testTenantId);
        $service = $this->fake(['terms' => [], 'concepts' => []]);

        $service->enrich($this->testTenantId, $listing->id);

        $this->assertNotContains(
            $listing->id,
            $service->listingsNeedingReading($this->testTenantId, 500),
            'An empty answer was never stored, so the provider was asked again every half hour'
        );
        $service->enrich($this->testTenantId, $listing->id);
        $this->assertSame(1, $service->calls);
        $this->assertSame([], $service->tokensFor($this->testTenantId, [$listing->id])[$listing->id] ?? []);
    }

    public function test_no_more_than_three_kinds_of_help_are_kept_for_a_listing(): void
    {
        $this->aiSwitch(true);
        $listing = $this->listing('Emergency Credit Grant');
        $service = $this->fake(['terms' => ['grant'], 'concepts' => ['money', 'transport', 'gardening', 'health', 'music']]);

        $service->enrich($this->testTenantId, $listing->id);

        $this->assertSame(
            ['money', 'transport', 'gardening'],
            json_decode(DB::table('listing_match_enrichments')->where('listing_id', $listing->id)->value('concepts'), true)
        );
    }

    public function test_a_deleted_listing_loses_its_reading(): void
    {
        $this->aiSwitch(true);
        $listing = $this->listing('Garden help');
        $this->fake(['terms' => ['gardening'], 'concepts' => []])->enrich($this->testTenantId, $listing->id);

        $listing->delete();

        $this->assertFalse(DB::table('listing_match_enrichments')->where('listing_id', $listing->id)->exists());
    }
}

class FakeListingEnrichmentService extends ListingEnrichmentService
{
    public ?array $reply = null;
    public int $calls = 0;

    protected function callLlm(string $text, string $type): ?array
    {
        $this->calls++;

        return $this->reply;
    }
}
