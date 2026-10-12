<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TokenService;
use App\Support\Authorization\ManagerDelegate;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\MakesNetworkAdminHierarchy;
use Tests\Laravel\TestCase;

/**
 * A manager from a parent community acts inside a lower community as its
 * DELEGATE — a recorded identity of that community (owner, 12 Oct 2026:
 * "Go with option 3"). These tests pin what the delegate is, and above all what
 * it can never become: a sign-in, a member, or an account someone else takes
 * over to act under the manager's name.
 *
 * Fixture: parent 999 above the shared test community 2; sibling 998.
 */
final class ManagerDelegateTest extends TestCase
{
    use DatabaseTransactions;
    use MakesNetworkAdminHierarchy;

    private const PARENT = 999;
    private const CHILD = 2;
    private const SIBLING = 998;

    protected function setUp(): void
    {
        parent::setUp();
        $this->makeHomeTenantOversee(self::PARENT, self::CHILD);
        DB::table('tenants')->where('id', self::SIBLING)->delete();
        DB::table('tenants')->insert([
            'id' => self::SIBLING,
            'name' => 'Sibling ' . self::SIBLING,
            'slug' => 'md-sibling-' . Str::lower(Str::random(6)),
            'configuration' => json_encode([]),
            'path' => '/' . self::PARENT . '/' . self::SIBLING . '/',
            'depth' => 1,
            'parent_id' => self::PARENT,
            'allows_subtenants' => 0,
            'is_active' => 1,
        ]);
        TenantContext::setById(self::CHILD);
    }

    // ------------------------------------------------------------ what it is

    public function test_a_parent_tenant_super_admin_gets_one_delegate_per_community_it_acts_in(): void
    {
        $manager = $this->tenantSuperAdmin(self::PARENT, ['first_name' => 'Ada', 'last_name' => 'Hub']);

        $delegate = ManagerDelegate::forPrincipal($manager, self::CHILD);

        self::assertNotNull($delegate);
        self::assertSame(self::CHILD, (int) $delegate->tenant_id);
        self::assertSame('delegate', (string) $delegate->status);
        self::assertSame('admin', (string) $delegate->role);
        self::assertNull($delegate->password_hash, 'A delegate has no password.');
        self::assertStringEndsWith('@delegate.invalid', (string) $delegate->email, 'A delegate can never receive email.');
        self::assertSame('Ada', $delegate->first_name);
        self::assertSame('Hub', $delegate->last_name);
        self::assertSame(0, (int) $delegate->is_tenant_super_admin);
        self::assertSame(0, (int) $delegate->is_super_admin);
        self::assertSame(0, (int) $delegate->is_god);

        $again = ManagerDelegate::forPrincipal($manager, self::CHILD);
        self::assertSame((int) $delegate->id, (int) $again?->id, 'Reused, not created again.');
        self::assertSame((int) $manager->id, (int) ManagerDelegate::principalOf($delegate)?->id);
        self::assertTrue(ManagerDelegate::isUsable($delegate, self::CHILD));
    }

    public function test_the_delegate_follows_the_managers_name(): void
    {
        $manager = $this->tenantSuperAdmin(self::PARENT, ['first_name' => 'Old', 'last_name' => 'Name']);
        $delegate = ManagerDelegate::forPrincipal($manager, self::CHILD);
        self::assertNotNull($delegate);

        DB::table('users')->where('id', $manager->id)->update(['first_name' => 'New', 'last_name' => 'Surname']);
        $again = ManagerDelegate::forPrincipal($manager->fresh(), self::CHILD);

        self::assertSame('New', $again?->first_name);
        self::assertSame('New', DB::table('users')->where('id', $delegate->id)->value('first_name'));
    }

