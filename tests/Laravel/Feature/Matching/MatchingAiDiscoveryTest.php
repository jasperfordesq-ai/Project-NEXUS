<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Matching;

use App\Models\Listing;
use App\Models\User;
use App\Services\Matching\MatchDiscoveryService;
use App\Services\Matching\TextReadingService;
use App\Services\SmartMatchingEngine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The AI finds matches the engine missed (20 Nov 2026): shown one listing
 * and the community's open offers or requests, it names the ones that
 * really fit. The provider call is replaced by a fake. The engine's own
 * rules (distance, safeguarding, minimum score) still decide what a member
 * sees, and with AI off none of this is read.
 */
class MatchingAiDiscoveryTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
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

    private function listing(User $owner, string $type, string $title, string $description = '', array $attrs = []): Listing
    {
        $listing = Listing::factory()->forTenant($this->testTenantId)->create(array_merge([
            'user_id' => $owner->id, 'type' => $type, 'status' => 'active', 'moderation_status' => 'approved',
            'category_id' => null, 'title' => $title, 'description' => $description,
            'latitude' => 51.5000, 'longitude' => -0.1200, 'service_type' => 'physical_only',
            'created_at' => now()->subDays(3),
        ], $attrs));
        // Creating a listing queues real AI work, which fails here and pauses
        // the catch-up runs; that pause is not what these tests are about.
        Cache::flush();

        return $listing;
    }

    private function skill(User $member, string $name, bool $offering = true): void
    {
        DB::table('user_skills')->insert([
            'user_id' => $member->id, 'tenant_id' => $this->testTenantId, 'skill_name' => $name,
            'proficiency' => 'intermediate', 'is_offering' => $offering ? 1 : 0, 'is_requesting' => $offering ? 0 : 1,
        ]);
    }

    /** @param array<int|string, int> $listings @param array<string, int> $skills */
    private function found(Listing $listing, array $listings, array $skills = []): void
    {
        $fits = ['l' => (object) $listings, 's' => (object) $skills];
        DB::table('listing_match_discoveries')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'listing_id' => $listing->id],
            ['content_hash' => str_repeat('a', 64), 'fits' => json_encode($fits), 'considered' => 5,
             'created_at' => now(), 'updated_at' => now()]
        );
    }

    private function fake(?array $fits): FakeMatchDiscoveryService
    {
        $service = new FakeMatchDiscoveryService();
        $service->fits = $fits;

        return $service;
    }

    /** @return array<string, mixed>|null */
    private function matchFor(User $member, Listing $listing): ?array
    {
        return collect(app(SmartMatchingEngine::class)->findMatchesForUser($member->id, ['limit' => 50]))
            ->first(fn ($m) => (int) $m['id'] === $listing->id && ($m['match_type'] ?? '') !== 'cold_start');
    }

    // ---------------------------------------------------------------------
    // Asking the AI
    // ---------------------------------------------------------------------

    public function test_the_ai_is_shown_the_open_listings_of_the_other_kind_and_its_picks_are_stored(): void
    {
        $this->aiSwitch(true);
        $me = $this->member(['first_name' => 'Zebediah', 'last_name' => 'Quillfeather']);
        $other = $this->member(['first_name' => 'Ottoline', 'last_name' => 'Vandersloot']);
        $request = $this->listing($me, 'request', 'Zzyx harp needs tuning', 'It sounds wrong since the move.');
        $offerA = $this->listing($other, 'offer', 'Zzyx stringed instrument care');
        $offerB = $this->listing($other, 'offer', 'Zzyx dog walking');
        $this->listing($me, 'offer', 'Zzyx my own offer');
        $this->listing($other, 'request', 'Zzyx someone else needs a lift');
        $this->listing($other, 'offer', 'Zzyx paused offer', '', ['status' => 'paused']);

        $service = $this->fake(null);
        $service->pick = fn (array $items) => array_values(array_filter(array_map(
            fn ($item) => str_contains($item['text'], 'stringed') ? ['n' => $item['n'], 'strength' => 7] : null,
            $items
        ))) + [99 => ['n' => 9999, 'strength' => 3]];

        $this->assertTrue($service->discover($this->testTenantId, $request->id));

        $shown = array_values(array_filter($service->lastItems, fn ($item) => str_contains($item['text'], 'Zzyx')));
        $titles = array_map(fn ($item) => explode("\n", $item['text'])[0], $shown);
        sort($titles);
        $this->assertSame(['Zzyx dog walking', 'Zzyx stringed instrument care'], $titles,
            'Only other members\' live listings of the other kind');
        $everything = json_encode([$service->lastSource, $service->lastItems]);
        foreach (['Zebediah', 'Quillfeather', 'Ottoline', 'Vandersloot'] as $name) {
            $this->assertStringNotContainsString($name, (string) $everything, 'No member name is sent');
        }

        $stored = $service->fitsFor($this->testTenantId, [$request->id])[$request->id] ?? null;
        $this->assertNotNull($stored);
        $this->assertSame([$offerA->id => 3], $stored['l'], 'The pick is kept, its strength held to 1-3, an unknown number ignored');
        $this->assertArrayNotHasKey($offerB->id, $stored['l']);
    }

    public function test_profile_skills_pointing_the_right_way_are_shown_too_without_saying_whose(): void
    {
        $this->aiSwitch(true);
        $request = $this->listing($this->member(), 'request', 'Zzyx my one-wheeler is broken');
        $this->skill($this->member(), 'Zzyx unicycle repair');
        $this->skill($this->member(), 'zzyx Unicycle Repair'); // a second member, same skill
        $this->skill($this->member(), 'Zzyx wanted skill', false);

        $service = $this->fake(null);
        $service->pick = fn (array $items) => array_values(array_filter(array_map(
            fn ($item) => $item['kind'] === 'skill' ? ['n' => $item['n'], 'strength' => 2] : null,
            $items
        )));
        $service->discover($this->testTenantId, $request->id);

        $skills = array_values(array_filter($service->lastItems, fn ($item) => $item['kind'] === 'skill' && stripos($item['text'], 'zzyx') !== false));
        $this->assertCount(1, $skills, 'One line per skill, however many members have it; skills wanted are not what a request needs');
        $stored = $service->fitsFor($this->testTenantId, [$request->id])[$request->id];
        $this->assertSame(2, $stored['s'][TextReadingService::key('Zzyx unicycle repair')] ?? null);
    }

    public function test_a_listing_is_asked_about_once_until_its_words_change_or_two_weeks_pass(): void
    {
        $this->aiSwitch(true);
        $request = $this->listing($this->member(), 'request', 'Zzyx harp needs tuning');
        $this->listing($this->member(), 'offer', 'Zzyx stringed instrument care');
        $service = $this->fake([]);

        $this->assertContains($request->id, $service->listingsNeedingDiscovery($this->testTenantId, 5000));
        $this->assertTrue($service->discover($this->testTenantId, $request->id));
        $this->assertFalse($service->discover($this->testTenantId, $request->id));
        $this->assertSame(1, $service->calls, 'Nothing found is an answer too: not asked again');
        $this->assertNotContains($request->id, $service->listingsNeedingDiscovery($this->testTenantId, 5000));

        DB::table('listings')->where('id', $request->id)->update(['title' => 'Zzyx harp needs new strings']);
        $this->assertTrue($service->discover($this->testTenantId, $request->id));
        $this->assertSame(2, $service->calls);

        DB::table('listing_match_discoveries')->where('listing_id', $request->id)
            ->update(['created_at' => now()->subDays(15), 'updated_at' => now()->subDays(15)]);
        $this->assertContains($request->id, $service->listingsNeedingDiscovery($this->testTenantId, 5000),
            'Looked at again after two weeks, for skills and listings added since');
        $this->assertTrue($service->discover($this->testTenantId, $request->id));
    }

    public function test_nothing_is_asked_while_ai_is_off_or_the_switch_is_off_and_a_failure_pauses_it(): void
    {
        $request = $this->listing($this->member(), 'request', 'Zzyx harp needs tuning');
        $this->listing($this->member(), 'offer', 'Zzyx stringed instrument care');
        $service = $this->fake([]);

        $this->aiSwitch(false);
        $this->assertFalse($service->discover($this->testTenantId, $request->id));
        $this->assertSame([], $service->listingsNeedingDiscovery($this->testTenantId, 10));

        $this->aiSwitch(true);
        $this->setAi(['discovery' => false]);
        $this->assertFalse($service->discover($this->testTenantId, $request->id));
        $this->assertSame([], $service->listingsNeedingDiscovery($this->testTenantId, 10));
        $this->assertSame(0, $service->calls);

        $this->setAi(['discovery' => true]);
        $failing = $this->fake(null);
        $this->assertFalse($failing->discover($this->testTenantId, $request->id));
        $this->assertSame([], $failing->listingsNeedingDiscovery($this->testTenantId, 5000),
            'A key with no credit is not asked again on every run');
    }

    public function test_a_deleted_listing_loses_what_the_ai_found_for_it(): void
    {
        $request = $this->listing($this->member(), 'request', 'Zzyx harp needs tuning');
        $this->found($request, [123 => 3]);

        $request->delete();

        $this->assertFalse(DB::table('listing_match_discoveries')->where('listing_id', $request->id)->exists());
    }

    // ---------------------------------------------------------------------
    // What it changes for a member
    // ---------------------------------------------------------------------

    public function test_two_listings_with_no_word_in_common_meet_when_the_ai_found_them(): void
    {
        $me = $this->member();
        $mine = $this->listing($me, 'request', 'Wer kann meine Harfe stimmen?', 'Sie klingt seit dem Umzug schief.');
        $theirs = $this->listing($this->member(), 'offer', 'Stringed instrument maintenance', 'Restringing and regulating at your home.');
        $this->found($mine, [$theirs->id => 3]);

        $this->aiSwitch(false);
        $this->assertNull($this->matchFor($me, $theirs), 'Control: without AI these share no word and do not meet');

        $this->aiSwitch(true);
        $match = $this->matchFor($me, $theirs);
        $this->assertNotNull($match, 'The AI found the pair; the engine now shows it');
        $this->assertSame(3, $match['ai_fit']);

        $this->setAi(['discovery' => false]);
        $this->assertNull($this->matchFor($me, $theirs), 'The community switched this part off');
    }

    public function test_a_pair_found_from_the_other_listings_side_counts_just_the_same(): void
    {
        $this->aiSwitch(true);
        $me = $this->member();
        $mine = $this->listing($me, 'request', 'Wer kann meine Harfe stimmen?', 'Sie klingt seit dem Umzug schief.');
        $theirs = $this->listing($this->member(), 'offer', 'Stringed instrument maintenance', 'Restringing and regulating at your home.');
        $this->assertNull($this->matchFor($me, $theirs));

        $this->found($theirs, [$mine->id => 2]);

        $this->assertNotNull($this->matchFor($me, $theirs));
    }

    public function test_a_member_is_matched_through_a_profile_skill_the_ai_picked_for_a_request(): void
    {
        $this->aiSwitch(true);
        $me = $this->member();
        $this->skill($me, 'Monocycle mending');
        $request = $this->listing($this->member(), 'request', 'One-wheeler will not roll', 'The tyre is flat and the pedal is loose.');
        $this->assertNull($this->matchFor($me, $request), 'Control: no word in common');

        $this->found($request, [], [TextReadingService::key('Monocycle mending') => 3]);

        $match = $this->matchFor($me, $request);
        $this->assertNotNull($match);
        $this->assertTrue($match['matched_from_skill']);
    }

    public function test_what_the_ai_found_never_overrides_the_distance_rule(): void
    {
        $this->aiSwitch(true);
        $me = $this->member();
        $mine = $this->listing($me, 'request', 'Wer kann meine Harfe stimmen?');
        // About 400 km away, in person only.
        $far = $this->listing($this->member(['latitude' => 55.0, 'longitude' => -1.6]), 'offer',
            'Stringed instrument maintenance', '', ['latitude' => 55.0, 'longitude' => -1.6]);
        $this->found($mine, [$far->id => 3]);

        $this->assertNull($this->matchFor($me, $far));
    }
}

class FakeMatchDiscoveryService extends MatchDiscoveryService
{
    /** @var array<int, array{n: int, strength: int}>|null what the provider "replies"; null = it failed */
    public ?array $fits = null;
    /** @var (\Closure(array): array)|null builds the reply from the items shown */
    public ?\Closure $pick = null;
    public int $calls = 0;
    /** @var array<string, mixed> */
    public array $lastSource = [];
    /** @var array<int, array{n: int, kind: string, text: string}> */
    public array $lastItems = [];

    protected function callLlm(array $source, array $items): ?array
    {
        $this->calls++;
        $this->lastSource = $source;
        $this->lastItems = $items;
        if ($this->pick !== null) {
            return ['fits' => ($this->pick)($items)];
        }

        return $this->fits === null ? null : ['fits' => $this->fits];
    }
}
