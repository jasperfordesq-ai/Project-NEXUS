<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Http\Middleware\RequireRecentSecondFactor;
use App\Models\User;
use App\Services\PlatformTeam\AccessReviewService;
use App\Services\TokenService;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Access review.
 *
 * Every so often the platform team goes through the list of senior accounts
 * and says, for each one, "keep" or "should be removed". The review is a
 * record. It changes nobody's access.
 *
 * What must hold: nobody below the platform team reads or writes it; a review
 * covers exactly the current senior list, once each, or nothing is written;
 * the record holds ids, never names or email addresses; the record can never
 * be changed or deleted afterwards, not even with database access; a review
 * is due when there has never been one or the last is more than 90 days old.
 */
class AccessReviewTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/access-review';

    /** Exactly what the page shows. Anything else must not leave the server. */
    private const TOP_KEYS = ['accounts', 'days_since_last', 'due', 'history', 'last_review', 'open_removals'];
    private const ACCOUNT_KEYS = ['community', 'id', 'last_sign_in_at', 'level', 'name', 'status', 'two_step_on'];
    private const REVIEW_KEYS = ['account_count', 'at', 'by_name', 'id', 'remove_count'];
    private const OPEN_REMOVAL_KEYS = ['community', 'id', 'level', 'name'];

    /** @param array<string, mixed> $attributes */
    private function account(array $attributes = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attributes));
    }

    private function reviews(): int
    {
        return DB::table('senior_access_reviews')->count();
    }

    private function items(): int
    {
        return DB::table('senior_access_review_items')->count();
    }

    /** @return array<string, mixed> */
    private function overview(): array
    {
        return $this->apiGet(self::URI)->assertStatus(200)->json('data');
    }

    /**
     * One decision for every account the page was shown, "keep" unless named.
     *
     * @param list<int> $remove
     * @return list<array{user_id: int, decision: string}>
     */
    private function decisionsFor(array $remove = []): array
    {
        $decisions = [];
        foreach ($this->overview()['accounts'] as $account) {
            $decisions[] = [
                'user_id' => (int) $account['id'],
                'decision' => in_array((int) $account['id'], $remove, true) ? 'remove' : 'keep',
            ];
        }

        return $decisions;
    }

    /** A review row written directly, as of some time ago. Rows cannot be changed after, so the date is set here. */
    private function pastReview(int $reviewerId, int $daysAgo): int
    {
        return (int) DB::table('senior_access_reviews')->insertGetId([
            'reviewed_by' => $reviewerId,
            'note' => null,
            'account_count' => 0,
            'remove_count' => 0,
            'created_at' => now()->subDays($daysAgo),
        ]);
    }

    /** @return array<string, string> */
    private function bearer(User $user, string $method, int $verifiedAt): array
    {
        return ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            (int) $user->id,
            (int) $user->tenant_id,
            ['mfa_method' => $method, 'mfa_verified_at' => $verifiedAt],
        )];
    }

    // ---------------------------------------------------------------- the lock

    public function test_only_the_platform_team_may_read_it(): void
    {
        $this->assertPlatformTeamOnly('GET', self::URI);
    }

    public function test_only_the_platform_team_may_record_a_review_and_a_refusal_writes_nothing(): void
    {
        $reviews = $this->reviews();
        $items = $this->items();

        $this->assertRefusedBelowPlatformTeam('POST', self::URI, ['decisions' => [['user_id' => 1, 'decision' => 'keep']]]);

        $this->assertSame($reviews, $this->reviews());
        $this->assertSame($items, $this->items());
    }

    public function test_an_account_below_the_platform_team_is_refused_by_the_lock_not_asked_for_a_code(): void
    {
        $notOnTeam = $this->account(['is_super_admin' => true, 'role' => 'super_admin']);
        $stale = $this->bearer($notOnTeam, 'totp', time() - 3600);
        $reviews = $this->reviews();

        $response = $this->apiPost(self::URI, ['decisions' => []], $stale);

        $response->assertStatus(403);
        $this->assertSame('forbidden', $response->json('errors.0.code'));
        $this->assertStringNotContainsString(RequireRecentSecondFactor::ERROR_CODE, (string) $response->getContent());
        $this->assertSame($reviews, $this->reviews());
    }

    public function test_the_route_that_records_a_review_carries_the_second_step_after_the_lock(): void
    {
        $route = collect(\Illuminate\Support\Facades\Route::getRoutes())->first(
            static fn ($r): bool => $r->uri() === 'api/v2/platform-team/access-review' && in_array('POST', $r->methods(), true)
        );
        $this->assertNotNull($route);
        $middleware = array_values(array_filter($route->gatherMiddleware(), 'is_string'));

        $this->assertSame(['auth:sanctum', 'platform-team', 'step-up'], array_values(array_intersect($middleware, ['auth:sanctum', 'platform-team', 'step-up'])));
    }

    public function test_recording_is_refused_when_the_second_step_is_not_recent(): void
    {
        $caller = $this->account(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $this->actAsPlatformTeam();
        $decisions = $this->decisionsFor();
        $reviews = $this->reviews();

        foreach ([['totp', time() - 3600], ['trusted_device', time() - 60]] as [$method, $at]) {
            $this->apiPost(self::URI, ['decisions' => $decisions], $this->bearer($caller, $method, $at))
                ->assertStatus(403)
                ->assertJsonPath('errors.0.code', RequireRecentSecondFactor::ERROR_CODE);
        }
        $this->assertSame($reviews, $this->reviews());
    }

    // ------------------------------------------------------------ what it says

    public function test_it_sends_exactly_what_the_page_shows(): void
    {
        $senior = $this->account(['role' => 'admin', 'is_tenant_super_admin' => true, 'first_name' => 'Senior', 'last_name' => 'Holder']);
        $this->actAsPlatformTeam();
        $this->apiPost(self::URI, ['decisions' => $this->decisionsFor([(int) $senior->id])])->assertStatus(200);

        $response = $this->apiGet(self::URI)->assertStatus(200);
        $data = $response->json('data');

        $keys = array_keys($data);
        sort($keys);
        $this->assertSame(self::TOP_KEYS, $keys);
        foreach ($data['accounts'] as $account) {
            $keys = array_keys($account);
            sort($keys);
            $this->assertSame(self::ACCOUNT_KEYS, $keys);
        }
        $keys = array_keys($data['last_review']);
        sort($keys);
        $this->assertSame(self::REVIEW_KEYS, $keys);
        foreach ($data['history'] as $review) {
            $keys = array_keys($review);
            sort($keys);
            $this->assertSame(self::REVIEW_KEYS, $keys);
        }
        $this->assertNotEmpty($data['open_removals']);
        foreach ($data['open_removals'] as $open) {
            $keys = array_keys($open);
            sort($keys);
            $this->assertSame(self::OPEN_REMOVAL_KEYS, $keys);
        }

        // No email address of any account rides along.
        $this->assertStringNotContainsString((string) $senior->email, (string) $response->getContent());
        $this->assertStringNotContainsString('"email"', (string) $response->getContent());
    }

    public function test_the_accounts_are_the_senior_accounts_list(): void
    {
        $this->account(['role' => 'admin', 'is_tenant_super_admin' => true]);
        $this->actAsPlatformTeam();

        $senior = array_column($this->apiGet('/v2/platform-team/senior-accounts')->assertStatus(200)->json('data.accounts'), 'level', 'id');
        $here = array_column($this->overview()['accounts'], 'level', 'id');

        $this->assertSame($senior, $here);
    }

    // ------------------------------------------------------------------ due

    public function test_a_review_is_due_when_there_has_never_been_one_and_not_right_after_one(): void
    {
        $this->actAsPlatformTeam();
        $this->assertSame(0, $this->reviews(), 'this test needs a database with no review in it');

        $before = $this->overview();
        $this->assertTrue($before['due']);
        $this->assertNull($before['days_since_last']);
        $this->assertNull($before['last_review']);
        $this->assertSame([], $before['history']);
        $this->assertSame([], $before['open_removals']);

        $this->apiPost(self::URI, ['decisions' => $this->decisionsFor()])->assertStatus(200);

        $after = $this->overview();
        $this->assertFalse($after['due']);
        $this->assertSame(0, $after['days_since_last']);
    }

    public function test_a_review_is_due_again_when_the_newest_is_more_than_ninety_days_old(): void
    {
        $me = $this->actAsPlatformTeam();

        $this->pastReview((int) $me->id, 89);
        $this->assertFalse($this->overview()['due']);
        $this->assertSame(89, $this->overview()['days_since_last']);

        // Only the newest counts: an older one changes nothing.
        $this->pastReview((int) $me->id, 400);
        $this->assertFalse($this->overview()['due']);
    }

    public function test_a_review_ninety_one_days_old_is_due(): void
    {
        $me = $this->actAsPlatformTeam();
        $this->pastReview((int) $me->id, 91);

        $data = $this->overview();
        $this->assertTrue($data['due']);
        $this->assertSame(91, $data['days_since_last']);
        $this->assertSame(AccessReviewService::DUE_AFTER_DAYS, 90);
    }

    // ------------------------------------------------------------- recording

    public function test_a_review_writes_one_record_and_one_line_per_senior_account(): void
    {
        $toRemove = $this->account(['role' => 'admin', 'is_tenant_super_admin' => true]);
        $me = $this->actAsPlatformTeam();
        $decisions = $this->decisionsFor([(int) $toRemove->id]);
        $lastReview = (int) DB::table('senior_access_reviews')->max('id');

        $response = $this->apiPost(self::URI, ['decisions' => $decisions, 'note' => '  Checked with the board.  ']);

        $response->assertStatus(200);
        // The reply is the page as it now stands.
        $keys = array_keys($response->json('data'));
        sort($keys);
        $this->assertSame(self::TOP_KEYS, $keys);
        $this->assertFalse($response->json('data.due'));

        $reviews = DB::table('senior_access_reviews')->where('id', '>', $lastReview)->get();
        $this->assertCount(1, $reviews);
        $review = $reviews[0];
        $this->assertSame((int) $me->id, (int) $review->reviewed_by);
        $this->assertSame('Checked with the board.', $review->note);
        $this->assertSame(count($decisions), (int) $review->account_count);
        $this->assertSame(1, (int) $review->remove_count);

        $items = DB::table('senior_access_review_items')->where('review_id', $review->id)->get();
        $this->assertCount(count($decisions), $items);
        $expected = array_column($decisions, 'user_id');
        sort($expected);
        $this->assertSame($expected, $items->pluck('user_id')->map(static fn ($id): int => (int) $id)->sort()->values()->all());
        $byUser = $items->keyBy('user_id');
        $this->assertSame('remove', $byUser[$toRemove->id]->decision);
        // Level and community come from the server's own list, not from the browser.
        $this->assertSame('tenant_super_admin', $byUser[$toRemove->id]->level);
        $this->assertSame($this->testTenantId, (int) $byUser[$toRemove->id]->community_id);
        $this->assertSame('keep', $byUser[$me->id]->decision);
        $this->assertSame('platform_team', $byUser[$me->id]->level);
        $this->assertSame(1, $items->where('decision', 'remove')->count());
    }

    public function test_recording_a_review_changes_nobodys_access(): void
    {
        $toRemove = $this->account(['role' => 'admin', 'is_tenant_super_admin' => true]);
        $this->actAsPlatformTeam();
        $before = DB::table('users')->where('id', $toRemove->id)->first(['role', 'is_tenant_super_admin', 'status', 'deleted_at']);

        $this->apiPost(self::URI, ['decisions' => $this->decisionsFor([(int) $toRemove->id])])->assertStatus(200);

        $after = DB::table('users')->where('id', $toRemove->id)->first(['role', 'is_tenant_super_admin', 'status', 'deleted_at']);
        $this->assertEquals($before, $after);
        $this->assertContains((int) $toRemove->id, array_column($this->overview()['accounts'], 'id'));
    }

    public function test_the_record_holds_no_name_and_no_email_address(): void
    {
        $columns = array_merge(
            Schema::getColumnListing('senior_access_reviews'),
            Schema::getColumnListing('senior_access_review_items'),
        );
        foreach ($columns as $column) {
            $this->assertStringNotContainsString('name', $column);
            $this->assertStringNotContainsString('email', $column);
        }
        $this->assertSame(
            ['account_count', 'created_at', 'id', 'note', 'remove_count', 'reviewed_by'],
            collect(Schema::getColumnListing('senior_access_reviews'))->sort()->values()->all(),
        );
        $this->assertSame(
            ['community_id', 'created_at', 'decision', 'id', 'level', 'review_id', 'user_id'],
            collect(Schema::getColumnListing('senior_access_review_items'))->sort()->values()->all(),
        );
    }

    public function test_names_are_read_now_not_stored_so_a_renamed_or_erased_reviewer_shows_as_they_are_now(): void
    {
        $me = $this->actAsPlatformTeam();
        DB::table('users')->where('id', $me->id)->update(['first_name' => 'First', 'last_name' => 'Reviewer', 'name' => 'First Reviewer']);
        $this->apiPost(self::URI, ['decisions' => $this->decisionsFor()])->assertStatus(200);
        $this->assertSame('First Reviewer', $this->overview()['last_review']['by_name']);

        DB::table('users')->where('id', $me->id)->update(['first_name' => 'Renamed', 'last_name' => 'Reviewer', 'name' => 'Renamed Reviewer']);
        $this->assertSame('Renamed Reviewer', $this->overview()['last_review']['by_name']);
        $this->assertSame('Renamed Reviewer', $this->overview()['history'][0]['by_name']);

        // An erased reviewer, and one whose account row is gone, have no name to show.
        $erased = $this->account(['first_name' => 'Erased', 'last_name' => 'Person']);
        DB::table('users')->where('id', $erased->id)->update(['anonymized_at' => now(), 'deleted_at' => now(), 'name' => 'Deleted User']);
        $this->pastReview((int) $erased->id, 0);
        $this->assertNull($this->overview()['history'][0]['by_name']);

        $this->pastReview((int) DB::table('users')->max('id') + 100000, 0);
        $response = $this->apiGet(self::URI)->assertStatus(200);
        $this->assertNull($response->json('data.history.0.by_name'));
        $this->assertStringNotContainsString('Erased Person', (string) $response->getContent());
        $this->assertStringNotContainsString('Deleted User', (string) $response->getContent());
    }

    public function test_the_history_is_the_last_ten_reviews_newest_first(): void
    {
        $me = $this->actAsPlatformTeam();
        for ($i = 12; $i >= 1; $i--) {
            $this->pastReview((int) $me->id, $i);
        }
        $newest = $this->pastReview((int) $me->id, 0);

        $history = $this->overview()['history'];

        $this->assertCount(10, $history);
        $this->assertSame($newest, $history[0]['id']);
        $times = array_map(static fn (array $r): int => (int) strtotime((string) $r['at']), $history);
        $sorted = $times;
        rsort($sorted);
        $this->assertSame($sorted, $times);
    }

    public function test_accounts_marked_for_removal_last_time_and_still_senior_are_listed(): void
    {
        $stillHere = $this->account(['role' => 'admin', 'is_tenant_super_admin' => true, 'first_name' => 'Still', 'last_name' => 'Here']);
        $removed = $this->account(['role' => 'admin', 'is_tenant_super_admin' => true]);
        $erased = $this->account(['role' => 'admin', 'is_tenant_super_admin' => true]);
        $this->actAsPlatformTeam();
        $this->apiPost(self::URI, ['decisions' => $this->decisionsFor([(int) $stillHere->id, (int) $removed->id, (int) $erased->id])])
            ->assertStatus(200);

        // Afterwards, by the proper means: one loses the access, one is erased.
        DB::table('users')->where('id', $removed->id)->update(['is_tenant_super_admin' => 0]);
        DB::table('users')->where('id', $erased->id)->update(['anonymized_at' => now(), 'deleted_at' => now()]);

        $open = $this->overview()['open_removals'];

        $this->assertSame([(int) $stillHere->id], array_column($open, 'id'));
        $this->assertSame('Still Here', $open[0]['name']);
        $this->assertSame('tenant_super_admin', $open[0]['level']);
        $this->assertSame($this->testTenantId, $open[0]['community']['id']);
    }

    public function test_only_the_newest_review_decides_what_is_still_open(): void
    {
        $account = $this->account(['role' => 'admin', 'is_tenant_super_admin' => true]);
        $this->actAsPlatformTeam();
        $this->apiPost(self::URI, ['decisions' => $this->decisionsFor([(int) $account->id])])->assertStatus(200);
        $this->assertSame([(int) $account->id], array_column($this->overview()['open_removals'], 'id'));

        $this->apiPost(self::URI, ['decisions' => $this->decisionsFor()])->assertStatus(200);
        $this->assertSame([], $this->overview()['open_removals']);
    }

    // ------------------------------------------------------------ refusals

    public function test_decisions_that_do_not_cover_exactly_the_current_list_are_refused_and_nothing_is_written(): void
    {
        $member = $this->account(['role' => 'member']);
        $this->account(['role' => 'admin', 'is_tenant_super_admin' => true]);
        $this->actAsPlatformTeam();
        $decisions = $this->decisionsFor();
        $this->assertGreaterThan(1, count($decisions));
        $reviews = $this->reviews();
        $items = $this->items();

        $missing = array_slice($decisions, 1);
        $unknown = array_merge($decisions, [['user_id' => (int) $member->id, 'decision' => 'keep']]);
        $swapped = array_merge(array_slice($decisions, 1), [['user_id' => (int) $member->id, 'decision' => 'keep']]);

        foreach (['missing an account' => $missing, 'an unknown account' => $unknown, 'one swapped for another' => $swapped] as $label => $body) {
            $response = $this->apiPost(self::URI, ['decisions' => $body]);
            $response->assertStatus(422);
            $this->assertSame('ACCESS_REVIEW_LIST_CHANGED', $response->json('errors.0.code'), $label);
            $this->assertSame(__('api.platform_access_review_list_changed'), $response->json('errors.0.message'), $label);
        }

        $this->assertSame($reviews, $this->reviews());
        $this->assertSame($items, $this->items());
    }

    public function test_malformed_decisions_and_a_long_note_are_refused_and_nothing_is_written(): void
    {
        $me = $this->actAsPlatformTeam();
        $decisions = $this->decisionsFor();
        $first = $decisions[0];
        $reviews = $this->reviews();
        $items = $this->items();

        $bad = [
            'no decisions' => [],
            'decisions not a list' => ['decisions' => 'keep everyone'],
            'a repeated account' => ['decisions' => array_merge($decisions, [$first])],
            'another decision value' => ['decisions' => array_merge([['user_id' => $first['user_id'], 'decision' => 'demote']], array_slice($decisions, 1))],
            'no decision value' => ['decisions' => array_merge([['user_id' => $first['user_id']]], array_slice($decisions, 1))],
            'a user id that is not a number' => ['decisions' => array_merge([['user_id' => 'abc', 'decision' => 'keep']], array_slice($decisions, 1))],
            'a decision that is not an object' => ['decisions' => array_merge(['keep'], array_slice($decisions, 1))],
        ];
        foreach ($bad as $label => $body) {
            $response = $this->apiPost(self::URI, $body);
            $response->assertStatus(422);
            $this->assertSame('decisions', $response->json('errors.0.field'), $label);
        }

        foreach ([str_repeat('x', 501), ['an', 'array']] as $note) {
            $response = $this->apiPost(self::URI, ['decisions' => $decisions, 'note' => $note]);
            $response->assertStatus(422);
            $this->assertSame('note', $response->json('errors.0.field'));
        }

        $this->assertSame($reviews, $this->reviews());
        $this->assertSame($items, $this->items());

        // The edge is allowed, and an empty note is no note. (Nine refusals
        // used most of the ten-a-minute allowance; start it again.)
        RateLimiter::clear("api:platform_team_access_review:user:{$me->id}");
        $this->apiPost(self::URI, ['decisions' => $decisions, 'note' => str_repeat('é', 500)])->assertStatus(200);
        $this->apiPost(self::URI, ['decisions' => $decisions, 'note' => '   '])->assertStatus(200);
        $this->assertNull(DB::table('senior_access_reviews')->orderByDesc('id')->value('note'));
    }

    /** The record and its lines stand or fall together. */
    public function test_when_a_line_cannot_be_written_no_review_is_recorded(): void
    {
        $me = $this->actAsPlatformTeam();
        $decisions = $this->decisionsFor();
        $reviews = $this->reviews();
        $items = $this->items();

        $broken = true;
        DB::connection()->beforeExecuting(static function (string $sql) use (&$broken): void {
            if ($broken && str_contains($sql, 'insert into `senior_access_review_items`')) {
                throw new \RuntimeException('planted: a line cannot be written');
            }
        });

        try {
            $response = $this->apiPost(self::URI, ['decisions' => $decisions]);
        } finally {
            $broken = false;
        }

        $response->assertStatus(500);
        $this->assertStringNotContainsString('planted', (string) $response->getContent());
        $this->assertSame($reviews, $this->reviews());
        $this->assertSame($items, $this->items());
        $this->assertSame(0, DB::table('senior_access_reviews')->where('reviewed_by', $me->id)->count());
    }

    // ------------------------------------------------------- append-only

    public function test_the_database_refuses_to_change_or_delete_a_review_or_a_line(): void
    {
        $this->actAsPlatformTeam();
        $this->apiPost(self::URI, ['decisions' => $this->decisionsFor()])->assertStatus(200);
        $reviewId = (int) DB::table('senior_access_reviews')->max('id');
        $itemId = (int) DB::table('senior_access_review_items')->where('review_id', $reviewId)->min('id');

        $attempts = [
            'change a review' => static fn () => DB::table('senior_access_reviews')->where('id', $reviewId)->update(['remove_count' => 99]),
            'delete a review' => static fn () => DB::table('senior_access_reviews')->where('id', $reviewId)->delete(),
            'change a line' => static fn () => DB::table('senior_access_review_items')->where('id', $itemId)->update(['decision' => 'remove']),
            'delete a line' => static fn () => DB::table('senior_access_review_items')->where('id', $itemId)->delete(),
        ];

        foreach ($attempts as $label => $attempt) {
            try {
                $attempt();
                $this->fail("the database let me {$label}");
            } catch (QueryException $e) {
                $this->assertStringContainsString('senior_access_review_immutable', $e->getMessage(), $label);
            }
        }

        $this->assertSame(1, DB::table('senior_access_reviews')->where('id', $reviewId)->count());
        $this->assertSame(1, DB::table('senior_access_review_items')->where('id', $itemId)->count());
    }

    // ------------------------------------------------------- the note can be erased

    /**
     * Review 16 Nov: the note is free text in a table that refuses every
     * change, so it could never be erased. The database now allows exactly one
     * change: setting the note to NULL with every other column unchanged.
     */
    public function test_the_note_can_be_cleared_and_nothing_else_about_the_review_changes(): void
    {
        $this->actAsPlatformTeam();
        $this->apiPost(self::URI, ['decisions' => $this->decisionsFor(), 'note' => 'A note to erase later.'])->assertStatus(200);
        $reviewId = (int) DB::table('senior_access_reviews')->max('id');
        $before = (array) DB::table('senior_access_reviews')->where('id', $reviewId)->first();
        $this->assertSame('A note to erase later.', $before['note']);

        $this->assertTrue((new AccessReviewService())->clearNote($reviewId));

        $after = (array) DB::table('senior_access_reviews')->where('id', $reviewId)->first();
        $this->assertNull($after['note']);
        unset($before['note'], $after['note']);
        $this->assertSame($before, $after, 'only the note changed');

        // Clearing an already-cleared note is fine; a review that is not there is not.
        $this->assertTrue((new AccessReviewService())->clearNote($reviewId));
        $this->assertFalse((new AccessReviewService())->clearNote($reviewId + 100000));
    }

    public function test_the_database_refuses_any_other_change_to_a_review_even_beside_clearing_the_note(): void
    {
        $this->actAsPlatformTeam();
        $this->apiPost(self::URI, ['decisions' => $this->decisionsFor(), 'note' => 'Original note.'])->assertStatus(200);
        $reviewId = (int) DB::table('senior_access_reviews')->max('id');

        $attempts = [
            'change the note to other text' => ['note' => 'Rewritten note.'],
            'change who reviewed' => ['reviewed_by' => 1],
            'change the count' => ['account_count' => 999],
            'change the removals' => ['remove_count' => 99],
            'change the date' => ['created_at' => now()->subYear()],
            'clear the note and change the removals' => ['note' => null, 'remove_count' => 99],
            'clear the note and change the date' => ['note' => null, 'created_at' => now()->subYear()],
        ];

        foreach ($attempts as $label => $change) {
            try {
                DB::table('senior_access_reviews')->where('id', $reviewId)->update($change);
                $this->fail("the database let me {$label}");
            } catch (QueryException $e) {
                $this->assertStringContainsString('senior_access_review_immutable', $e->getMessage(), $label);
            }
        }

        $this->assertSame('Original note.', DB::table('senior_access_reviews')->where('id', $reviewId)->value('note'));

        try {
            DB::table('senior_access_reviews')->where('id', $reviewId)->delete();
            $this->fail('the database let me delete a review');
        } catch (QueryException $e) {
            $this->assertStringContainsString('senior_access_review_immutable', $e->getMessage());
        }
    }

    // ------------------------------------------------------- logging

    /** A database error can quote the values of the failed statement, the note among them. */
    public function test_a_failed_review_logs_the_kind_of_error_only_never_the_note(): void
    {
        $this->actAsPlatformTeam();
        $decisions = $this->decisionsFor();
        $planted = 'PLANTED-REVIEW-NOTE-5521';

        $lines = [];
        \Illuminate\Support\Facades\Event::listen(\Illuminate\Log\Events\MessageLogged::class, function ($e) use (&$lines): void {
            $lines[] = $e->message . ' ' . json_encode($e->context);
        });
        $broken = true;
        DB::connection()->beforeExecuting(static function (string $sql, array $bindings) use (&$broken): void {
            if ($broken && str_contains($sql, 'insert into `senior_access_reviews`')) {
                // As the database would: the message quotes the statement's values.
                throw new QueryException('mysql', $sql, $bindings, new \RuntimeException('planted'));
            }
        });

        try {
            $this->apiPost(self::URI, ['decisions' => $decisions, 'note' => $planted])->assertStatus(500);
        } finally {
            $broken = false;
        }

        $this->assertNotEmpty($lines, 'the failure was logged');
        foreach ($lines as $line) {
            $this->assertStringNotContainsString($planted, $line);
        }
    }
}