    /**
     * @return array<string, array{0:int,1:array<string,mixed>,2:int}>
     */
    public static function accountsWithoutADelegate(): array
    {
        return [
            'plain parent admin' => [self::PARENT, ['role' => 'admin', 'is_admin' => 1], self::CHILD],
            'parent broker with a stray flag' => [self::PARENT, ['role' => 'broker', 'is_tenant_super_admin' => 1], self::CHILD],
            'sibling tenant super admin' => [self::SIBLING, ['role' => 'admin', 'is_admin' => 1, 'is_tenant_super_admin' => 1], self::CHILD],
            'child tenant super admin, upwards' => [self::CHILD, ['role' => 'admin', 'is_admin' => 1, 'is_tenant_super_admin' => 1], self::PARENT],
        ];
    }

    /**
     * @dataProvider accountsWithoutADelegate
     * @param array<string,mixed> $attributes
     */
    public function test_no_delegate_for_an_account_that_may_not_manage_there(int $home, array $attributes, int $target): void
    {
        $account = $this->user($home, $attributes);

        self::assertNull(ManagerDelegate::forPrincipal($account, $target));
        self::assertSame(0, DB::table('tenant_manager_delegates')->where('principal_user_id', $account->id)->count());
    }

    public function test_the_delegate_stops_working_the_moment_the_manager_loses_its_role(): void
    {
        $manager = $this->tenantSuperAdmin(self::PARENT);
        $delegate = ManagerDelegate::forPrincipal($manager, self::CHILD);
        self::assertNotNull($delegate);
        self::assertTrue(ManagerDelegate::isActingAccount($delegate));

        DB::table('users')->where('id', $manager->id)->update(['is_tenant_super_admin' => 0]);
        self::assertFalse(ManagerDelegate::isUsable($delegate, self::CHILD));
        self::assertFalse(ManagerDelegate::isActingAccount($delegate));

        DB::table('users')->where('id', $manager->id)->update(['is_tenant_super_admin' => 1, 'status' => 'suspended']);
        self::assertFalse(ManagerDelegate::isActingAccount($delegate), 'A suspended manager cannot act through its delegate.');
    }

    public function test_a_delegate_is_never_usable_in_another_community(): void
    {
        $manager = $this->tenantSuperAdmin(self::PARENT);
        $delegate = ManagerDelegate::forPrincipal($manager, self::CHILD);
        self::assertNotNull($delegate);

        self::assertFalse(ManagerDelegate::isUsable($delegate, self::SIBLING));
    }

    // ---------------------------------------------- what it can never become

    /**
     * @return array<string, array{0:array<string,mixed>}>
     */
    public static function takeovers(): array
    {
        return [
            'made an ordinary account' => [['status' => 'active']],
            'given a password' => [['password_hash' => '$2y$10$abcdefghijklmnopqrstuuJ5jEcvZ8a8pT6yH3o2nYbF0Qm7lG5e']],
            'given a real email address' => [['email' => 'someone@example.com']],
            'made a member' => [['role' => 'member']],
            'moved to another community' => [['tenant_id' => self::SIBLING]],
            'made a tenant super admin' => [['is_tenant_super_admin' => 1]],
            'made a platform admin' => [['is_super_admin' => 1]],
            'made god' => [['is_god' => 1]],
        ];
    }

    /**
     * @dataProvider takeovers
     * @param array<string,mixed> $change
     */
    public function test_the_database_refuses_taking_a_delegate_over(array $change): void
    {
        $delegate = ManagerDelegate::forPrincipal($this->tenantSuperAdmin(self::PARENT), self::CHILD);
        self::assertNotNull($delegate);

        $this->expectException(QueryException::class);
        DB::table('users')->where('id', $delegate->id)->update($change);
    }

    public function test_the_database_refuses_turning_an_ordinary_account_into_a_delegate(): void
    {
        $member = $this->user(self::CHILD, ['role' => 'member']);

        $this->expectException(QueryException::class);
        DB::table('users')->where('id', $member->id)->update(['status' => 'delegate']);
    }

