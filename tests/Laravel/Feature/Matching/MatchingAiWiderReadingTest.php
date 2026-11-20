<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Matching;

use App\Models\Event;
use App\Models\Listing;
use App\Models\User;
use App\Services\Matching\TextReadingService;
use App\Services\SmartMatchingEngine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The AI reads more than listings (20 Nov 2026): profile skills, volunteering
 * opportunities and events. The provider call is replaced by a fake;
 * everything around it is real. Every test also shows the plain engine
 * carrying on, unchanged, with AI off.
 */
class MatchingAiWiderReadingTest extends TestCase
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

    private function skill(User $member, string $name, bool $offering = true): void
    {
        DB::table('user_skills')->insert([
            'user_id' => $member->id, 'tenant_id' => $this->testTenantId, 'skill_name' => $name,
            'proficiency' => 'intermediate', 'is_offering' => $offering ? 1 : 0, 'is_requesting' => $offering ? 0 : 1,
        ]);
    }

    private function stored(string $text, string $source, array $terms, array $concepts = []): void
    {
        DB::table('match_text_readings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'text_hash' => TextReadingService::key($text)],
            ['source' => $source, 'terms' => json_encode($terms), 'concepts' => json_encode($concepts),
             'created_at' => now(), 'updated_at' => now()]
        );
    }

    private function fake(?array $reply): FakeTextReadingService
    {
        $service = new FakeTextReadingService();
        $service->reply = $reply;

        return $service;
    }

    private function opportunity(array $attrs = []): int
    {
        $orgId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $this->member()->id, 'name' => 'Org ' . uniqid(),
            'description' => 'A community organisation.', 'status' => 'approved', 'created_at' => now(),
        ]);

        return (int) DB::table('vol_opportunities')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId, 'organization_id' => $orgId, 'title' => 'Allotment helper',
            'description' => 'Help keep the beds tidy.', 'skills_needed' => 'gardening, weeding',
            'is_active' => 1, 'status' => 'open', 'created_at' => now(),
        ], $attrs));
    }

    /** @return array<int, array<string, mixed>> */
    private function matchesOf(User $member, string $query): array
    {
        Sanctum::actingAs($member, ['*']);
        $response = $this->apiGet('/v2/matches/all?' . $query);
        $response->assertStatus(200);

        return $response->json('data.matches');
    }

    // ---------------------------------------------------------------------
    // The reading itself
    // ---------------------------------------------------------------------

    public function test_a_skill_is_read_once_for_the_whole_community_and_no_row_says_whose_it_is(): void
    {
        $this->aiSwitch(true);
        $service = $this->fake(['terms' => ['Hedge trimming', 'hedge cutting'], 'concepts' => ['gardening', 'not a kind']]);

        $this->assertTrue($service->read($this->testTenantId, 'Heckenschnitt', 'skill'));
        $this->assertFalse($service->read($this->testTenantId, '  heckenschnitt ', 'skill'), 'Same skill, typed differently');
        $this->assertSame(1, $service->calls);

        $row = DB::table('match_text_readings')->where('tenant_id', $this->testTenantId)
            ->where('text_hash', TextReadingService::key('Heckenschnitt'))->first();
        $this->assertNotNull($row);
        $this->assertSame(['gardening'], json_decode($row->concepts, true));
        $this->assertObjectNotHasProperty('user_id', $row);

        $tokens = $service->tokensFor($this->testTenantId, ['HECKENSCHNITT', 'never read']);
        $this->assertArrayHasKey('HECKENSCHNITT', $tokens);
        $this->assertArrayNotHasKey('never read', $tokens);
        $this->assertContains('~gardening', $tokens['HECKENSCHNITT']);
    }

    public function test_nothing_is_read_while_ai_is_off_or_the_switch_is_off(): void
    {
        $service = $this->fake(['terms' => ['gardening'], 'concepts' => ['gardening']]);

        $this->aiSwitch(false);
        $this->assertFalse($service->read($this->testTenantId, 'Gardening', 'skill'));
        $this->assertSame([], $service->textsNeedingReading($this->testTenantId, 10));

        $this->aiSwitch(true);
        $this->setAi(['wider_reading' => false]);
        $this->assertFalse($service->read($this->testTenantId, 'Gardening', 'skill'));
        $this->assertSame([], $service->textsNeedingReading($this->testTenantId, 10));

        $this->assertSame(0, $service->calls);
    }

    public function test_the_catch_up_finds_skills_opportunities_and_events_not_yet_read(): void
    {
        $this->aiSwitch(true);
        $member = $this->member();
        $this->skill($member, 'Zzyx unicycle repair');
        $this->skill($member, 'Zzyx already read');
        $this->stored('Zzyx already read', 'skill', ['repair']);
        $this->opportunity(['title' => 'Zzyx opportunity', 'description' => 'Help wanted.', 'skills_needed' => '']);
        $this->opportunity(['title' => 'Zzyx closed', 'status' => 'closed']);
        Event::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $member->id, 'title' => 'Zzyx event', 'description' => 'Come along.', 'status' => 'active',
            'publication_status' => 'published', 'operational_status' => 'scheduled',
            'start_time' => now()->addDays(3), 'start_date' => now()->addDays(3), 'end_time' => now()->addDays(3)->addHours(2),
        ]);

        $due = $this->fake(null)->textsNeedingReading($this->testTenantId, 5000);
        $bySource = [];
        foreach ($due as $item) {
            if (str_contains($item['text'], 'Zzyx')) {
                $bySource[$item['source']][] = $item['text'];
            }
        }

        $this->assertSame(['Zzyx unicycle repair'], $bySource['skill'] ?? []);
        $this->assertCount(1, $bySource['opportunity'] ?? [], 'The open opportunity, not the closed one');
        $this->assertStringContainsString('Zzyx opportunity', $bySource['opportunity'][0]);
        $this->assertCount(1, $bySource['event'] ?? []);
    }

    public function test_a_provider_failure_pauses_the_catch_up(): void
    {
        $this->aiSwitch(true);
        $this->skill($this->member(), 'Zzyx unicycle repair');
        $service = $this->fake(null);

        $this->assertFalse($service->read($this->testTenantId, 'Zzyx unicycle repair', 'skill'));
        $this->assertSame([], $service->textsNeedingReading($this->testTenantId, 5000));
    }

    // ---------------------------------------------------------------------
    // What the readings change
    // ---------------------------------------------------------------------

    public function test_a_profile_skill_in_another_language_meets_a_request_only_with_ai_on(): void
    {
        $me = $this->member();
        $this->skill($me, 'Heckenschnitt');
        $request = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $this->member()->id, 'type' => 'request', 'status' => 'active', 'moderation_status' => 'approved',
            'category_id' => null, 'title' => 'Hedge needs trimming', 'description' => 'My hedge is overgrown.',
            'latitude' => 51.5000, 'longitude' => -0.1200, 'service_type' => 'physical_only', 'created_at' => now()->subDays(3),
        ]);
        $this->stored('Heckenschnitt', 'skill', ['hedge trimming', 'hedge cutting'], ['gardening']);
        $engine = app(SmartMatchingEngine::class);
        $find = fn () => collect($engine->findMatchesForUser($me->id, ['limit' => 50]))
            ->first(fn ($m) => (int) $m['id'] === $request->id && ($m['match_type'] ?? '') !== 'cold_start');

        $this->aiSwitch(false);
        $this->assertNull($find(), 'Control: without AI the German skill and the English request share nothing');

        $this->aiSwitch(true);
        $match = $find();
        $this->assertNotNull($match, 'With the AI reading of the skill, the member is matched to the request');
        $this->assertTrue($match['matched_from_skill']);

        $this->setAi(['wider_reading' => false]);
        $this->assertNull($find(), 'The community switched this part off');
    }

    public function test_a_volunteering_opportunity_in_another_language_is_suggested_only_with_ai_on(): void
    {
        $me = $this->member();
        $this->skill($me, 'Gardening');
        $title = 'Helfer für den Gemeinschaftsgarten';
        $description = 'Wir suchen jemanden zum Jäten.';
        $id = $this->opportunity(['title' => $title, 'description' => $description, 'skills_needed' => '']);
        $this->stored(TextReadingService::opportunityText($title, '', $description), 'opportunity', ['weeding'], ['gardening']);
        $ids = fn () => array_column(
            array_filter($this->matchesOf($me, 'modules=volunteering&min_score=0'), fn ($m) => $m['module'] === 'volunteering'),
            'opportunity_id'
        );

        $this->aiSwitch(false);
        $this->assertNotContains($id, $ids());

        $this->aiSwitch(true);
        $this->assertContains($id, $ids());
    }

    public function test_a_members_skill_in_another_language_meets_an_opportunity_only_with_ai_on(): void
    {
        $me = $this->member();
        $this->skill($me, 'Puutarhanhoito');
        $id = $this->opportunity();
        $this->stored('Puutarhanhoito', 'skill', ['gardening'], ['gardening']);
        $ids = fn () => array_column(
            array_filter($this->matchesOf($me, 'modules=volunteering&min_score=0'), fn ($m) => $m['module'] === 'volunteering'),
            'opportunity_id'
        );

        $this->aiSwitch(false);
        $this->assertNotContains($id, $ids());

        $this->aiSwitch(true);
        $this->assertContains($id, $ids());
    }

    public function test_an_event_in_another_language_is_suggested_only_with_ai_on(): void
    {
        $me = $this->member();
        $this->skill($me, 'Gardening');
        $title = 'Pflanzentauschbörse';
        $description = 'Bringt eure Setzlinge mit.';
        $event = Event::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $this->member()->id, 'title' => $title, 'description' => $description, 'status' => 'active',
            'category_id' => null, 'publication_status' => 'published', 'operational_status' => 'scheduled',
            'start_time' => now()->addDays(3), 'start_date' => now()->addDays(3), 'end_time' => now()->addDays(3)->addHours(2),
            'max_attendees' => null,
        ]);
        $this->stored(TextReadingService::eventText($title, $description), 'event', ['plant swap', 'seedlings'], ['gardening']);
        $ids = fn () => array_column(
            array_filter($this->matchesOf($me, 'modules=events&min_score=0'), fn ($m) => $m['module'] === 'event'),
            'event_id'
        );

        $this->aiSwitch(false);
        $this->assertNotContains($event->id, $ids());

        $this->aiSwitch(true);
        $this->assertContains($event->id, $ids());
    }
}

class FakeTextReadingService extends TextReadingService
{
    public ?array $reply = null;
    public int $calls = 0;

    protected function ask(string $text, string $source): ?array
    {
        $this->calls++;

        return $this->reply;
    }
}
