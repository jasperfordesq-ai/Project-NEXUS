<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Http\Middleware\RequireRecentSecondFactor;
use App\Models\User;
use App\Services\PlatformTeam\PlatformTeamMembershipService;
use App\Services\TokenService;
use App\Support\Authorization\PlatformTeam;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Senior accounts: adding an account to the platform
 * team, and removing one from it (owner, 17 Nov 2026).
 *
 * Until this, `users.is_god` could only be set in the database and no record
 * was kept. These two requests are the only web requests that write it.
 *
 * What must hold:
 *   - platform team only, and the lock is asked before the second sign-in step;
 *   - a recent second sign-in step from the caller;
 *   - the account being added is active and has two-step sign-in on;
 *   - nobody removes themselves, so the team is never left empty;
 *   - every change is written to the super admin audit log, by name.
 */
class PlatformTeamMembershipTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const SECURITY = '/v2/platform-team/security';

    private static function addUri(int $id): string
    {
        return "/v2/platform-team/senior-accounts/{$id}/add-to-team";
    }

    private static function removeUri(int $id): string
    {
        return "/v2/platform-team/senior-accounts/{$id}/remove-from-team";
    }

    /**
     * An account with two-step sign-in on, unless told otherwise.
     *
     * @param array<string, mixed> $attributes
     */
    private function account(array $attributes = [], bool $twoStep = true): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attributes));
        // Written straight to the column: the model does not let it be mass-assigned.
        DB::table('users')->where('id', $user->id)->update(['totp_enabled' => $twoStep ? 1 : 0]);

        return $user;
    }

    /** @return array{is_god: int, is_super_admin: int, role: string} */
    private function flags(int $userId): array
    {
        $row = DB::table('users')->where('id', $userId)->first(['is_god', 'is_super_admin', 'role']);
        $this->assertNotNull($row);

        return [
            'is_god' => (int) $row->is_god,
            'is_super_admin' => (int) $row->is_super_admin,
            'role' => (string) $row->role,
        ];
    }

    /** @return list<object> the audit rows about one account, oldest first */
    private function recorded(int $targetId, ?string $actionType = null): array
    {
        return DB::table('super_admin_audit_log')
            ->where('target_type', 'user')
            ->where('target_id', $targetId)
            ->when($actionType !== null, static fn ($q) => $q->where('action_type', $actionType))
            ->orderBy('id')
            ->get()
            ->all();
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

    // ---------------------------------------------------------------- the locks

    public function test_only_the_platform_team_may_add_an_account(): void
    {
        $target = $this->account(['is_super_admin' => true, 'role' => 'super_admin']);

        $this->assertRefusedBelowPlatformTeam('POST', self::addUri((int) $target->id));

        $this->assertSame(0, $this->flags((int) $target->id)['is_god'], 'a refused request must change nothing');
        $this->assertCount(0, $this->recorded((int) $target->id));
    }

    public function test_only_the_platform_team_may_remove_an_account(): void
    {
        $target = $this->account(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);

        $this->assertRefusedBelowPlatformTeam('POST', self::removeUri((int) $target->id));

        $this->assertSame(1, $this->flags((int) $target->id)['is_god'], 'a refused request must change nothing');
        $this->assertCount(0, $this->recorded((int) $target->id));
    }

    /**
     * The lock is asked before the second sign-in step. Otherwise an account
     * with no right to be here would be asked for a code, and would learn that
     * the request exists.
     */
    public function test_an_account_below_the_platform_team_is_refused_by_the_lock_not_asked_for_a_code(): void
    {
        $target = $this->account(['is_super_admin' => true, 'role' => 'super_admin']);
        $globalNotOnTeam = $this->account(['is_super_admin' => true, 'role' => 'super_admin']);
        // Its code is an hour old: the second-step check would refuse it too.
        $stale = $this->bearer($globalNotOnTeam, 'totp', time() - 3600);

        foreach ([self::addUri((int) $target->id), self::removeUri((int) $target->id)] as $uri) {
            $response = $this->apiPost($uri, [], $stale);

            $response->assertStatus(403);
            $this->assertStringNotContainsString(RequireRecentSecondFactor::ERROR_CODE, (string) $response->getContent(), $uri);
        }
        $this->assertSame(0, $this->flags((int) $target->id)['is_god']);
    }

    public function test_both_routes_carry_the_second_step_after_the_lock(): void
    {
        foreach (['add-to-team', 'remove-from-team'] as $act) {
            $route = collect(Route::getRoutes())->first(
                static fn ($r): bool => $r->uri() === "api/v2/platform-team/senior-accounts/{id}/{$act}" && in_array('POST', $r->methods(), true)
            );
            $this->assertNotNull($route, $act);
            $middleware = array_values(array_filter($route->gatherMiddleware(), 'is_string'));

            $lock = array_search('platform-team', $middleware, true);
            $step = array_search('step-up', $middleware, true);
            $this->assertNotFalse($lock, "{$act}: the route must be inside the platform-team group");
            $this->assertNotFalse($step, "{$act}: the route must ask for a recent second step");
            $this->assertLessThan($step, $lock, "{$act}: the lock must be asked before the second step");
        }
    }

    public function test_both_are_refused_when_the_callers_second_step_is_not_recent(): void
    {
        $toAdd = $this->account(['is_super_admin' => true, 'role' => 'super_admin']);
        $toRemove = $this->account(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $caller = $this->account(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);

        foreach ([['totp', time() - 3600], ['trusted_device', time() - 60]] as [$method, $at]) {
            foreach ([self::addUri((int) $toAdd->id), self::removeUri((int) $toRemove->id)] as $uri) {
                $this->apiPost($uri, [], $this->bearer($caller, $method, $at))
                    ->assertStatus(403)
                    ->assertJsonPath('errors.0.code', RequireRecentSecondFactor::ERROR_CODE);
            }
        }

        $this->assertSame(0, $this->flags((int) $toAdd->id)['is_god']);
        $this->assertSame(1, $this->flags((int) $toRemove->id)['is_god']);
        $this->assertCount(0, $this->recorded((int) $toAdd->id));
        $this->assertCount(0, $this->recorded((int) $toRemove->id));
    }

    public function test_neither_request_answers_a_get(): void
    {
        $target = $this->account(['is_super_admin' => true, 'role' => 'super_admin']);
        $this->actAsPlatformTeam();

        foreach ([self::addUri((int) $target->id), self::removeUri((int) $target->id)] as $uri) {
            $this->assertContains($this->apiGet($uri)->getStatusCode(), [404, 405], $uri);
        }
        $this->assertSame(0, $this->flags((int) $target->id)['is_god']);
    }

    // --------------------------------------------------------------------- add

    public function test_adding_a_global_super_admin_puts_it_on_the_team_and_records_it(): void
    {
        $target = $this->account(['is_super_admin' => true, 'role' => 'super_admin']);
        $me = $this->actAsPlatformTeam();
        $this->assertFalse(PlatformTeam::includes((int) $target->id));

        $response = $this->apiPost(self::addUri((int) $target->id));

        $response->assertStatus(200);
        $this->assertSame(['added' => true, 'user_id' => (int) $target->id], $response->json('data'));
        $this->assertTrue(PlatformTeam::includes((int) $target->id));
        $this->assertSame(['is_god' => 1, 'is_super_admin' => 1, 'role' => 'super_admin'], $this->flags((int) $target->id));

        $rows = $this->recorded((int) $target->id);
        $this->assertCount(1, $rows, 'it was already a global super admin: one change, one record');
        $this->assertSame('platform_team_added', $rows[0]->action_type);
        $this->assertSame((int) $me->id, (int) $rows[0]->actor_user_id);
        $this->assertSame(['is_god' => 0], json_decode((string) $rows[0]->old_values, true));
        $this->assertSame(['is_god' => 1], json_decode((string) $rows[0]->new_values, true));
    }

    /**
     * Both steps in one go. F-431 still holds: the flags are written and the
     * role is left alone, so taking the access away again leaves no admin role
     * behind.
     */
    public function test_adding_an_account_that_is_not_a_global_super_admin_does_both_steps_and_records_both(): void
    {
        $target = $this->account(['role' => 'member']);
        $me = $this->actAsPlatformTeam();

        $this->apiPost(self::addUri((int) $target->id))->assertStatus(200);

        $this->assertSame(['is_god' => 1, 'is_super_admin' => 1, 'role' => 'member'], $this->flags((int) $target->id));
        $this->assertTrue(PlatformTeam::includes((int) $target->id));

        $global = $this->recorded((int) $target->id, 'global_super_admin_granted');
        $team = $this->recorded((int) $target->id, 'platform_team_added');
        $this->assertCount(1, $global);
        $this->assertCount(1, $team);
        $this->assertSame((int) $me->id, (int) $global[0]->actor_user_id);
        $this->assertSame((int) $me->id, (int) $team[0]->actor_user_id);
        $this->assertSame(['is_super_admin' => 1], json_decode((string) $global[0]->new_values, true));
    }

    /** A global super admin by the old role string alone: the team flag is all it needs. */
    public function test_adding_an_account_that_is_global_by_role_only_leaves_the_super_admin_flag_alone(): void
    {
        $target = $this->account(['role' => 'super_admin']);
        $this->actAsPlatformTeam();

        $this->apiPost(self::addUri((int) $target->id))->assertStatus(200);

        $this->assertSame(['is_god' => 1, 'is_super_admin' => 0, 'role' => 'super_admin'], $this->flags((int) $target->id));
        $this->assertTrue(PlatformTeam::includes((int) $target->id));
        $this->assertCount(0, $this->recorded((int) $target->id, 'global_super_admin_granted'));
        $this->assertCount(1, $this->recorded((int) $target->id, 'platform_team_added'));
    }

    /** The half-set account (flag, no super admin) is finished, not refused. */
    public function test_adding_an_account_that_only_has_the_flag_finishes_it(): void
    {
        $target = $this->account(['is_god' => true]);
        $this->actAsPlatformTeam();
        $this->assertFalse(PlatformTeam::includes((int) $target->id));

        $this->apiPost(self::addUri((int) $target->id))->assertStatus(200);

        $this->assertTrue(PlatformTeam::includes((int) $target->id));
        $this->assertCount(1, $this->recorded((int) $target->id, 'global_super_admin_granted'));
    }

    public function test_an_account_without_two_step_sign_in_is_not_added(): void
    {
        $target = $this->account(['is_super_admin' => true, 'role' => 'super_admin'], twoStep: false);
        $this->actAsPlatformTeam();

        $response = $this->apiPost(self::addUri((int) $target->id));

        $response->assertStatus(422)->assertJsonPath('errors.0.code', PlatformTeamMembershipService::TWO_STEP_REQUIRED);
        $this->assertSame(0, $this->flags((int) $target->id)['is_god']);
        $this->assertCount(0, $this->recorded((int) $target->id));
    }

    public function test_an_account_that_is_not_active_is_not_added(): void
    {
        $this->actAsPlatformTeam();

        foreach (['suspended', 'banned', 'pending', 'inactive'] as $status) {
            $target = $this->account(['role' => 'admin', 'status' => $status]);

            $response = $this->apiPost(self::addUri((int) $target->id));

            $response->assertStatus(422)->assertJsonPath('errors.0.code', PlatformTeamMembershipService::NOT_ACTIVE);
            $this->assertSame(['is_god' => 0, 'is_super_admin' => 0, 'role' => 'admin'], $this->flags((int) $target->id), $status);
            $this->assertCount(0, $this->recorded((int) $target->id), $status);
        }
    }

    public function test_an_account_that_is_deleted_erased_missing_or_a_stand_in_is_not_found(): void
    {
        $deleted = $this->account(['role' => 'admin']);
        DB::table('users')->where('id', $deleted->id)->update(['deleted_at' => now()]);
        $erased = $this->account(['role' => 'admin']);
        DB::table('users')->where('id', $erased->id)->update(['anonymized_at' => now()]);
        // A manager's stand-in: a row no request can create, so it is written directly.
        $standIn = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Manager Stand In',
            'email' => 'stand-in-' . uniqid() . '@membership.test',
            'password_hash' => null,
            'role' => 'admin',
            'status' => 'delegate',
            'is_approved' => 1,
            'preferred_language' => 'en',
            'onboarding_completed' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->actAsPlatformTeam();

        foreach ([(int) $deleted->id, (int) $erased->id, $standIn, 999999999] as $id) {
            foreach ([self::addUri($id), self::removeUri($id)] as $uri) {
                $this->apiPost($uri)->assertStatus(404);
            }
            $this->assertCount(0, $this->recorded($id));
        }
        $this->assertSame(0, $this->flags((int) $deleted->id)['is_god']);
        $this->assertSame(0, $this->flags((int) $erased->id)['is_god']);
        $this->assertSame(0, $this->flags($standIn)['is_god']);
    }

    public function test_adding_someone_who_is_already_on_the_team_changes_and_records_nothing(): void
    {
        $target = $this->account(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $this->actAsPlatformTeam();

        $response = $this->apiPost(self::addUri((int) $target->id));

        $response->assertStatus(422)->assertJsonPath('errors.0.code', PlatformTeamMembershipService::ALREADY_MEMBER);
        $this->assertCount(0, $this->recorded((int) $target->id));
    }

    // ------------------------------------------------------------------ remove

    public function test_removing_a_member_takes_the_team_flag_only_and_records_it(): void
    {
        $target = $this->account(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        $me = $this->actAsPlatformTeam();

        $response = $this->apiPost(self::removeUri((int) $target->id));

        $response->assertStatus(200);
        $this->assertSame(['removed' => true, 'user_id' => (int) $target->id], $response->json('data'));
        $this->assertFalse(PlatformTeam::includes((int) $target->id));
        // Still a global super admin: that is taken away in the super admin panel.
        $this->assertSame(['is_god' => 0, 'is_super_admin' => 1, 'role' => 'super_admin'], $this->flags((int) $target->id));

        $rows = $this->recorded((int) $target->id);
        $this->assertCount(1, $rows);
        $this->assertSame('platform_team_removed', $rows[0]->action_type);
        $this->assertSame((int) $me->id, (int) $rows[0]->actor_user_id);
        $this->assertSame(['is_god' => 1], json_decode((string) $rows[0]->old_values, true));
        $this->assertSame(['is_god' => 0], json_decode((string) $rows[0]->new_values, true));
        // The caller is untouched.
        $this->assertTrue(PlatformTeam::includes((int) $me->id));
    }

    /** Nobody removes themselves, so somebody is always left who can add people. */
    public function test_nobody_can_remove_themselves(): void
    {
        $me = $this->actAsPlatformTeam();

        $response = $this->apiPost(self::removeUri((int) $me->id));

        $response->assertStatus(422)->assertJsonPath('errors.0.code', PlatformTeamMembershipService::CANNOT_REMOVE_SELF);
        $this->assertTrue(PlatformTeam::includes((int) $me->id));
        $this->assertCount(0, $this->recorded((int) $me->id));
    }

    public function test_removing_an_account_that_does_not_have_the_flag_changes_and_records_nothing(): void
    {
        $target = $this->account(['is_super_admin' => true, 'role' => 'super_admin']);
        $this->actAsPlatformTeam();

        $response = $this->apiPost(self::removeUri((int) $target->id));

        $response->assertStatus(422)->assertJsonPath('errors.0.code', PlatformTeamMembershipService::NOT_MEMBER);
        $this->assertSame(1, $this->flags((int) $target->id)['is_super_admin']);
        $this->assertCount(0, $this->recorded((int) $target->id));
    }

    /** The half-set account can reach every community: its flag can be taken away here. */
    public function test_the_flag_can_be_taken_from_an_account_that_only_has_the_flag(): void
    {
        $target = $this->account(['is_god' => true], twoStep: false);
        $this->actAsPlatformTeam();

        $this->apiPost(self::removeUri((int) $target->id))->assertStatus(200);

        $this->assertSame(0, $this->flags((int) $target->id)['is_god']);
        $this->assertCount(1, $this->recorded((int) $target->id, 'platform_team_removed'));
    }

    // ------------------------------------------------- where the record shows

    public function test_the_security_page_lists_both_changes_by_name(): void
    {
        $added = $this->account(['is_super_admin' => true, 'role' => 'super_admin', 'first_name' => 'Added', 'last_name' => 'Sample']);
        $removed = $this->account(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin', 'first_name' => 'Removed', 'last_name' => 'Sample']);
        $this->actAsPlatformTeam();
        $this->apiPost(self::addUri((int) $added->id))->assertStatus(200);
        $this->apiPost(self::removeUri((int) $removed->id))->assertStatus(200);

        $items = $this->apiGet(self::SECURITY)->assertStatus(200)->json('data.access_changes.items');

        $changes = [];
        foreach ($items as $item) {
            $changes[(string) $item['account']] = $item['change'];
        }
        $this->assertSame('platform_team_added', $changes['Added Sample'] ?? null);
        $this->assertSame('platform_team_removed', $changes['Removed Sample'] ?? null);
    }
}
