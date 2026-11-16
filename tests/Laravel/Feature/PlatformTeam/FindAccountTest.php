<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Http\Middleware\RequireRecentSecondFactor;
use App\Models\User;
use App\Services\PlatformTeam\FindAccountService;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Find an account, and sign it out everywhere.
 *
 * Two requests. One looks an account up by its exact email address, in every
 * community. The other ends every sign-in of one account, and needs a second
 * sign-in step entered recently.
 *
 * What must hold: nobody below the platform team gets either; the address
 * searched for is never written down; an act on a member is recorded in that
 * member's own community; a manager's stand-in and an erased account are
 * never found and cannot be acted on.
 */
class FindAccountTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const FIND = '/v2/platform-team/accounts/find';

    private const LOOKUP_ACTION = 'platform_team_account_lookup';
    private const SIGN_OUT_ACTION = 'platform_team_signed_out_everywhere';

    private const REASON = 'Phone reported stolen by the member';

    /** Exactly what the page shows. Anything else must not leave the server. */
    private const MATCH_KEYS = [
        'community', 'has_passkey', 'id', 'last_sign_in_at', 'level', 'name',
        'role', 'signed_in_now', 'status', 'two_step_on',
    ];

    private static function signOutUri(int $id): string
    {
        return "/v2/platform-team/accounts/{$id}/sign-out";
    }

    private function address(string $label = 'find'): string
    {
        return $label . '-' . Str::lower(Str::random(12)) . '@find-account.test';
    }

    /** @param array<string, mixed> $attributes */
    private function account(array $attributes = [], ?int $tenantId = null): User
    {
        return User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attributes));
    }

    private function community(): int
    {
        $suffix = Str::lower(Str::random(10));

        return (int) DB::table('tenants')->insertGetId([
            'name' => 'Find Account Test ' . $suffix,
            'slug' => 'find-account-' . $suffix,
            'is_active' => 1,
        ]);
    }

    /** A manager's stand-in: a row no request can create, so it is written directly. */
    private function standIn(string $email): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Manager Stand In',
            'email' => $email,
            'password_hash' => null,
            'role' => 'admin',
            'status' => 'delegate',
            'is_approved' => 1,
            'preferred_language' => 'en',
            'onboarding_completed' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** One live sign-in (or a dead one) for an account. Returns its family. */
    private function signIn(User|int $account, array $over = [], ?string $family = null, ?int $tenantId = null): string
    {
        $userId = $account instanceof User ? (int) $account->id : $account;
        $tenantId ??= $account instanceof User ? (int) $account->tenant_id : $this->testTenantId;
        $family ??= hash('sha256', 'family-' . Str::random(20));
        DB::table('refresh_token_sessions')->insert(array_merge([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'family_hash' => $family,
            'jti_hash' => hash('sha256', 'jti-' . Str::random(20)),
            'parent_jti_hash' => null,
            'issued_at' => now(),
            'expires_at' => now()->addDay(),
            'family_expires_at' => now()->addDays(30),
            'created_at' => now(),
            'updated_at' => now(),
        ], $over));

        return $family;
    }

    private function liveSignIns(int $userId): int
    {
        return DB::table('refresh_token_sessions')->where('user_id', $userId)->whereNull('revoked_at')->count();
    }

    private function cutoffExists(int $userId): bool
    {
        return DB::table('revoked_tokens')->where('jti', 'global_revoke_' . $userId)->exists();
    }

    private function lookupsRecorded(): int
    {
        return DB::table('activity_log')->where('action', self::LOOKUP_ACTION)->count();
    }

    private function signOutsRecorded(?int $targetId = null): int
    {
        return DB::table('org_audit_log')
            ->where('action', self::SIGN_OUT_ACTION)
            ->when($targetId !== null, static fn ($q) => $q->where('target_user_id', $targetId))
            ->count();
    }

    /**
     * A real access token, so the second sign-in step is judged on the token's
     * own claims (a test actor signed in the short way is handed a fresh one).
     *
     * @return array<string, string>
     */
    private function bearer(User $user, string $method, int $verifiedAt): array
    {
        return ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            (int) $user->id,
            (int) $user->tenant_id,
            ['mfa_method' => $method, 'mfa_verified_at' => $verifiedAt],
        )];
    }

    private function platformTeamAccount(): User
    {
        return $this->account(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
    }

    /** @return array<int, array<string, mixed>> */
    private function found(string $email): array
    {
        return $this->apiPost(self::FIND, ['email' => $email])->assertStatus(200)->json('data.matches');
    }

    // ---------------------------------------------------------------- the lock

    public function test_only_the_platform_team_may_look_an_account_up(): void
    {
        $email = $this->address();
        $this->account(['email' => $email]);
        $before = $this->lookupsRecorded();

        $this->assertRefusedBelowPlatformTeam('POST', self::FIND, ['email' => $email]);
        // A refused search is not a search: nothing was looked up, nothing is recorded.
        $this->assertSame($before, $this->lookupsRecorded());

        $this->actAsPlatformTeam();
        $this->apiPost(self::FIND, ['email' => $email])->assertStatus(200);
        $this->assertSame($before + 1, $this->lookupsRecorded());
    }

    public function test_only_the_platform_team_may_sign_an_account_out(): void
    {
        $target = $this->account();
        $this->signIn($target);

        $this->assertRefusedBelowPlatformTeam('POST', self::signOutUri((int) $target->id), ['reason' => self::REASON]);

        $this->assertSame(1, $this->liveSignIns((int) $target->id), 'a refused request must not end a sign-in');
        $this->assertFalse($this->cutoffExists((int) $target->id));
        $this->assertSame(0, $this->signOutsRecorded((int) $target->id));
    }

    /**
     * The lock is asked before the second sign-in step. Otherwise an account
     * with no right to be here would be asked for a code, and would learn that
     * the request exists.
     */
    public function test_an_account_below_the_platform_team_is_refused_by_the_lock_not_asked_for_a_code(): void
    {
        $target = $this->account();
        $this->signIn($target);
        $globalNotOnTeam = $this->account(['is_super_admin' => true, 'role' => 'super_admin']);
        // Its code is an hour old: the second-step check would refuse it too.
        $stale = $this->bearer($globalNotOnTeam, 'totp', time() - 3600);

        $response = $this->apiPost(self::signOutUri((int) $target->id), ['reason' => self::REASON], $stale);

        $response->assertStatus(403);
        $this->assertSame('forbidden', $response->json('errors.0.code'));
        $this->assertStringNotContainsString(RequireRecentSecondFactor::ERROR_CODE, (string) $response->getContent());
        $this->assertSame(1, $this->liveSignIns((int) $target->id));
    }

    public function test_the_route_that_signs_an_account_out_carries_the_second_step_after_the_lock(): void
    {
        $route = collect(\Illuminate\Support\Facades\Route::getRoutes())->first(
            static fn ($r): bool => $r->uri() === 'api/v2/platform-team/accounts/{id}/sign-out' && in_array('POST', $r->methods(), true)
        );
        $this->assertNotNull($route);
        $middleware = array_values(array_filter($route->gatherMiddleware(), 'is_string'));

        $lock = array_search('platform-team', $middleware, true);
        $step = array_search('step-up', $middleware, true);
        $this->assertNotFalse($lock, 'the route must be inside the platform-team group');
        $this->assertNotFalse($step, 'the route must ask for a recent second step');
        $this->assertLessThan($step, $lock, 'the lock must be asked before the second step');
    }

    public function test_neither_request_answers_a_get(): void
    {
        $this->actAsPlatformTeam();

        // The address goes in the body, never in the web address.
        $this->assertContains($this->apiGet(self::FIND . '?email=someone@example.test')->getStatusCode(), [404, 405]);
        $this->assertContains($this->apiGet(self::signOutUri(1))->getStatusCode(), [404, 405]);
    }

    // -------------------------------------------------------------- the search

    public function test_a_match_carries_only_what_the_page_shows(): void
    {
        $email = $this->address();
        $account = $this->account(['email' => $email, 'first_name' => 'Found', 'last_name' => 'Person']);
        $this->actAsPlatformTeam();

        $response = $this->apiPost(self::FIND, ['email' => $email])->assertStatus(200);
        $data = $response->json('data');

        $keys = array_keys($data);
        sort($keys);
        $this->assertSame(['matches', 'truncated'], $keys);
        $this->assertFalse($data['truncated']);
        $this->assertCount(1, $data['matches']);

        $match = $data['matches'][0];
        $keys = array_keys($match);
        sort($keys);
        $this->assertSame(self::MATCH_KEYS, $keys);
        $communityKeys = array_keys($match['community']);
        sort($communityKeys);
        $this->assertSame(['id', 'name', 'slug'], $communityKeys);

        $this->assertSame((int) $account->id, $match['id']);
        $this->assertSame('Found Person', $match['name']);
        $this->assertSame($this->testTenantId, $match['community']['id']);
        $this->assertSame($this->testTenantSlug, $match['community']['slug']);
        $this->assertSame('active', $match['status']);
        $this->assertSame('member', $match['role']);
        $this->assertNull($match['level']);

        // The answer does not say the address back, and no secret rides along.
        $body = strtolower((string) $response->getContent());
        $this->assertStringNotContainsString(strtolower($email), $body);
        foreach (['email', 'password', 'totp_secret', 'remember_token', 'recovery', 'public_key', 'credential_id', 'family_hash'] as $needle) {
            $this->assertStringNotContainsString($needle, $body, $needle);
        }
    }

    public function test_an_address_that_differs_only_by_case_or_outer_spaces_still_matches(): void
    {
        $email = $this->address('case');
        $account = $this->account(['email' => $email]);
        $this->actAsPlatformTeam();

        $this->assertSame([(int) $account->id], array_column($this->found(strtoupper($email)), 'id'));
        $this->assertSame([(int) $account->id], array_column($this->found('  ' . ucfirst($email) . ' '), 'id'));
    }

    public function test_only_the_whole_address_matches_and_the_search_never_uses_like(): void
    {
        $email = $this->address('whole');
        $this->account(['email' => $email]);
        [$local, $domain] = explode('@', $email);
        $this->actAsPlatformTeam();

        // A piece of the address, and the characters a pattern search would obey.
        foreach ([substr($local, 0, -1) . '@' . $domain, substr($local, 0, -2) . '%@' . $domain, substr($local, 0, -1) . '_@' . $domain, '%@' . $domain, $local . '@%'] as $partial) {
            $this->assertSame([], $this->found($partial), $partial);
        }

        $queries = [];
        DB::listen(static function ($query) use (&$queries): void {
            $queries[] = strtolower($query->sql);
        });
        $this->found($email);

        $onUsers = array_values(array_filter($queries, static fn (string $sql): bool => str_contains($sql, '`users` as `u`')));
        $this->assertNotEmpty($onUsers, 'the search query was not seen');
        foreach ($onUsers as $sql) {
            $this->assertStringContainsString('`u`.`email` = ?', $sql);
        }
        foreach ($queries as $sql) {
            $this->assertStringNotContainsString(' like ', $sql, $sql);
        }
    }

    public function test_the_same_address_is_found_in_every_community_that_has_it(): void
    {
        $email = $this->address('two');
        $other = $this->community();
        $here = $this->account(['email' => $email]);
        $there = $this->account(['email' => $email], $other);
        $this->actAsPlatformTeam();

        $matches = $this->found($email);

        $byId = array_column($matches, null, 'id');
        $this->assertCount(2, $matches);
        $this->assertSame($this->testTenantId, $byId[(int) $here->id]['community']['id']);
        $this->assertSame($other, $byId[(int) $there->id]['community']['id']);
        $this->assertStringStartsWith('Find Account Test ', (string) $byId[(int) $there->id]['community']['name']);
    }

    public function test_a_managers_stand_in_and_an_erased_account_are_never_found(): void
    {
        $standInEmail = $this->address('standin');
        $this->standIn($standInEmail);
        $erasedEmail = $this->address('erased');
        $erased = $this->account(['email' => $erasedEmail]);
        DB::table('users')->where('id', $erased->id)->update(['anonymized_at' => now(), 'deleted_at' => now(), 'status' => 'inactive']);
        $this->actAsPlatformTeam();

        $this->assertSame([], $this->found($standInEmail));
        $this->assertSame([], $this->found($erasedEmail));
    }

    public function test_a_deleted_account_that_was_not_erased_is_shown_as_deleted(): void
    {
        $email = $this->address('deleted');
        $account = $this->account(['email' => $email]);
        DB::table('users')->where('id', $account->id)->update(['deleted_at' => now()]);
        $noStatus = $this->address('nostatus');
        $blank = $this->account(['email' => $noStatus]);
        DB::table('users')->where('id', $blank->id)->update(['status' => null]);
        $this->actAsPlatformTeam();

        $this->assertSame('deleted', $this->found($email)[0]['status']);
        // `users.status` may be NULL; that is an ordinary account, not a stand-in.
        $this->assertSame('active', $this->found($noStatus)[0]['status']);
    }

    /** One rule for the level names: the Senior accounts page's. */
    public function test_the_level_is_named_as_the_senior_accounts_page_names_it(): void
    {
        $accounts = [
            'global' => $this->account(['email' => $this->address('lvl'), 'is_super_admin' => true, 'role' => 'super_admin']),
            'by_role' => $this->account(['email' => $this->address('lvl'), 'role' => 'super_admin']),
            'tenant_super' => $this->account(['email' => $this->address('lvl'), 'role' => 'admin', 'is_tenant_super_admin' => true]),
            'flag_only' => $this->account(['email' => $this->address('lvl'), 'is_god' => true]),
            'team' => $this->account(['email' => $this->address('lvl'), 'is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']),
            'admin' => $this->account(['email' => $this->address('lvl'), 'role' => 'admin']),
            'member' => $this->account(['email' => $this->address('lvl'), 'role' => 'member']),
        ];
        $this->actAsPlatformTeam();

        $senior = [];
        foreach ($this->apiGet('/v2/platform-team/senior-accounts')->assertStatus(200)->json('data.accounts') as $row) {
            $senior[(int) $row['id']] = $row['level'];
        }

        foreach ($accounts as $label => $account) {
            $match = $this->found((string) $account->email)[0];
            $this->assertSame($senior[(int) $account->id] ?? null, $match['level'], $label);
        }
        $this->assertSame('platform_team', $this->found((string) $accounts['team']->email)[0]['level']);
        $this->assertNull($this->found((string) $accounts['admin']->email)[0]['level']);
    }

    public function test_it_says_two_step_passkey_last_sign_in_and_how_many_sign_ins_are_live(): void
    {
        $email = $this->address('facts');
        $account = $this->account(['email' => $email]);
        DB::table('users')->where('id', $account->id)->update(['totp_enabled' => 1, 'last_login_at' => '2026-11-01 09:30:00']);
        DB::table('webauthn_credentials')->insert([
            'user_id' => $account->id,
            'tenant_id' => $this->testTenantId,
            'credential_id' => 'find-account-test-' . $account->id,
            'public_key' => 'not-a-real-key',
            'user_handle' => 'find-account-test-' . $account->id,
        ]);
        // Two live sign-ins. The first has renewed once: two rows, one sign-in.
        $family = $this->signIn($account, ['consumed_at' => now()]);
        $this->signIn($account, [], $family);
        $this->signIn($account);
        // Not live: ended, and run out.
        $this->signIn($account, ['revoked_at' => now(), 'revocation_reason' => 'user_logout']);
        $this->signIn($account, ['family_expires_at' => now()->subMinute(), 'expires_at' => now()->subMinute()]);

        $plainEmail = $this->address('plain');
        $plain = $this->account(['email' => $plainEmail]);
        DB::table('users')->where('id', $plain->id)->update(['totp_enabled' => 0, 'last_login_at' => null]);
        $this->actAsPlatformTeam();

        $match = $this->found($email)[0];
        $this->assertTrue($match['two_step_on']);
        $this->assertTrue($match['has_passkey']);
        $this->assertSame(2, $match['signed_in_now']);
        $this->assertStringStartsWith('2026-11-01T09:30:00', (string) $match['last_sign_in_at']);

        $match = $this->found($plainEmail)[0];
        $this->assertFalse($match['two_step_on']);
        $this->assertFalse($match['has_passkey']);
        $this->assertSame(0, $match['signed_in_now']);
        $this->assertNull($match['last_sign_in_at']);
    }

    public function test_no_match_is_a_normal_answer(): void
    {
        $this->actAsPlatformTeam();

        $data = $this->apiPost(self::FIND, ['email' => $this->address('nobody')])->assertStatus(200)->json('data');

        $this->assertSame([], $data['matches']);
        $this->assertFalse($data['truncated']);
    }

    public function test_each_search_is_recorded_without_the_address_searched_for(): void
    {
        $email = $this->address('recorded');
        $account = $this->account(['email' => $email]);
        $me = $this->actAsPlatformTeam();
        $lastId = (int) DB::table('activity_log')->max('id');

        $this->found(strtoupper($email));
        $this->found($this->address('nobody-recorded'));

        $rows = DB::table('activity_log')->where('id', '>', $lastId)->where('action', self::LOOKUP_ACTION)->orderBy('id')->get();
        $this->assertCount(2, $rows);

        $found = $rows[0];
        // No community: the search covered all of them, and the caller's is not where it happened.
        $this->assertNull($found->tenant_id);
        $this->assertSame((int) $me->id, (int) $found->user_id);
        $this->assertSame(['matches' => 1, 'user_ids' => [(int) $account->id]], json_decode((string) $found->details, true));
        $this->assertSame(0, (int) $found->is_public);

        $this->assertNull($rows[1]->tenant_id);
        $this->assertSame(['matches' => 0, 'user_ids' => []], json_decode((string) $rows[1]->details, true));

        // 🔴 The address is not in the record, in any column, in any spelling.
        [$local, $domain] = explode('@', $email);
        foreach ($rows as $row) {
            $whole = strtolower((string) json_encode($row));
            foreach ([strtolower($email), strtolower($local), strtolower($domain), 'nobody-recorded'] as $needle) {
                $this->assertStringNotContainsString($needle, $whole, $needle);
            }
        }
    }

    public function test_a_search_needs_one_whole_address(): void
    {
        $this->actAsPlatformTeam();
        $before = $this->lookupsRecorded();

        foreach ([[], ['email' => ''], ['email' => '   '], ['email' => 'not an address'], ['email' => 'two@at@signs'], ['email' => ['a@b.test']], ['email' => str_repeat('a', 250) . '@find-account.test']] as $body) {
            $response = $this->apiPost(self::FIND, $body);
            $response->assertStatus(422);
            $this->assertSame('email', $response->json('errors.0.field'), (string) json_encode($body));
        }
        $this->assertSame($before, $this->lookupsRecorded());
    }

    public function test_searching_is_held_to_thirty_a_minute_for_each_caller(): void
    {
        $me = $this->actAsPlatformTeam();
        $key = "api:platform_team_account_lookup:user:{$me->id}";
        RateLimiter::clear($key);
        for ($i = 0; $i < FindAccountService::LOOKUPS_PER_MINUTE; $i++) {
            RateLimiter::hit($key, 60);
        }
        $before = $this->lookupsRecorded();

        try {
            $this->apiPost(self::FIND, ['email' => $this->address('throttled')])->assertStatus(429);
            $this->assertSame($before, $this->lookupsRecorded());
        } finally {
            RateLimiter::clear($key);
        }
        $this->assertSame(30, FindAccountService::LOOKUPS_PER_MINUTE);
    }

    // ------------------------------------------------- sign out everywhere

    public function test_signing_out_is_refused_when_the_second_step_is_not_recent(): void
    {
        $target = $this->account();
        $this->signIn($target);
        $caller = $this->platformTeamAccount();

        foreach ([['totp', time() - 3600], ['trusted_device', time() - 60]] as [$method, $at]) {
            $response = $this->apiPost(self::signOutUri((int) $target->id), ['reason' => self::REASON], $this->bearer($caller, $method, $at));

            $response->assertStatus(403)->assertJsonPath('errors.0.code', RequireRecentSecondFactor::ERROR_CODE);
        }
        $this->assertSame(1, $this->liveSignIns((int) $target->id));
        $this->assertFalse($this->cutoffExists((int) $target->id));
        $this->assertSame(0, $this->signOutsRecorded((int) $target->id));
    }

    public function test_with_a_recent_second_step_it_ends_every_sign_in_and_records_it_in_the_targets_community(): void
    {
        $other = $this->community();
        $target = $this->account(['email' => $this->address('target')], $other);
        $family = $this->signIn($target, ['consumed_at' => now()]);
        $this->signIn($target, [], $family);
        $this->signIn($target);
        DB::table('fcm_device_tokens')->insert([
            'user_id' => $target->id,
            'tenant_id' => $other,
            'token' => 'find-account-test-' . Str::random(24),
            'platform' => 'android',
        ]);
        $bystander = $this->account([], $other);
        $this->signIn($bystander);
        $caller = $this->platformTeamAccount();
        $this->assertNotSame($other, (int) $caller->tenant_id);

        $response = $this->apiPost(
            self::signOutUri((int) $target->id),
            ['reason' => '  ' . self::REASON . '  '],
            $this->bearer($caller, 'totp', time() - 60) + ['User-Agent' => 'FindAccountTestBrowser/9.9'],
        );

        $response->assertStatus(200);
        $this->assertSame(['signed_out' => true], $response->json('data'));

        // Every sign-in of the target is ended, and marked as the platform team's doing.
        $this->assertSame(0, $this->liveSignIns((int) $target->id));
        $this->assertSame(
            ['platform_team'],
            DB::table('refresh_token_sessions')->where('user_id', $target->id)->distinct()->pluck('revocation_reason')->all(),
        );
        // Access tokens already handed out stop working too.
        $this->assertTrue($this->cutoffExists((int) $target->id));
        // Notifications to their phone stop.
        $this->assertSame(0, DB::table('fcm_device_tokens')->where('user_id', $target->id)->count());
        // Nobody else is touched.
        $this->assertSame(1, $this->liveSignIns((int) $bystander->id));
        $this->assertFalse($this->cutoffExists((int) $bystander->id));
        $this->assertFalse($this->cutoffExists((int) $caller->id));

        // 🔴 Recorded once, in the TARGET's community, not the caller's.
        $rows = DB::table('org_audit_log')->where('action', self::SIGN_OUT_ACTION)->where('target_user_id', $target->id)->get();
        $this->assertCount(1, $rows);
        $this->assertSame($other, (int) $rows[0]->tenant_id);
        $this->assertSame((int) $caller->id, (int) $rows[0]->user_id);
        $this->assertSame(['reason' => self::REASON], json_decode((string) $rows[0]->details, true));
        // That community's admins can read this row. It does not hand them the
        // platform team's internet address or browser.
        $this->assertNull($rows[0]->ip_address);
        $this->assertNull($rows[0]->user_agent);
        $this->assertSame(
            0,
            DB::table('org_audit_log')->where('action', self::SIGN_OUT_ACTION)->where('tenant_id', $caller->tenant_id)->where('target_user_id', $target->id)->count(),
        );
        // The account itself is unchanged: this is not a ban and not a password reset.
        $after = DB::table('users')->where('id', $target->id)->first(['status', 'role', 'password_hash', 'email']);
        $this->assertSame('active', $after->status);
        $this->assertSame('member', $after->role);
        $this->assertSame($target->password_hash, $after->password_hash);
        $this->assertSame($target->email, $after->email);
    }

    public function test_a_confirmation_from_a_fresh_code_also_unlocks_it(): void
    {
        $target = $this->account();
        $this->signIn($target);
        $caller = $this->platformTeamAccount();
        $headers = $this->bearer($caller, 'trusted_device', time() - 86400) + [
            'X-Security-Confirmation' => app(TokenService::class)->generateSecurityConfirmationToken((int) $caller->id, (int) $caller->tenant_id, 'totp'),
        ];

        $this->apiPost(self::signOutUri((int) $target->id), ['reason' => self::REASON], $headers)->assertStatus(200);

        $this->assertSame(0, $this->liveSignIns((int) $target->id));
        $this->assertSame(1, $this->signOutsRecorded((int) $target->id));
    }

    public function test_an_account_that_is_not_there_a_stand_in_and_an_erased_account_cannot_be_signed_out(): void
    {
        $standIn = $this->standIn($this->address('standin'));
        $erased = $this->account();
        $this->signIn($erased);
        DB::table('users')->where('id', $erased->id)->update(['anonymized_at' => now(), 'deleted_at' => now(), 'status' => 'inactive']);
        $missing = (int) DB::table('users')->max('id') + 100000;
        $this->actAsPlatformTeam();

        foreach (['stand-in' => $standIn, 'erased' => (int) $erased->id, 'missing' => $missing] as $label => $id) {
            $this->apiPost(self::signOutUri($id), ['reason' => self::REASON])->assertStatus(404);
            $this->assertFalse($this->cutoffExists($id), $label);
            $this->assertSame(0, $this->signOutsRecorded($id), $label);
        }
        $this->assertSame(1, $this->liveSignIns((int) $erased->id));
    }

    public function test_a_deleted_account_that_was_not_erased_can_still_be_signed_out(): void
    {
        $target = $this->account();
        $this->signIn($target);
        DB::table('users')->where('id', $target->id)->update(['deleted_at' => now()]);
        $this->actAsPlatformTeam();

        $this->apiPost(self::signOutUri((int) $target->id), ['reason' => self::REASON])->assertStatus(200);

        $this->assertSame(0, $this->liveSignIns((int) $target->id));
    }

    public function test_a_reason_of_five_to_two_hundred_characters_is_required(): void
    {
        $target = $this->account();
        $this->signIn($target);
        $this->actAsPlatformTeam();
        $uri = self::signOutUri((int) $target->id);

        foreach ([[], ['reason' => ''], ['reason' => 'abcd'], ['reason' => '  ab  '], ['reason' => str_repeat('x', 201)], ['reason' => ['an', 'array']]] as $body) {
            $response = $this->apiPost($uri, $body);
            $response->assertStatus(422);
            $this->assertSame('reason', $response->json('errors.0.field'), (string) json_encode($body));
        }
        $this->assertSame(1, $this->liveSignIns((int) $target->id));
        $this->assertFalse($this->cutoffExists((int) $target->id));
        $this->assertSame(0, $this->signOutsRecorded((int) $target->id));

        // The edges are allowed.
        $this->apiPost($uri, ['reason' => 'abcde'])->assertStatus(200);
        $this->apiPost($uri, ['reason' => str_repeat('é', 200)])->assertStatus(200);
        $this->assertSame(2, $this->signOutsRecorded((int) $target->id));
    }

    public function test_the_platform_team_may_sign_out_its_own_account(): void
    {
        $me = $this->actAsPlatformTeam();
        $this->signIn($me);

        $this->apiPost(self::signOutUri((int) $me->id), ['reason' => self::REASON])->assertStatus(200);

        $this->assertSame(0, $this->liveSignIns((int) $me->id));
        $this->assertTrue($this->cutoffExists((int) $me->id));
        $this->assertSame(1, $this->signOutsRecorded((int) $me->id));
    }

    /** The act shows on the Security page (who, whom, where, when), and its reason does not. */
    public function test_a_sign_out_is_listed_on_the_security_page_without_its_reason(): void
    {
        $other = $this->community();
        $target = $this->account(['first_name' => 'Listed', 'last_name' => 'Target'], $other);
        $me = $this->actAsPlatformTeam();
        DB::table('users')->where('id', $me->id)->update(['first_name' => 'Listing', 'last_name' => 'Actor', 'name' => 'Listing Actor']);

        $this->apiPost(self::signOutUri((int) $target->id), ['reason' => 'a-reason-that-must-stay-in-the-record'])->assertStatus(200);
        $response = $this->apiGet('/v2/platform-team/security')->assertStatus(200);

        $mine = array_values(array_filter(
            $response->json('data.sign_outs.items'),
            static fn (array $item): bool => $item['account'] === 'Listed Target',
        ));
        $this->assertCount(1, $mine);
        $this->assertSame('Listing Actor', $mine[0]['by']);
        $this->assertStringStartsWith('Find Account Test ', (string) $mine[0]['community']);
        $this->assertStringNotContainsString('a-reason-that-must-stay-in-the-record', (string) $response->getContent());
    }

    /** An act that cannot be recorded is not done: the two stand or fall together. */
    public function test_when_the_record_cannot_be_written_nobody_is_signed_out(): void
    {
        $target = $this->account();
        $this->signIn($target);
        $me = $this->actAsPlatformTeam();

        $broken = true;
        DB::connection()->beforeExecuting(static function (string $sql) use (&$broken): void {
            if ($broken && str_contains($sql, 'insert into `org_audit_log`')) {
                throw new \RuntimeException('planted: the record cannot be written');
            }
        });

        try {
            $result = (new FindAccountService())->signOut((int) $me->id, (int) $target->id, self::REASON);
        } finally {
            $broken = false;
        }

        $this->assertSame(FindAccountService::FAILED, $result);
        $this->assertSame(1, $this->liveSignIns((int) $target->id));
        $this->assertFalse($this->cutoffExists((int) $target->id));
        $this->assertSame(0, $this->signOutsRecorded((int) $target->id));
    }

    /** The same for a search: an answer that could not be recorded is not given. */
    public function test_when_a_search_cannot_be_recorded_it_gives_no_answer(): void
    {
        $email = $this->address('unrecorded');
        $this->account(['email' => $email, 'first_name' => 'Unrecorded', 'last_name' => 'Person']);
        $this->actAsPlatformTeam();

        $broken = true;
        DB::connection()->beforeExecuting(static function (string $sql) use (&$broken): void {
            if ($broken && str_contains($sql, 'insert into `activity_log`')) {
                throw new \RuntimeException('planted: the record cannot be written');
            }
        });

        try {
            $response = $this->apiPost(self::FIND, ['email' => $email]);
        } finally {
            $broken = false;
        }

        $response->assertStatus(500);
        $this->assertStringNotContainsString('Unrecorded Person', (string) $response->getContent());
        $this->assertStringNotContainsString('planted', (string) $response->getContent());
    }
}
