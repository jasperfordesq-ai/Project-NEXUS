<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\Enterprise\GdprService;
use App\Support\Authorization\PlatformTeam;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * There is always at least one platform team member (owner, 17 Nov 2026):
 * the last one cannot be deleted, erased or demoted, by any route.
 *
 * Two layers, both tested here:
 *
 *   1. The database itself (triggers `trg_users_last_platform_team_*`). This
 *      is the guarantee: it holds for every request, every command, and an
 *      edit made by hand. The tests write straight to the table, as any code
 *      path could.
 *   2. The requests a person can actually press, which refuse first with a
 *      message that says why, before anything is emailed or erased.
 *
 * "On the team" is App\Support\Authorization\PlatformTeam's definition
 * (`is_god` AND super admin by flag or role), on an account that is neither
 * deleted nor erased.
 */
class LastPlatformTeamMemberTest extends TestCase
{
    use DatabaseTransactions;

    private const CODE = 'PLATFORM_TEAM_LAST_MEMBER';

    private const DB_MESSAGE = 'platform_team_last_member';

    /** @param array<string, mixed> $attributes */
    private function account(array $attributes = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attributes));
    }

    private function member(array $attributes = []): User
    {
        return $this->account(array_merge(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin'], $attributes));
    }

    /**
     * A member who is the ONLY one. Any member this database already holds is
     * taken off the team first (allowed, because the new one exists), so the
     * test does not depend on the database being empty of them. Rolled back
     * with the test.
     */
    private function onlyMember(array $attributes = []): User
    {
        $member = $this->member($attributes);
        DB::table('users')->where('is_god', 1)->where('id', '<>', $member->id)->update(['is_god' => 0]);
        $this->assertTrue(PlatformTeam::isLastMember((int) $member->id));

        return $member;
    }

    private function row(int $id): ?object
    {
        return DB::table('users')->where('id', $id)->first(['id', 'is_god', 'is_super_admin', 'role', 'deleted_at', 'anonymized_at', 'status', 'email']);
    }

    private function assertRefusedByTheDatabase(callable $write): void
    {
        try {
            $write();
        } catch (QueryException $e) {
            $this->assertStringContainsString(self::DB_MESSAGE, $e->getMessage());

            return;
        }
        $this->fail('The database allowed the last platform team member to be deleted or demoted.');
    }

    private function actAs(User $user): void
    {
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($this->testTenantId);
    }

    /** @return array<string, array{0: callable(int): mixed}> */
    public static function waysOffTheTeam(): array
    {
        return [
            'the team flag cleared' => [static fn (int $id) => DB::table('users')->where('id', $id)->update(['is_god' => 0])],
            'global super admin cleared' => [static fn (int $id) => DB::table('users')->where('id', $id)->update(['is_super_admin' => 0, 'role' => 'admin'])],
            'marked as deleted' => [static fn (int $id) => DB::table('users')->where('id', $id)->update(['deleted_at' => now()])],
            'erased' => [static fn (int $id) => DB::table('users')->where('id', $id)->update(['anonymized_at' => now()])],
            'the row deleted' => [static fn (int $id) => DB::table('users')->where('id', $id)->delete()],
        ];
    }

    // ------------------------------------------------------- the database

    /** @dataProvider waysOffTheTeam */
    public function test_the_database_refuses_it_for_the_only_member(callable $write): void
    {
        $member = $this->onlyMember();
        $before = $this->row((int) $member->id);

        $this->assertRefusedByTheDatabase(static fn () => $write((int) $member->id));

        $this->assertEquals($before, $this->row((int) $member->id), 'the account must be exactly as it was');
        $this->assertTrue(PlatformTeam::includes((int) $member->id));
    }

    /** @dataProvider waysOffTheTeam */
    public function test_the_database_allows_it_when_another_member_is_left(callable $write): void
    {
        $member = $this->onlyMember();
        $other = $this->member();

        $write((int) $member->id);

        $after = $this->row((int) $member->id);
        $this->assertTrue(
            $after === null || empty($after->is_god) || empty($after->is_super_admin) || $after->deleted_at !== null || $after->anonymized_at !== null,
            'the change was made'
        );
        $this->assertTrue(PlatformTeam::isLastMember((int) $other->id), 'and the one who is left is now the last');
    }

    /** A member by the old role string alone (no super admin flag) is a member too. */
    public function test_the_only_member_by_role_alone_cannot_have_the_role_changed(): void
    {
        $member = $this->onlyMember(['is_super_admin' => false]);

        $this->assertRefusedByTheDatabase(static fn () => DB::table('users')->where('id', $member->id)->update(['role' => 'admin']));

        $this->assertSame('super_admin', $this->row((int) $member->id)->role);
    }

    public function test_two_members_can_go_down_to_one_but_not_to_none(): void
    {
        $first = $this->onlyMember();
        $second = $this->member();

        DB::table('users')->where('id', $first->id)->update(['is_god' => 0]);
        $this->assertRefusedByTheDatabase(static fn () => DB::table('users')->where('id', $second->id)->update(['is_god' => 0]));

        $this->assertTrue(PlatformTeam::includes((int) $second->id));
    }

    /** One statement that would take every member off at once is refused too. */
    public function test_one_statement_cannot_take_every_member_off_at_once(): void
    {
        $first = $this->onlyMember();
        $second = $this->member();

        $this->assertRefusedByTheDatabase(static fn () => DB::table('users')->whereIn('id', [$first->id, $second->id])->update(['is_god' => 0]));

        // The whole statement is undone: both are still members.
        $this->assertTrue(PlatformTeam::includes((int) $first->id));
        $this->assertTrue(PlatformTeam::includes((int) $second->id));
    }

    public function test_anything_else_about_the_only_member_can_still_be_changed(): void
    {
        $member = $this->onlyMember();

        DB::table('users')->where('id', $member->id)->update(['last_login_at' => '2026-11-17 08:00:00', 'first_name' => 'Renamed']);

        $this->assertSame('Renamed', DB::table('users')->where('id', $member->id)->value('first_name'));
    }

    /** The rule is about the team. Accounts that are not on it are not held by it. */
    public function test_accounts_that_are_not_on_the_team_are_not_held(): void
    {
        $this->onlyMember();
        $flagOnly = $this->account(['is_god' => true]);
        $global = $this->account(['is_super_admin' => true, 'role' => 'super_admin']);
        $ordinary = $this->account(['role' => 'member']);

        DB::table('users')->where('id', $flagOnly->id)->update(['is_god' => 0]);
        DB::table('users')->where('id', $global->id)->update(['is_super_admin' => 0, 'role' => 'member']);
        DB::table('users')->where('id', $ordinary->id)->update(['deleted_at' => now(), 'anonymized_at' => now()]);
        DB::table('users')->where('id', $ordinary->id)->delete();

        $this->assertNull($this->row((int) $ordinary->id));
        $this->assertSame(0, (int) $this->row((int) $flagOnly->id)->is_god);
    }

    // ------------------------------------------------- the one definition

    public function test_is_last_member_is_true_only_for_a_member_with_nobody_else(): void
    {
        $member = $this->onlyMember();
        $notOnTeam = $this->account(['is_super_admin' => true, 'role' => 'super_admin']);

        $this->assertTrue(PlatformTeam::isLastMember((int) $member->id));
        $this->assertFalse(PlatformTeam::isLastMember((int) $notOnTeam->id), 'not a member at all');
        $this->assertFalse(PlatformTeam::isLastMember(0));

        $other = $this->member();
        $this->assertFalse(PlatformTeam::isLastMember((int) $member->id));
        $this->assertFalse(PlatformTeam::isLastMember((int) $other->id));
    }

    // ------------------------------------------- the requests a person presses

    public function test_the_community_admin_panel_cannot_take_global_super_admin_from_the_only_member(): void
    {
        $member = $this->onlyMember(['role' => 'admin']);
        // Passes that request's own checks (an admin with the flag), without being a member.
        $this->actAs($this->account(['role' => 'admin', 'is_god' => true]));

        $response = $this->apiPut("/v2/admin/users/{$member->id}/global-super-admin", ['grant' => false]);

        $response->assertStatus(422)->assertJsonPath('errors.0.code', self::CODE);
        $this->assertTrue(PlatformTeam::includes((int) $member->id));
    }

    public function test_that_request_still_works_when_another_member_is_left(): void
    {
        $member = $this->onlyMember(['role' => 'admin']);
        $this->member();
        $this->actAs($this->account(['role' => 'admin', 'is_god' => true]));

        $this->apiPut("/v2/admin/users/{$member->id}/global-super-admin", ['grant' => false])->assertStatus(200);

        $this->assertFalse(PlatformTeam::includes((int) $member->id));
    }

    public function test_the_super_admin_panel_cannot_take_global_super_admin_from_the_only_member(): void
    {
        $member = $this->onlyMember(['role' => 'admin']);
        $this->actAs($this->account(['role' => 'admin', 'is_god' => true, 'is_tenant_super_admin' => true]));

        $response = $this->apiPost("/v2/admin/super/users/{$member->id}/revoke-global-super-admin");

        $response->assertStatus(422)->assertJsonPath('errors.0.code', self::CODE);
        $this->assertTrue(PlatformTeam::includes((int) $member->id));
        $this->assertSame(
            0,
            DB::table('super_admin_audit_log')->where('action_type', 'global_super_admin_revoked')->where('target_id', $member->id)->count(),
            'nothing happened, so nothing is recorded'
        );
    }

    public function test_an_admin_cannot_delete_the_only_member(): void
    {
        $member = $this->onlyMember();
        $this->actAs($this->account(['role' => 'admin', 'is_god' => true]));

        $response = $this->apiDelete("/v2/admin/users/{$member->id}");

        $response->assertStatus(422)->assertJsonPath('errors.0.code', self::CODE);
        $after = $this->row((int) $member->id);
        $this->assertNotNull($after);
        $this->assertNull($after->deleted_at);
        $this->assertSame((string) $member->email, (string) $after->email);
    }

    public function test_the_only_member_cannot_delete_their_own_account(): void
    {
        $member = $this->onlyMember();
        $this->actAs($member);

        // The factory's password. It is right, so the refusal is the rule's, not the password check's.
        $response = $this->apiDelete('/v2/users/me', ['password' => 'password']);

        $response->assertStatus(422)->assertJsonPath('errors.0.code', self::CODE);
        $after = $this->row((int) $member->id);
        $this->assertNull($after->anonymized_at);
        $this->assertSame((string) $member->email, (string) $after->email);
        $this->assertTrue(PlatformTeam::includes((int) $member->id));
    }

    /** Whoever calls it, erasure stops before it has removed anything. */
    public function test_erasure_of_the_only_member_stops_before_anything_is_removed(): void
    {
        $member = $this->onlyMember();
        DB::table('notifications')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'type' => 'last-member-test',
            'message' => 'kept',
            'created_at' => now(),
        ]);

        try {
            (new GdprService($this->testTenantId))->executeAccountDeletion((int) $member->id);
            $this->fail('The only platform team member was erased.');
        } catch (\Throwable $e) {
            $this->assertStringContainsString(self::DB_MESSAGE, $e->getMessage());
        }

        $after = $this->row((int) $member->id);
        $this->assertNull($after->anonymized_at);
        $this->assertSame((string) $member->email, (string) $after->email);
        $this->assertSame(1, DB::table('notifications')->where('user_id', $member->id)->where('type', 'last-member-test')->count());
    }
}