    public function test_the_database_refuses_creating_a_delegate_with_a_password(): void
    {
        $this->expectException(QueryException::class);
        DB::table('users')->insert([
            'tenant_id' => self::CHILD,
            'name' => 'Forged',
            'email' => 'forged-' . Str::lower(Str::random(6)) . '@delegate.invalid',
            'password_hash' => '$2y$10$abcdefghijklmnopqrstuuJ5jEcvZ8a8pT6yH3o2nYbF0Qm7lG5e',
            'role' => 'admin',
            'status' => 'delegate',
        ]);
    }

    public function test_no_sign_in_token_can_be_made_for_a_delegate(): void
    {
        $delegate = ManagerDelegate::forPrincipal($this->tenantSuperAdmin(self::PARENT), self::CHILD);
        self::assertNotNull($delegate);

        try {
            app(TokenService::class)->generateToken((int) $delegate->id, self::CHILD);
            self::fail('An access token was minted for a delegate.');
        } catch (\RuntimeException) {
            // expected
        }

        $this->expectException(\RuntimeException::class);
        app(TokenService::class)->generateRefreshToken((int) $delegate->id, self::CHILD);
    }

    public function test_a_delegate_session_is_refused_even_if_one_existed(): void
    {
        $delegate = ManagerDelegate::forPrincipal($this->tenantSuperAdmin(self::PARENT), self::CHILD);
        self::assertNotNull($delegate);

        /** @var User $model */
        $model = User::withoutGlobalScopes()->findOrFail($delegate->id);
        Sanctum::actingAs($model, ['*']);

        // Authenticate's "status must be active" check refuses it.
        $response = $this->withHeaders(['X-Tenant-ID' => (string) self::CHILD, 'Accept' => 'application/json'])
            ->getJson('/api/v2/users/me');
        $response->assertStatus(403);
        self::assertSame('account_suspended', $response->json('errors.0.code'));
    }

    // ------------------------------------------------- where it never shows

    public function test_the_admin_user_list_and_detail_never_show_a_delegate(): void
    {
        $delegate = ManagerDelegate::forPrincipal($this->tenantSuperAdmin(self::PARENT), self::CHILD);
        self::assertNotNull($delegate);
        $admin = $this->user(self::CHILD, ['role' => 'admin', 'is_admin' => 1]);
        Sanctum::actingAs($admin, ['*']);

        $list = $this->withHeaders(['X-Tenant-ID' => (string) self::CHILD, 'Accept' => 'application/json'])
            ->getJson('/api/v2/admin/users?limit=500&status=all&search=' . urlencode((string) $delegate->last_name));
        $list->assertStatus(200);
        $ids = array_map(static fn ($row): int => (int) ($row['id'] ?? 0), (array) $list->json('data'));
        self::assertNotContains((int) $delegate->id, $ids);

        $this->withHeaders(['X-Tenant-ID' => (string) self::CHILD, 'Accept' => 'application/json'])
            ->getJson('/api/v2/admin/users/' . $delegate->id)
            ->assertStatus(404);
    }

    public function test_the_member_export_never_contains_a_delegate(): void
    {
        $delegate = ManagerDelegate::forPrincipal($this->tenantSuperAdmin(self::PARENT), self::CHILD);
        self::assertNotNull($delegate);

        $method = new \ReflectionMethod(\App\Services\MemberImport\MemberExportCsv::class, 'members');
        $method->setAccessible(true);
        /** @var \Illuminate\Database\Query\Builder $query */
        $query = $method->invoke(null, self::CHILD);

        self::assertFalse($query->where('id', $delegate->id)->exists());
    }

    // ------------------------------------------------------------- helpers

    /** @param array<string,mixed> $extra */
    private function tenantSuperAdmin(int $tenantId, array $extra = []): User
    {
        return $this->user($tenantId, ['role' => 'admin', 'is_admin' => 1, 'is_tenant_super_admin' => 1, ...$extra]);
    }

    /** @param array<string,mixed> $attributes */
    private function user(int $tenantId, array $attributes): User
    {
        $current = TenantContext::currentId();
        $user = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
            ...$attributes,
        ]);
        if ($current !== null) {
            TenantContext::setById($current);
        }

        return $user->fresh() ?? $user;
    }
}
