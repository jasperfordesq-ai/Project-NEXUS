<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Agreements and renewals: the platform team keeps a list of the agreements
 * the platform has with communities and others, and sees which renew soon.
 *
 *   GET  /v2/platform-team/agreements
 *   POST /v2/platform-team/agreements
 *   PUT  /v2/platform-team/agreements/{id}
 *   POST /v2/platform-team/agreements/{id}/end
 *
 * 🔴 Nothing is filled in that the platform team did not type. The contact's
 * name and email are kept on the row and never written to the activity log.
 */
class PlatformAgreementsTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/agreements';

    /** Made-up contact on the reserved test domain. */
    private const CONTACT_NAME = 'Morwenna Testcontact';
    private const CONTACT_EMAIL = 'morwenna.contact@example.test';

    private const ROW_KEYS = [
        'community', 'contact_email', 'contact_name', 'days_to_renewal', 'ends_on', 'id', 'is_ended',
        'notes', 'renews_on', 'renews_soon', 'starts_on', 'title', 'updated_at', 'with_whom',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        // The shared local test database may hold agreements from another run.
        DB::table('platform_agreements')->delete();
    }

    /** @param array<string, mixed> $over */
    private function agreement(array $over = []): int
    {
        return (int) DB::table('platform_agreements')->insertGetId(array_merge([
            'title' => 'Hosting agreement',
            'with_whom' => 'Riverside Timebank',
            'is_ended' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ], $over));
    }

    private function day(int $offset): string
    {
        return now()->startOfDay()->addDays($offset)->toDateString();
    }

    /** @return array<int, array<string, mixed>> keyed by id */
    private function rowsById(string $list = 'agreements'): array
    {
        $rows = [];
        foreach ($this->apiGet(self::URI)->assertStatus(200)->json("data.{$list}") as $row) {
            $rows[(int) $row['id']] = $row;
        }

        return $rows;
    }

    // ------------------------------------------------------------------
    // Who may
    // ------------------------------------------------------------------

    public function test_only_the_platform_team_may_read_the_list(): void
    {
        $this->assertPlatformTeamOnly('GET', self::URI);
    }

    public function test_nobody_below_the_platform_team_can_add_change_or_end_one_and_nothing_is_written(): void
    {
        $id = $this->agreement();

        $this->assertRefusedBelowPlatformTeam('POST', self::URI, ['title' => 'Refused agreement', 'with_whom' => 'Someone']);
        $this->assertRefusedBelowPlatformTeam('PUT', self::URI . "/{$id}", ['title' => 'Refused change']);
        $this->assertRefusedBelowPlatformTeam('POST', self::URI . "/{$id}/end");

        $row = DB::table('platform_agreements')->where('id', $id)->first();
        $this->assertSame('Hosting agreement', $row->title);
        $this->assertSame(0, (int) $row->is_ended);
        $this->assertSame(1, DB::table('platform_agreements')->count());
        $this->assertSame(0, DB::table('activity_log')->where('entity_type', 'platform_agreement')->where('entity_id', $id)->count());
    }

    // ------------------------------------------------------------------
    // What is sent
    // ------------------------------------------------------------------

    public function test_a_row_has_exactly_the_fields_the_page_shows(): void
    {
        $this->agreement([
            'community_id' => $this->testTenantId,
            'contact_name' => self::CONTACT_NAME,
            'contact_email' => self::CONTACT_EMAIL,
            'renews_on' => $this->day(30),
        ]);
        $this->actAsPlatformTeam();

        $data = $this->apiGet(self::URI)->assertStatus(200)->json('data');

        $top = array_keys($data);
        sort($top);
        $this->assertSame(['agreements', 'communities', 'ended', 'renewal_warning_days'], $top);
        $this->assertSame(60, $data['renewal_warning_days']);

        $keys = array_keys($data['agreements'][0]);
        sort($keys);
        $this->assertSame(self::ROW_KEYS, $keys, 'exactly what the page shows; anything else must not leave the server');
        $this->assertSame(['id', 'name'], array_keys($data['agreements'][0]['community']));
        $this->assertSame($this->testTenantId, $data['agreements'][0]['community']['id']);

        foreach ($data['communities'] as $community) {
            $this->assertSame(['id', 'name'], array_keys($community));
        }
        $this->assertContains($this->testTenantId, array_column($data['communities'], 'id'));
    }

    public function test_a_community_that_no_longer_exists_comes_back_with_its_id_and_no_name(): void
    {
        $this->agreement(['community_id' => 999999901]);
        $this->actAsPlatformTeam();

        $row = $this->apiGet(self::URI)->assertStatus(200)->json('data.agreements.0');

        $this->assertSame(['id' => 999999901, 'name' => null], $row['community']);
    }

    // ------------------------------------------------------------------
    // Adding one
    // ------------------------------------------------------------------

    public function test_an_agreement_with_only_the_two_required_fields_comes_back_with_everything_else_empty(): void
    {
        $this->actAsPlatformTeam();

        $row = $this->apiPost(self::URI, ['title' => 'Support agreement', 'with_whom' => 'Hilltop Council'])
            ->assertStatus(201)
            ->json('data.agreement');

        $this->assertSame('Support agreement', $row['title']);
        $this->assertSame('Hilltop Council', $row['with_whom']);
        foreach (['community', 'starts_on', 'renews_on', 'ends_on', 'contact_name', 'contact_email', 'notes', 'days_to_renewal'] as $field) {
            $this->assertNull($row[$field], "{$field} must stay empty when nobody typed it");
        }
        $this->assertFalse($row['is_ended']);
        $this->assertFalse($row['renews_soon']);

        $stored = DB::table('platform_agreements')->where('id', $row['id'])->first();
        foreach (['community_id', 'starts_on', 'renews_on', 'ends_on', 'contact_name', 'contact_email', 'notes'] as $column) {
            $this->assertNull($stored->{$column}, "{$column} must be stored empty");
        }
    }

    public function test_an_agreement_is_saved_as_typed_and_recorded_against_who_added_it(): void
    {
        $me = $this->actAsPlatformTeam();

        $row = $this->apiPost(self::URI, [
            'title' => 'Hosting agreement',
            'with_whom' => 'Riverside Timebank',
            'community_id' => $this->testTenantId,
            'starts_on' => '2026-01-01',
            'renews_on' => '2027-01-01',
            'ends_on' => '2028-12-31',
            'contact_name' => self::CONTACT_NAME,
            'contact_email' => self::CONTACT_EMAIL,
            'notes' => 'Signed copy kept by the owner.',
            'is_ended' => true,
            'created_by' => 1,
            'not_a_field' => 'ignored',
        ])->assertStatus(201)->json('data.agreement');

        $this->assertSame('2026-01-01', $row['starts_on']);
        $this->assertSame('2027-01-01', $row['renews_on']);
        $this->assertSame('2028-12-31', $row['ends_on']);
        $this->assertSame(self::CONTACT_NAME, $row['contact_name']);
        $this->assertSame(self::CONTACT_EMAIL, $row['contact_email']);
        $this->assertFalse($row['is_ended'], 'an agreement is ended only by the end action');

        $stored = DB::table('platform_agreements')->where('id', $row['id'])->first();
        $this->assertSame((int) $me->id, (int) $stored->created_by);
        $this->assertSame((int) $me->id, (int) $stored->updated_by);
        $this->assertSame(0, (int) $stored->is_ended);
    }

    /** @return array<string, array{0: array<string, mixed>, 1: string}> */
    public static function refusedAgreements(): array
    {
        $ok = ['title' => 'Hosting', 'with_whom' => 'Riverside'];

        return [
            'no title' => [['with_whom' => 'Riverside'], 'title'],
            'a blank title' => [['title' => '   ', 'with_whom' => 'Riverside'], 'title'],
            'a title too long' => [['title' => str_repeat('a', 161), 'with_whom' => 'Riverside'], 'title'],
            'no one it is with' => [['title' => 'Hosting'], 'with_whom'],
            'with whom too long' => [['title' => 'Hosting', 'with_whom' => str_repeat('a', 161)], 'with_whom'],
            'a start date that is not a date' => [$ok + ['starts_on' => 'next spring'], 'starts_on'],
            'a renewal date that does not exist' => [$ok + ['renews_on' => '2027-02-30'], 'renews_on'],
            'an end date in another format' => [$ok + ['ends_on' => '31/12/2027'], 'ends_on'],
            'an end before the start' => [$ok + ['starts_on' => '2027-01-02', 'ends_on' => '2027-01-01'], 'ends_on'],
            'a renewal before the start' => [$ok + ['starts_on' => '2027-01-02', 'renews_on' => '2027-01-01'], 'renews_on'],
            'an email that is not one' => [$ok + ['contact_email' => 'not-an-address'], 'contact_email'],
            'a contact name too long' => [$ok + ['contact_name' => str_repeat('a', 161)], 'contact_name'],
            'notes too long' => [$ok + ['notes' => str_repeat('a', 5001)], 'notes'],
            'a community that does not exist' => [$ok + ['community_id' => 999999901], 'community_id'],
            'a community id that is not a number' => [$ok + ['community_id' => 'riverside'], 'community_id'],
        ];
    }

    /**
     * @param array<string, mixed> $payload
     * @dataProvider refusedAgreements
     */
    public function test_an_agreement_that_breaks_a_rule_is_refused_and_not_saved(array $payload, string $field): void
    {
        $this->actAsPlatformTeam();

        $response = $this->apiPost(self::URI, $payload)->assertStatus(422);

        $errors = $response->json('errors');
        $this->assertContains($field, array_column($errors, 'field'));
        foreach ($errors as $error) {
            $this->assertStringNotContainsString('api.', (string) $error['message'], 'every refusal has wording');
        }
        $this->assertSame(0, DB::table('platform_agreements')->count());
    }

    public function test_an_end_on_the_same_day_as_the_start_is_allowed(): void
    {
        $this->actAsPlatformTeam();

        $this->apiPost(self::URI, [
            'title' => 'One day', 'with_whom' => 'Riverside', 'starts_on' => '2027-01-01', 'ends_on' => '2027-01-01', 'renews_on' => '2027-01-01',
        ])->assertStatus(201);
    }

    // ------------------------------------------------------------------
    // Changing and ending
    // ------------------------------------------------------------------

    public function test_an_agreement_can_be_changed_and_the_change_is_recorded(): void
    {
        $id = $this->agreement(['notes' => 'Keep me']);
        $me = $this->actAsPlatformTeam();

        $row = $this->apiPut(self::URI . "/{$id}", ['title' => 'Hosting agreement, renewed', 'renews_on' => '2028-01-01'])
            ->assertStatus(200)
            ->json('data.agreement');

        $this->assertSame('Hosting agreement, renewed', $row['title']);
        $this->assertSame('2028-01-01', $row['renews_on']);
        $this->assertSame('Keep me', $row['notes'], 'a field that was not sent is left alone');
        $this->assertSame((int) $me->id, (int) DB::table('platform_agreements')->where('id', $id)->value('updated_by'));
    }

    public function test_a_field_can_be_emptied_by_sending_it_empty(): void
    {
        $id = $this->agreement(['contact_email' => self::CONTACT_EMAIL, 'renews_on' => $this->day(10)]);
        $this->actAsPlatformTeam();

        $row = $this->apiPut(self::URI . "/{$id}", ['contact_email' => '', 'renews_on' => null])->assertStatus(200)->json('data.agreement');

        $this->assertNull($row['contact_email']);
        $this->assertNull($row['renews_on']);
        $this->assertNull($row['days_to_renewal']);
    }

    public function test_a_change_is_checked_against_the_dates_already_stored(): void
    {
        $id = $this->agreement(['starts_on' => '2027-06-01']);
        $this->actAsPlatformTeam();

        $response = $this->apiPut(self::URI . "/{$id}", ['ends_on' => '2027-05-01'])->assertStatus(422);

        $this->assertContains('ends_on', array_column($response->json('errors'), 'field'));
        $this->assertNull(DB::table('platform_agreements')->where('id', $id)->value('ends_on'));
    }

    public function test_ending_keeps_the_row_and_moves_it_to_the_ended_list(): void
    {
        $id = $this->agreement(['renews_on' => $this->day(5)]);
        $me = $this->actAsPlatformTeam();

        $row = $this->apiPost(self::URI . "/{$id}/end")->assertStatus(200)->json('data.agreement');

        $this->assertTrue($row['is_ended']);
        $this->assertFalse($row['renews_soon'], 'an ended agreement does not renew');
        $this->assertSame(1, (int) DB::table('platform_agreements')->where('id', $id)->value('is_ended'));
        $this->assertSame((int) $me->id, (int) DB::table('platform_agreements')->where('id', $id)->value('updated_by'));
        $this->assertArrayNotHasKey($id, $this->rowsById('agreements'));
        $this->assertArrayHasKey($id, $this->rowsById('ended'));
    }

    public function test_an_ended_agreement_can_be_changed_but_stays_ended(): void
    {
        $id = $this->agreement(['is_ended' => 1]);
        $this->actAsPlatformTeam();

        $this->apiPut(self::URI . "/{$id}", ['notes' => 'Ended by mistake? No: superseded.', 'is_ended' => false])->assertStatus(200);

        $row = DB::table('platform_agreements')->where('id', $id)->first();
        $this->assertSame(1, (int) $row->is_ended);
        $this->assertSame('Ended by mistake? No: superseded.', $row->notes);
    }

    public function test_ending_one_twice_writes_one_record(): void
    {
        $id = $this->agreement();
        $this->actAsPlatformTeam();

        $this->apiPost(self::URI . "/{$id}/end")->assertStatus(200);
        $this->apiPost(self::URI . "/{$id}/end")->assertStatus(200);

        $this->assertSame(1, DB::table('activity_log')->where('action', 'platform_agreement_ended')->where('entity_id', $id)->count());
    }

    public function test_changing_or_ending_one_that_does_not_exist_is_not_found(): void
    {
        $this->actAsPlatformTeam();

        $this->apiPut(self::URI . '/999999999', ['title' => 'x'])->assertStatus(404);
        $this->apiPost(self::URI . '/999999999/end')->assertStatus(404);
    }

    public function test_there_is_no_way_to_delete_one(): void
    {
        $id = $this->agreement();
        $this->actAsPlatformTeam();

        $status = $this->apiDelete(self::URI . "/{$id}")->getStatusCode();

        $this->assertContains($status, [404, 405]);
        $this->assertSame(1, DB::table('platform_agreements')->where('id', $id)->count());
    }

    // ------------------------------------------------------------------
    // The record of who did what
    // ------------------------------------------------------------------

    public function test_the_record_is_kept_under_no_community_and_holds_no_contact_details(): void
    {
        $me = $this->actAsPlatformTeam();

        $id = (int) $this->apiPost(self::URI, [
            'title' => 'Hosting agreement',
            'with_whom' => 'Riverside Timebank',
            'community_id' => $this->testTenantId,
            'contact_name' => self::CONTACT_NAME,
            'contact_email' => self::CONTACT_EMAIL,
        ])->assertStatus(201)->json('data.agreement.id');
        $this->apiPut(self::URI . "/{$id}", ['contact_name' => self::CONTACT_NAME . ' Junior'])->assertStatus(200);
        $this->apiPost(self::URI . "/{$id}/end")->assertStatus(200);

        $rows = DB::table('activity_log')
            ->where('user_id', $me->id)
            ->whereIn('action', ['platform_agreement_created', 'platform_agreement_changed', 'platform_agreement_ended'])
            ->get();

        $this->assertCount(3, $rows);
        foreach ($rows as $row) {
            $this->assertNull($row->tenant_id, "{$row->action} was filed under community {$row->tenant_id}");
            $this->assertSame('platform_agreement', $row->entity_type);
            $this->assertSame($id, (int) $row->entity_id);
            $whole = json_encode($row);
            $this->assertStringNotContainsString('Morwenna', (string) $whole);
            $this->assertStringNotContainsString('example.test', (string) $whole);
        }
    }

    /**
     * Review 16 Nov: a change could be saved with no record of who made it,
     * because a failed activity_log insert was swallowed. Now the change and
     * its record are one transaction: no record, no change, and a 500.
     */
    public function test_a_change_whose_record_cannot_be_written_is_not_saved(): void
    {
        $id = $this->agreement(['title' => 'Before']);
        $me = $this->actAsPlatformTeam();

        $broken = true;
        DB::connection()->beforeExecuting(static function (string $sql) use (&$broken): void {
            if ($broken && str_contains($sql, 'insert into `activity_log`')) {
                throw new \RuntimeException('planted: the record cannot be written');
            }
        });

        try {
            $add = $this->apiPost(self::URI, ['title' => 'Never saved', 'with_whom' => 'Riverside Timebank']);
            $change = $this->apiPut(self::URI . "/{$id}", ['title' => 'After']);
            $end = $this->apiPost(self::URI . "/{$id}/end");
        } finally {
            $broken = false;
        }

        foreach (['add' => $add, 'change' => $change, 'end' => $end] as $label => $response) {
            $response->assertStatus(500);
            $this->assertStringNotContainsString('planted', (string) $response->getContent(), $label);
        }
        $this->assertSame(0, DB::table('platform_agreements')->where('title', 'Never saved')->count(), 'nothing was added');
        $row = DB::table('platform_agreements')->where('id', $id)->first();
        $this->assertSame('Before', $row->title, 'the change was not saved');
        $this->assertSame(0, (int) $row->is_ended, 'the agreement was not ended');
        $this->assertNotSame((int) $me->id, (int) ($row->updated_by ?? 0));
    }

    public function test_adding_changing_and_ending_are_held_to_thirty_a_minute_for_each_caller(): void
    {
        $id = $this->agreement();
        $me = $this->actAsPlatformTeam();
        $key = "api:platform_team_agreements:user:{$me->id}";
        \Illuminate\Support\Facades\RateLimiter::clear($key);
        for ($i = 0; $i < 30; $i++) {
            \Illuminate\Support\Facades\RateLimiter::hit($key, 60);
        }
        $records = DB::table('activity_log')->where('entity_type', 'platform_agreement')->count();

        try {
            $this->apiPost(self::URI, ['title' => 'Throttled', 'with_whom' => 'Riverside Timebank'])->assertStatus(429);
            $this->apiPut(self::URI . "/{$id}", ['title' => 'Throttled'])->assertStatus(429);
            $this->apiPost(self::URI . "/{$id}/end")->assertStatus(429);
            // Reading is not held.
            $this->apiGet(self::URI)->assertStatus(200);
        } finally {
            \Illuminate\Support\Facades\RateLimiter::clear($key);
        }

        $this->assertSame(0, DB::table('platform_agreements')->where('title', 'Throttled')->count());
        $this->assertSame(0, (int) DB::table('platform_agreements')->where('id', $id)->value('is_ended'));
        $this->assertSame($records, DB::table('activity_log')->where('entity_type', 'platform_agreement')->count());
    }

    // ------------------------------------------------------------------
    // Order and renewal
    // ------------------------------------------------------------------

    public function test_the_list_is_in_order_of_the_next_renewal_with_no_date_last_then_by_title(): void
    {
        $noDateB = $this->agreement(['title' => 'B no date']);
        $noDateA = $this->agreement(['title' => 'A no date']);
        $later = $this->agreement(['title' => 'Later', 'renews_on' => $this->day(200)]);
        $soonZ = $this->agreement(['title' => 'Z soon', 'renews_on' => $this->day(10)]);
        $soonA = $this->agreement(['title' => 'A soon', 'renews_on' => $this->day(10)]);
        $passed = $this->agreement(['title' => 'Passed', 'renews_on' => $this->day(-3)]);
        $this->agreement(['title' => 'Ended', 'renews_on' => $this->day(1), 'is_ended' => 1]);
        $this->actAsPlatformTeam();

        $ids = array_map(static fn (array $r): int => (int) $r['id'], $this->apiGet(self::URI)->assertStatus(200)->json('data.agreements'));

        $this->assertSame([$passed, $soonA, $soonZ, $later, $noDateA, $noDateB], $ids);
    }

    /** @return array<string, array{0: int, 1: bool}> */
    public static function renewalDays(): array
    {
        return [
            '61 days away' => [61, false],
            '60 days away' => [60, true],
            'today' => [0, true],
            'passed 5 days ago' => [-5, true],
        ];
    }

    /** @dataProvider renewalDays */
    public function test_days_to_renewal_and_renews_soon(int $days, bool $soon): void
    {
        $id = $this->agreement(['renews_on' => $this->day($days)]);
        $this->actAsPlatformTeam();

        $row = $this->rowsById()[$id];

        $this->assertSame($days, $row['days_to_renewal']);
        $this->assertSame($soon, $row['renews_soon']);
    }

    // ------------------------------------------------------------------
    // The home page card
    // ------------------------------------------------------------------

    /** @return array{status: string, facts: array<string, mixed>} */
    private function card(): array
    {
        $card = collect($this->apiGet('/v2/platform-team/health')->assertStatus(200)->json('data.cards'))->firstWhere('key', 'agreements');
        $this->assertNotNull($card, 'the home page has an agreements card');
        $facts = [];
        foreach ($card['facts'] as $fact) {
            $facts[$fact['key']] = $fact['value'];
        }

        return ['status' => $card['status'], 'facts' => $facts];
    }

    public function test_the_card_is_fine_and_says_none_were_entered_when_there_are_none(): void
    {
        $this->actAsPlatformTeam();

        $card = $this->card();

        $this->assertSame('ok', $card['status']);
        $this->assertSame(0, $card['facts']['agreements_entered']);
    }

    public function test_the_card_is_fine_when_nothing_renews_within_60_days(): void
    {
        $this->agreement(['renews_on' => $this->day(61)]);
        $this->agreement();
        // An ended agreement does not renew.
        $this->agreement(['renews_on' => $this->day(3), 'is_ended' => 1]);
        $this->actAsPlatformTeam();

        $card = $this->card();

        $this->assertSame('ok', $card['status']);
        $this->assertSame(2, $card['facts']['agreements_entered']);
        $this->assertSame(0, $card['facts']['agreements_renewing_soon']);
    }

    /** @return array<string, array{0: int}> */
    public static function soonDays(): array
    {
        return ['within 60 days' => [60], 'already passed' => [-5]];
    }

    /** @dataProvider soonDays */
    public function test_the_card_needs_a_look_when_one_renews_soon_or_has_passed(int $days): void
    {
        $this->agreement(['renews_on' => $this->day($days)]);
        $this->agreement(['renews_on' => $this->day(120)]);
        $this->actAsPlatformTeam();

        $card = $this->card();

        $this->assertSame('warning', $card['status']);
        $this->assertSame(1, $card['facts']['agreements_renewing_soon']);
    }

    public function test_the_card_is_unknown_when_the_agreements_cannot_be_read(): void
    {
        $this->actAsPlatformTeam();
        $broken = true;
        DB::connection()->beforeExecuting(static function (string $sql) use (&$broken): void {
            if ($broken && str_contains($sql, 'from `platform_agreements`')) {
                throw new \RuntimeException('agreements table unreadable');
            }
        });

        try {
            $response = $this->apiGet('/v2/platform-team/health')->assertStatus(200);
        } finally {
            $broken = false;
        }
        $card = collect($response->json('data.cards'))->firstWhere('key', 'agreements');

        $this->assertSame('unknown', $card['status']);
        $this->assertSame([], $card['facts']);
        $this->assertStringNotContainsString('agreements table unreadable', (string) $response->getContent());
    }
}
