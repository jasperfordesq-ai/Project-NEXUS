<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Matching;

use App\Models\Listing;
use App\Models\User;
use App\Services\Matching\UnmetNeedsService;
use App\Services\SmartMatchingEngine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The coordinator's "Unmet needs" page (20 Nov 2026): requests that have
 * waited two weeks with nobody taking them up. The list is worked out from
 * the platform's own records and needs no AI; the AI summary on top of it
 * is asked for by a coordinator pressing a button, and is faked here.
 */
class UnmetNeedsTest extends TestCase
{
    use DatabaseTransactions;

    private const OTHER_TENANT_ID = 999;
    private const URL = '/v2/admin/matching/unmet-needs';

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    private function aiSwitch(bool $on): void
    {
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'ai_enabled'],
            ['setting_value' => $on ? 'true' : 'false', 'updated_at' => now()]
        );
        app(SmartMatchingEngine::class)->clearCache();
    }

    private function member(array $attrs = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active', 'is_approved' => 1, 'last_active_at' => now(),
        ], $attrs));
    }

    private function broker(): User
    {
        return $this->member(['role' => 'broker']);
    }

    private function request(string $title, int $daysOld = 20, array $attrs = []): Listing
    {
        $listing = Listing::factory()->forTenant($attrs['tenant_id'] ?? $this->testTenantId)->create(array_merge([
            'user_id' => $this->member(['first_name' => 'Zebediah', 'last_name' => 'Quillfeather'])->id,
            'type' => 'request', 'status' => 'active', 'moderation_status' => 'approved',
            'title' => $title, 'description' => 'Some help would be welcome.', 'expires_at' => null,
            'created_at' => now()->subDays($daysOld),
        ], $attrs));
        Cache::flush();

        return $listing;
    }

    private function shownTo(Listing $listing, string $status = 'new'): void
    {
        DB::table('match_cache')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $this->member()->id, 'listing_id' => $listing->id,
            'match_score' => 60, 'match_type' => 'one_way', 'match_reasons' => '[]', 'status' => $status,
            'created_at' => now(), 'expires_at' => now()->addDays(7),
        ]);
    }

    /** @return array<int, array<string, mixed>> the page's rows whose title starts "Zzyx", by title */
    private function rows(): array
    {
        $data = $this->apiGet(self::URL)->assertStatus(200)->json('data');
        $rows = [];
        foreach ($data['items'] as $item) {
            if (str_starts_with((string) $item['title'], 'Zzyx')) {
                $rows[$item['title']] = $item;
            }
        }

        return $rows;
    }

    public function test_a_request_nobody_has_taken_up_in_two_weeks_is_listed_and_the_rest_are_not(): void
    {
        $waiting = $this->request('Zzyx waiting, nobody matched');
        $shown = $this->request('Zzyx waiting, shown to two members');
        $this->shownTo($shown);
        $this->shownTo($shown);
        $this->shownTo($shown, 'dismissed'); // a member who hid it is not counted

        $this->request('Zzyx posted last week', 5);
        $this->request('Zzyx paused', 20, ['status' => 'paused']);
        $this->request('Zzyx past its end date', 20, ['expires_at' => now()->subDay()]);
        $this->request('Zzyx an offer, not a need', 20, ['type' => 'offer']);

        $taken = $this->request('Zzyx someone offered to help');
        DB::table('exchange_requests')->insert([
            'tenant_id' => $this->testTenantId, 'listing_id' => $taken->id, 'requester_id' => $this->member()->id,
            'provider_id' => $taken->user_id, 'proposed_hours' => 1, 'status' => 'pending_provider', 'created_at' => now(),
        ]);
        $fellThrough = $this->request('Zzyx an offer of help that was cancelled');
        DB::table('exchange_requests')->insert([
            'tenant_id' => $this->testTenantId, 'listing_id' => $fellThrough->id, 'requester_id' => $this->member()->id,
            'provider_id' => $fellThrough->user_id, 'proposed_hours' => 1, 'status' => 'cancelled', 'created_at' => now(),
        ]);
        $messaged = $this->request('Zzyx someone wrote about it');
        DB::table('messages')->insert([
            'tenant_id' => $this->testTenantId, 'sender_id' => $this->member()->id, 'receiver_id' => $messaged->user_id,
            'listing_id' => $messaged->id, 'body' => 'I can help with this.', 'created_at' => now(),
        ]);

        $elsewhere = User::factory()->forTenant(self::OTHER_TENANT_ID)->create(['status' => 'active']);
        $this->request('Zzyx another community', 20, ['tenant_id' => self::OTHER_TENANT_ID, 'user_id' => $elsewhere->id]);

        Sanctum::actingAs($this->broker());
        $rows = $this->rows();

        $this->assertSame(
            ['Zzyx an offer of help that was cancelled', 'Zzyx waiting, nobody matched', 'Zzyx waiting, shown to two members'],
            collect(array_keys($rows))->sort()->values()->all()
        );
        $this->assertSame(0, $rows['Zzyx waiting, nobody matched']['matched_members']);
        $this->assertSame(2, $rows['Zzyx waiting, shown to two members']['matched_members']);
        $this->assertSame($waiting->id, $rows['Zzyx waiting, nobody matched']['id']);
        $this->assertGreaterThanOrEqual(19, $rows['Zzyx waiting, nobody matched']['days_waiting']);
        $this->assertSame('Zebediah Quillfeather', $rows['Zzyx waiting, nobody matched']['requester_name']);
    }

    public function test_requests_nobody_was_matched_with_come_first_and_the_totals_add_up(): void
    {
        $this->shownTo($this->request('Zzyx shown to someone', 40));
        $this->request('Zzyx matched with nobody', 20);
        Sanctum::actingAs($this->broker());

        $data = $this->apiGet(self::URL)->assertStatus(200)->json('data');

        $titles = array_values(array_filter(array_column($data['items'], 'title'), fn ($title) => str_starts_with($title, 'Zzyx')));
        $this->assertSame(['Zzyx matched with nobody', 'Zzyx shown to someone'], $titles);
        $this->assertSame(14, $data['waiting_days']);
        $this->assertSame($data['summary']['total'], $data['summary']['no_match'] + $data['summary']['no_response']);
        $this->assertGreaterThanOrEqual(1, $data['summary']['no_match']);
        $this->assertGreaterThanOrEqual(1, $data['summary']['no_response']);
    }

    public function test_it_is_for_coordinators_and_admins_only(): void
    {
        $this->apiGet(self::URL)->assertStatus(401);

        Sanctum::actingAs($this->member());
        $this->apiGet(self::URL)->assertStatus(403);
        $this->apiPost(self::URL . '/summary')->assertStatus(403);

        Sanctum::actingAs($this->broker());
        $this->apiGet(self::URL)->assertStatus(200);

        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
        $this->apiGet(self::URL)->assertStatus(200);
    }

    public function test_the_page_works_with_ai_off_and_then_offers_no_ai_summary(): void
    {
        $this->aiSwitch(false);
        $this->request('Zzyx waiting, nobody matched');
        $fake = $this->useAi(['summary' => 'x', 'themes' => []]);
        Sanctum::actingAs($this->broker());

        $data = $this->apiGet(self::URL)->assertStatus(200)->json('data');
        $this->assertFalse($data['ai_available']);
        $this->assertNotEmpty($data['items'], 'The list itself never needs AI');

        $this->apiPost(self::URL . '/summary')->assertStatus(409);
        $this->assertSame(0, $fake->calls);
    }

    public function test_the_ai_summary_is_asked_for_once_cleaned_and_told_nothing_about_who_asked(): void
    {
        $this->aiSwitch(true);
        $this->request('Zzyx lift to hospital appointments');
        $this->request('Zzyx help getting to the shops');
        $fake = $this->useAi([
            'summary' => '<b>Most</b> of what is waiting is about getting around.' . str_repeat(' More.', 400),
            'themes' => [
                ['need' => 'Transport', 'requests' => 2, 'suggestion' => 'Ask members who drive.'],
                ['need' => '', 'requests' => 1, 'suggestion' => 'An empty theme is dropped.'],
                'not a theme',
            ],
        ]);
        Sanctum::actingAs($this->broker());
        $this->assertTrue($this->apiGet(self::URL)->json('data.ai_available'));

        $first = $this->apiPost(self::URL . '/summary')->assertStatus(200)->json('data');
        $second = $this->apiPost(self::URL . '/summary')->assertStatus(200)->json('data');

        $this->assertSame(1, $fake->calls, 'A second press within the day is answered from what is already held');
        $this->assertSame($first, $second);
        $this->assertStringStartsWith('Most of what is waiting is about getting around.', $first['summary']);
        $this->assertLessThanOrEqual(UnmetNeedsService::MAX_SUMMARY_CHARS, mb_strlen($first['summary']));
        $this->assertSame([['need' => 'Transport', 'requests' => 2, 'suggestion' => 'Ask members who drive.']], $first['themes']);

        $sent = json_encode($fake->lastItems);
        $this->assertStringContainsString('Zzyx lift to hospital appointments', (string) $sent);
        $this->assertStringNotContainsString('Zebediah', (string) $sent);
        $this->assertStringNotContainsString('Quillfeather', (string) $sent);
    }

    public function test_a_failed_ai_request_says_so_and_the_list_is_unaffected(): void
    {
        $this->aiSwitch(true);
        $this->request('Zzyx waiting, nobody matched');
        $this->useAi(null);
        Sanctum::actingAs($this->broker());

        $this->apiPost(self::URL . '/summary')->assertStatus(503);
        $this->assertNotEmpty($this->apiGet(self::URL)->assertStatus(200)->json('data.items'));
    }

    private function useAi(?array $reply): FakeUnmetNeedsService
    {
        $fake = new FakeUnmetNeedsService();
        $fake->reply = $reply;
        app()->instance(UnmetNeedsService::class, $fake);

        return $fake;
    }
}

class FakeUnmetNeedsService extends UnmetNeedsService
{
    /** @var array<string, mixed>|null null = the provider failed */
    public ?array $reply = null;
    public int $calls = 0;
    /** @var array<int, array<string, mixed>> */
    public array $lastItems = [];

    protected function ask(array $items, string $language): ?array
    {
        $this->calls++;
        $this->lastItems = $items;

        return $this->reply;
    }
}
