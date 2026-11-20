<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Matching;

use App\Models\Category;
use App\Models\Listing;
use App\Models\User;
use App\Services\Matching\MatchAlertCheckService;
use App\Services\Matching\MatchNotificationService;
use App\Services\SmartMatchingEngine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The AI looks at a strong match before the member is emailed about it
 * (20 Nov 2026). The provider call is replaced by a fake. The rule under
 * test throughout: the AI can only HOLD an alert it is sure is a mistake;
 * if it is off, fails or says nothing, the alert goes out as the engine
 * decided.
 */
class MatchingAiAlertCheckTest extends TestCase
{
    use DatabaseTransactions;

    private User $me;
    private Listing $mine;
    private Listing $new;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();

        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $config = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $config['algorithms']['smart_matching']['hot_match_threshold'] = 45;
        unset($config['algorithms']['smart_matching']['ai']);
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
        app(SmartMatchingEngine::class)->clearCache();
    }

    private function aiSwitch(bool $on): void
    {
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'ai_enabled'],
            ['setting_value' => $on ? 'true' : 'false', 'updated_at' => now()]
        );
        app(SmartMatchingEngine::class)->clearCache();
    }

    private function setAi(array $switches): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $config = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $config['algorithms']['smart_matching']['ai'] = $switches;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
        app(SmartMatchingEngine::class)->clearCache();
    }

    private function member(array $attrs = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active', 'is_approved' => 1, 'skills' => '', 'bio' => '',
            'latitude' => 51.5000, 'longitude' => -0.1200, 'last_active_at' => now(),
        ], $attrs));
    }

    /** A member with a gardening offer, and a gardening request posted just now by someone else. */
    private function aStrongMatchWithANewListing(): void
    {
        $category = Category::factory()->create([
            'tenant_id' => $this->testTenantId, 'type' => 'listing', 'name' => 'Gardening ' . random_int(10000000, 99999999),
        ]);
        $base = [
            'status' => 'active', 'moderation_status' => 'approved', 'category_id' => $category->id,
            'latitude' => 51.5000, 'longitude' => -0.1200, 'service_type' => 'physical_only',
        ];
        $this->me = $this->member(['first_name' => 'Zebediah', 'last_name' => 'Quillfeather']);
        $this->mine = Listing::factory()->forTenant($this->testTenantId)->create($base + [
            'user_id' => $this->me->id, 'type' => 'offer', 'title' => 'Hedge trimming and garden tidying',
            'description' => 'I can trim hedges and tidy gardens.', 'created_at' => now()->subDays(5),
        ]);
        $this->new = Listing::factory()->forTenant($this->testTenantId)->create($base + [
            'user_id' => $this->member()->id, 'type' => 'request', 'title' => 'Hedge needs trimming',
            'description' => 'My garden hedge is overgrown and needs trimming.', 'created_at' => now(),
        ]);
        Cache::flush(); // creating listings queues real AI work that fails here and sets pauses
    }

    private function useAi(?array $reply): FakeMatchAlertCheckService
    {
        $fake = new FakeMatchAlertCheckService();
        $fake->reply = $reply;
        app()->instance(MatchAlertCheckService::class, $fake);

        return $fake;
    }

    private function alertsFor(User $member): int
    {
        return DB::table('notifications')->where('user_id', $member->id)
            ->whereIn('type', ['hot_match', 'mutual_match'])->count();
    }

    public function test_control_the_member_is_alerted_when_no_ai_is_involved(): void
    {
        $this->aStrongMatchWithANewListing();
        $fake = $this->useAi(['not_a_fit' => [1]]);
        $this->aiSwitch(false);

        app(MatchNotificationService::class)->notifyForNewListings();

        $this->assertSame(1, $this->alertsFor($this->me));
        $this->assertSame(0, $fake->calls, 'With AI off the provider is never asked');
    }

    public function test_an_alert_the_ai_says_is_a_mistake_is_held_and_the_match_marked_down(): void
    {
        $this->aStrongMatchWithANewListing();
        $fake = $this->useAi(['not_a_fit' => [1]]);
        $this->aiSwitch(true);

        app(MatchNotificationService::class)->notifyForNewListings();

        $this->assertSame(1, $fake->calls);
        $this->assertSame(0, $this->alertsFor($this->me), 'The member was emailed about a match the AI called a mistake');
        $this->assertFalse(DB::table('match_notification_sent')->where('listing_id', $this->new->id)
            ->where('matched_user_id', $this->me->id)->exists());
        $this->assertEqualsWithDelta(-15.0, (float) DB::table('match_cache')->where('user_id', $this->me->id)
            ->where('listing_id', $this->new->id)->value('ai_rerank_delta'), 0.01,
            'The verdict is kept, so the match also drops down the member\'s list');

        // What the AI was told: the member's own listing, never who they are.
        $this->assertStringContainsString('Hedge trimming and garden tidying', $fake->lastItems[0]['text']);
        $sent = json_encode([$fake->lastSource, $fake->lastItems]);
        $this->assertStringNotContainsString('Zebediah', (string) $sent);
        $this->assertStringNotContainsString('Quillfeather', (string) $sent);
    }

    public function test_the_alert_goes_out_when_the_ai_has_no_objection(): void
    {
        $this->aStrongMatchWithANewListing();
        $fake = $this->useAi(['not_a_fit' => []]);
        $this->aiSwitch(true);

        app(MatchNotificationService::class)->notifyForNewListings();

        $this->assertSame(1, $fake->calls);
        $this->assertSame(1, $this->alertsFor($this->me));
    }

    public function test_the_alert_goes_out_when_the_ai_fails(): void
    {
        $this->aStrongMatchWithANewListing();
        $this->useAi(null);
        $this->aiSwitch(true);

        app(MatchNotificationService::class)->notifyForNewListings();

        $this->assertSame(1, $this->alertsFor($this->me), 'A provider failure must never stop a match alert');
    }

    public function test_the_community_can_switch_the_check_off(): void
    {
        $this->aStrongMatchWithANewListing();
        $fake = $this->useAi(['not_a_fit' => [1]]);
        $this->aiSwitch(true);
        $this->setAi(['alert_check' => false]);

        app(MatchNotificationService::class)->notifyForNewListings();

        $this->assertSame(0, $fake->calls);
        $this->assertSame(1, $this->alertsFor($this->me));
    }

    public function test_a_pair_the_ai_already_named_a_good_fit_is_not_asked_about_again(): void
    {
        $this->aStrongMatchWithANewListing();
        $fake = $this->useAi(['not_a_fit' => [1]]);
        $this->aiSwitch(true);
        DB::table('listing_match_discoveries')->insert([
            'tenant_id' => $this->testTenantId, 'listing_id' => $this->new->id, 'content_hash' => str_repeat('a', 64),
            'fits' => json_encode(['l' => [$this->mine->id => 3], 's' => (object) []]), 'considered' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        app(MatchNotificationService::class)->notifyForNewListings();

        $this->assertSame(0, $fake->calls, 'The AI has already said these two fit');
        $this->assertSame(1, $this->alertsFor($this->me));
    }

    public function test_a_member_the_ai_picked_for_a_new_listing_is_on_the_alert_shortlist(): void
    {
        // More members point the right way than the run considers for one
        // listing (40). Words alone cannot tell which of them fits.
        $base = [
            'status' => 'active', 'moderation_status' => 'approved', 'category_id' => null,
            'latitude' => 51.5000, 'longitude' => -0.1200, 'service_type' => 'physical_only',
        ];
        foreach (range(1, 45) as $n) {
            Listing::factory()->forTenant($this->testTenantId)->create($base + [
                'user_id' => $this->member()->id, 'type' => 'offer', 'title' => "Knitting circle {$n}",
                'description' => 'Knitting and crochet for beginners.', 'created_at' => now()->subDays(20),
            ]);
        }
        $luthier = $this->member(['last_active_at' => now()->subDays(21)]);
        $offer = Listing::factory()->forTenant($this->testTenantId)->create($base + [
            'user_id' => $luthier->id, 'type' => 'offer', 'title' => 'Stringed instrument maintenance',
            'description' => 'Restringing and regulating at your home.', 'created_at' => now()->subDays(20),
        ]);
        $request = Listing::factory()->forTenant($this->testTenantId)->create($base + [
            'user_id' => $this->member()->id, 'type' => 'request', 'title' => 'Wer kann meine Harfe stimmen?',
            'description' => 'Sie klingt seit dem Umzug schief.', 'created_at' => now(),
        ]);
        Cache::flush();
        DB::table('listing_match_discoveries')->insert([
            'tenant_id' => $this->testTenantId, 'listing_id' => $request->id, 'content_hash' => str_repeat('a', 64),
            'fits' => json_encode(['l' => [$offer->id => 3], 's' => (object) []]), 'considered' => 46,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->useAi(['not_a_fit' => []]);
        $this->aiSwitch(true);

        app(MatchNotificationService::class)->notifyForNewListings();

        $this->assertSame(1, $this->alertsFor($luthier),
            'The one member whose offer the AI picked was left off the shortlist of 40');
    }
}

class FakeMatchAlertCheckService extends MatchAlertCheckService
{
    /** @var array{not_a_fit: int[]}|null null = the provider failed */
    public ?array $reply = null;
    public int $calls = 0;
    /** @var array<string, mixed> */
    public array $lastSource = [];
    /** @var array<int, array{n: int, text: string}> */
    public array $lastItems = [];

    protected function callLlm(array $source, array $items): ?array
    {
        $this->calls++;
        $this->lastSource = $source;
        $this->lastItems = $items;

        return $this->reply;
    }
}
