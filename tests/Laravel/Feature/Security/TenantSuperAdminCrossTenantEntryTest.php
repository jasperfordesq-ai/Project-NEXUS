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
use App\Services\TwoFactorPolicy;
use App\Support\Authorization\CrossTenantEntry;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * May a signed-in account operate inside a community other than its own?
 *
 * 🔴 OWNER RULE, 12 October 2026 (verbatim): "A tenant super admin should be
 * able to administer all tenants below it, but not above it."
 *
 * Before this, every request was pinned to the caller's home community before
 * any authority logic ran: TenantContext and the Authenticate middleware
 * refused a community switch for everyone except the platform owner. So a
 * parent community's tenant super admin could not open the ordinary admin
 * screens of a community below it, whatever TenantAdminScope said.
 *
 * The rule now (App\Support\Authorization\CrossTenantEntry):
 *   - the platform owner (is_super_admin / is_god / role super_admin|god) —
 *     every community, every request, exactly as before;
 *   - a tenant super admin who is admin-tier — a STRICT descendant of its home
 *     community, on an ADMINISTRATION request only (/api/v2/admin/*, plus the
 *     read-only GET /api/v2/users/me the admin panel loads);
 *   - everybody else, and every member endpoint — refused, 403 tenant mismatch.
 *
 * Fixture: hub 2 (path /2/) with children 101 (/2/101/) and 102 (/2/102/), and
 * an unrelated root 103 (/103/). Every grant is paired with refusals on the
 * same fixture so "allowed" cannot mean the fixture lets everyone through.
 *
 * Two credential paths are live and both are exercised: a bearer JWT (what
 * production clients send, checked by TenantContext::resolve() and the
 * Authenticate JWT branch) and a stateful guard user (Sanctum::actingAs, no
 * bearer — checked by Authenticate's guard branch). Personal access tokens
 * were retired, so a "Sanctum token" case does not exist to test.
 */
final class TenantSuperAdminCrossTenantEntryTest extends TestCase
{
    use DatabaseTransactions;

    private const HUB = 2;
    private const CHILD = 101;
    private const SIBLING = 102;
    private const UNRELATED_ROOT = 103;

    private string $childSlug = '';

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);

        DB::table('tenants')->where('id', self::HUB)->update([
            'path' => '/' . self::HUB . '/',
            'depth' => 0,
            'parent_id' => null,
            'allows_subtenants' => 1,
            'is_active' => 1,
        ]);
        $this->childSlug = $this->makeTenant(self::CHILD, self::HUB, '/' . self::HUB . '/' . self::CHILD . '/');
        $this->makeTenant(self::SIBLING, self::HUB, '/' . self::HUB . '/' . self::SIBLING . '/');
        $this->makeTenant(self::UNRELATED_ROOT, null, '/' . self::UNRELATED_ROOT . '/');
    }

    protected function tearDown(): void
    {
        unset($_SERVER['HTTP_AUTHORIZATION'], $_SERVER['HTTP_X_TENANT_ID'], $_SERVER['HTTP_X_TENANT_SLUG']);
        parent::tearDown();
    }

    // ------------------------------------------------------------- grants

    public function test_a_hub_tenant_super_admin_opens_a_child_admin_screen_by_tenant_id(): void
    {
        $tsa = $this->tenantSuperAdmin(self::HUB);
        $childMember = $this->member(self::CHILD);
        $hubMember = $this->member(self::HUB);

        $response = $this->jwt('GET', '/api/v2/admin/users?limit=100', $tsa, ['X-Tenant-ID' => (string) self::CHILD]);

        $response->assertStatus(200);
        self::assertSame(self::CHILD, (int) TenantContext::getId());
        $ids = $this->listedUserIds($response);
        self::assertContains((int) $childMember->id, $ids, 'The child community\'s members are the ones administered.');
        self::assertNotContains((int) $hubMember->id, $ids, 'Target users stay confined to the community acted in.');
    }

    public function test_a_hub_tenant_super_admin_opens_a_child_admin_screen_by_tenant_slug(): void
    {
        $tsa = $this->tenantSuperAdmin(self::HUB);

        $this->jwt('GET', '/api/v2/admin/config', $tsa, ['X-Tenant-Slug' => $this->childSlug])
            ->assertStatus(200);
        self::assertSame(self::CHILD, (int) TenantContext::getId());
    }

    public function test_a_hub_tenant_super_admin_loads_its_own_identity_in_a_child_community(): void
    {
        $tsa = $this->tenantSuperAdmin(self::HUB);

        $this->jwt('GET', '/api/v2/users/me', $tsa, ['X-Tenant-ID' => (string) self::CHILD])
            ->assertStatus(200)
            ->assertJsonPath('data.id', (int) $tsa->id);
    }

    public function test_on_the_hub_custom_domain_the_rule_is_the_same(): void
    {
        $domain = 'xte-hub-' . Str::lower(Str::random(6)) . '.project-nexus.test';
        DB::table('tenants')->where('id', self::HUB)->update(['domain' => $domain]);

        $tsa = $this->tenantSuperAdmin(self::HUB);
        $this->jwt('GET', "http://{$domain}/api/v2/admin/config", $tsa, ['X-Tenant-ID' => (string) self::CHILD])
            ->assertStatus(200);
        self::assertSame(self::CHILD, (int) TenantContext::getId());

        $member = $this->jwt('POST', "http://{$domain}/api/v2/feed/posts", $tsa, ['X-Tenant-ID' => (string) self::CHILD]);
        $member->assertStatus(403);
        self::assertSame('TENANT_MISMATCH', $member->json('errors.0.code'));

        $admin = $this->user(self::HUB, ['role' => 'admin']);
        $refused = $this->jwt('GET', "http://{$domain}/api/v2/admin/config", $admin, ['X-Tenant-ID' => (string) self::CHILD]);
        $refused->assertStatus(403);
        self::assertSame('TENANT_MISMATCH', $refused->json('errors.0.code'));
    }

    /**
     * The child community's OWN custom domain (bridgwater.timebank.global, a
     * child of Timebanking UK, 15 Oct 2026). TenantContext locks the request to
     * the domain's community without looking at the token, so the crossing is
     * decided by the Authenticate middleware alone. A member call there must be
     * refused as a community mismatch (403), exactly as it is via the header:
     * it used to answer 401 "authentication required", which the website
     * reads as an expired session — it refreshed, was refused again, and
     * signed the manager out of the community it had just signed in to.
     */
    public function test_on_the_child_custom_domain_a_member_call_is_a_mismatch_not_a_lost_session(): void
    {
        $domain = 'xte-child-' . Str::lower(Str::random(6)) . '.project-nexus.test';
        DB::table('tenants')->where('id', self::CHILD)->update(['domain' => $domain]);

        $tsa = $this->tenantSuperAdmin(self::HUB);

        foreach ([[], ['X-Tenant-ID' => (string) self::CHILD]] as $headers) {
            $this->jwt('GET', "http://{$domain}/api/v2/admin/config", $tsa, $headers)
                ->assertStatus(200);
            self::assertSame(self::CHILD, (int) TenantContext::getId());

            $this->jwt('GET', "http://{$domain}/api/v2/users/me", $tsa, $headers)
                ->assertStatus(200)
                ->assertJsonPath('data.id', (int) $tsa->id);

            foreach (['/api/v2/notifications/counts', '/api/v2/messages/unread-count', '/api/v2/realtime/config'] as $uri) {
                $member = $this->jwt('GET', "http://{$domain}{$uri}", $tsa, $headers);
                $member->assertStatus(403);
                self::assertSame('tenant_mismatch', $member->json('errors.0.code'), $uri);
            }
        }

        // A plain member of the hub is refused on the child's domain the same
        // way — the session-ending answer the website acts on (AuthContext).
        $hubMember = $this->member(self::HUB);
        $refused = $this->jwt('GET', "http://{$domain}/api/v2/users/me", $hubMember, []);
        $refused->assertStatus(403);
        self::assertSame('tenant_mismatch', $refused->json('errors.0.code'));
    }

    public function test_a_stateful_hub_tenant_super_admin_opens_a_child_admin_screen(): void
    {
        $tsa = $this->tenantSuperAdmin(self::HUB);
        Sanctum::actingAs($tsa, ['*']);

        $this->withHeaders(['X-Tenant-ID' => (string) self::CHILD, 'Accept' => 'application/json'])
            ->getJson('/api/v2/admin/config')
            ->assertStatus(200);
    }

    // ---------------------------------------- refusals: member endpoints below

    /**
     * @return array<string, array{0:string,1:string}>
     */
    public static function memberEndpoints(): array
    {
        return [
            'wallet transfer' => ['POST', '/api/v2/wallet/transfer'],
            'feed post' => ['POST', '/api/v2/feed/posts'],
            'event registration' => ['POST', '/api/v2/events/1/rsvp'],
            'own profile edit' => ['PUT', '/api/v2/users/me'],
            'send a message' => ['POST', '/api/v2/messages'],
        ];
    }

    /** @dataProvider memberEndpoints */
    public function test_a_hub_tenant_super_admin_cannot_act_as_a_member_of_a_child_community(string $method, string $uri): void
    {
        $tsa = $this->tenantSuperAdmin(self::HUB);

        $response = $this->jwt($method, $uri, $tsa, ['X-Tenant-ID' => (string) self::CHILD]);

        $response->assertStatus(403);
        self::assertSame('TENANT_MISMATCH', $response->json('errors.0.code'));
    }

    /** @dataProvider memberEndpoints */
    public function test_a_stateful_hub_tenant_super_admin_cannot_act_as_a_member_of_a_child_community(string $method, string $uri): void
    {
        $tsa = $this->tenantSuperAdmin(self::HUB);
        Sanctum::actingAs($tsa, ['*']);

        $response = $this->withHeaders(['X-Tenant-ID' => (string) self::CHILD, 'Accept' => 'application/json'])
            ->json($method, $uri, []);

        $response->assertStatus(403);
        self::assertSame('tenant_mismatch', $response->json('errors.0.code'));
    }

    // ---------------------------------------- refusals: everyone else

    public function test_the_child_tenant_super_admin_cannot_administer_the_hub_above_it(): void
    {
        $this->assertJwtRefused($this->tenantSuperAdmin(self::CHILD), self::HUB);
    }

    public function test_a_sibling_tenant_super_admin_cannot_administer_the_child(): void
    {
        DB::table('tenants')->where('id', self::SIBLING)->update(['allows_subtenants' => 1]);
        $this->assertJwtRefused($this->tenantSuperAdmin(self::SIBLING), self::CHILD);
    }

    public function test_a_plain_hub_admin_cannot_administer_the_child(): void
    {
        $this->assertJwtRefused($this->user(self::HUB, ['role' => 'admin']), self::CHILD);
    }

    public function test_a_hub_broker_cannot_administer_the_child(): void
    {
        $this->assertJwtRefused($this->user(self::HUB, ['role' => 'broker']), self::CHILD);
    }

    public function test_a_hub_broker_carrying_a_stray_tenant_super_admin_flag_cannot_administer_the_child(): void
    {
        // AdminTier refuses broker/coordinator before reading any flag.
        $this->assertJwtRefused($this->user(self::HUB, ['role' => 'broker', 'is_tenant_super_admin' => 1]), self::CHILD);
    }

    public function test_an_unrelated_root_tenant_super_admin_cannot_administer_the_child(): void
    {
        DB::table('tenants')->where('id', self::UNRELATED_ROOT)->update(['allows_subtenants' => 1]);
        $this->assertJwtRefused($this->tenantSuperAdmin(self::UNRELATED_ROOT), self::CHILD);
    }

    public function test_a_stateful_child_tenant_super_admin_cannot_administer_the_hub(): void
    {
        $tsa = $this->tenantSuperAdmin(self::CHILD);
        Sanctum::actingAs($tsa, ['*']);

        $response = $this->withHeaders(['X-Tenant-ID' => (string) self::HUB, 'Accept' => 'application/json'])
            ->getJson('/api/v2/admin/config');

        $response->assertStatus(403);
        self::assertSame('tenant_mismatch', $response->json('errors.0.code'));
    }

    // ---------------------------------------- platform owner: unchanged

    public function test_the_platform_owner_still_crosses_into_any_community_for_any_request(): void
    {
        $owner = $this->user(self::UNRELATED_ROOT, ['role' => 'admin', 'is_super_admin' => 1]);

        $this->jwt('GET', '/api/v2/admin/config', $owner, ['X-Tenant-ID' => (string) self::CHILD])
            ->assertStatus(200);

        // Not a community-mismatch refusal on a member endpoint either: the
        // platform owner's reach was never limited to administration requests.
        $member = $this->jwt('GET', '/api/v2/users/me', $owner, ['X-Tenant-ID' => (string) self::CHILD]);
        $member->assertStatus(200);
    }

    // ---------------------------------------- the path test itself

    public function test_only_well_formed_administration_paths_count(): void
    {
        self::assertTrue(CrossTenantEntry::isAdministrationRequest('GET', '/api/v2/admin/users'));
        self::assertTrue(CrossTenantEntry::isAdministrationRequest('POST', 'api/v2/admin/users/5/suspend'));
        self::assertTrue(CrossTenantEntry::isAdministrationRequest('GET', 'api/v2/users/me'));
        self::assertTrue(CrossTenantEntry::isAdministrationRequest('HEAD', 'api/v2/users/me'));

        self::assertFalse(CrossTenantEntry::isAdministrationRequest('PUT', 'api/v2/users/me'), 'Editing one\'s own member profile is not administration.');
        self::assertFalse(CrossTenantEntry::isAdministrationRequest('DELETE', 'api/v2/users/me'));
        self::assertFalse(CrossTenantEntry::isAdministrationRequest('POST', 'api/v2/wallet/transfer'));
        self::assertFalse(CrossTenantEntry::isAdministrationRequest('GET', 'api/v2/administrators'));
        self::assertFalse(CrossTenantEntry::isAdministrationRequest('GET', 'api/v2/admin'));
        self::assertFalse(CrossTenantEntry::isAdministrationRequest('POST', 'api/v2/admin/../wallet/transfer'));
        self::assertFalse(CrossTenantEntry::isAdministrationRequest('POST', 'api/v2/admin/%2e%2e/wallet/transfer'));
        self::assertFalse(CrossTenantEntry::isAdministrationRequest('POST', 'api/v2/admin//x'));
        self::assertFalse(CrossTenantEntry::isAdministrationRequest('POST', 'api/v2/admin/./x'));
        self::assertFalse(CrossTenantEntry::isAdministrationRequest('POST', 'api/v2/admin\\x'));
        self::assertFalse(CrossTenantEntry::isAdministrationRequest('GET', 'api/v2/users/me/'));
        self::assertFalse(CrossTenantEntry::isAdministrationRequest('GET', 'api/v2/ADMIN/users'));
        self::assertFalse(CrossTenantEntry::isAdministrationRequest('GET', ''));
    }

    public function test_the_predicate_fails_closed_on_a_missing_path(): void
    {
        $tsa = $this->tenantSuperAdmin(self::HUB);
        self::assertTrue(CrossTenantEntry::allows($tsa, self::CHILD, 'GET', 'api/v2/admin/users'));
        self::assertFalse(CrossTenantEntry::allows($tsa, self::CHILD, 'POST', 'api/v2/wallet/transfer'), 'A member request below is never admitted.');
        self::assertFalse(CrossTenantEntry::allows($tsa, self::UNRELATED_ROOT, 'GET', 'api/v2/admin/users'));

        DB::table('tenants')->where('id', self::CHILD)->update(['path' => null]);
        self::assertFalse(CrossTenantEntry::allows($tsa, self::CHILD, 'GET', 'api/v2/admin/users'));

        DB::table('tenants')->where('id', self::CHILD)->update(['path' => '/2/101/']);
        DB::table('tenants')->where('id', self::HUB)->update(['path' => '']);
        self::assertFalse(CrossTenantEntry::allows($tsa, self::CHILD, 'GET', 'api/v2/admin/users'));
    }

    // ------------------------------------------------------------- helpers

    private function assertJwtRefused(User $actor, int $targetTenantId): void
    {
        foreach (['X-Tenant-ID' => (string) $targetTenantId, 'X-Tenant-Slug' => $this->slugOf($targetTenantId)] as $header => $value) {
            $response = $this->jwt('GET', '/api/v2/admin/config', $actor, [$header => $value]);
            $response->assertStatus(403);
            self::assertSame('TENANT_MISMATCH', $response->json('errors.0.code'), "Refused via {$header}.");
            self::assertSame(0, (int) TenantContext::getId(), 'Only the community-mismatch refusal sets community 0.');
        }

        // The same request in the actor's own community is served, so the
        // refusal above is about the community, not a broken credential.
        $control = $this->jwt('GET', '/api/v2/admin/config', $actor, ['X-Tenant-ID' => (string) $actor->tenant_id]);
        self::assertNotSame('TENANT_MISMATCH', $control->json('errors.0.code'));
    }

    /**
     * @param array<string,string> $headers
     */
    private function jwt(string $method, string $uri, User $actor, array $headers): TestResponse
    {
        $token = app(TokenService::class)->generateToken(
            (int) $actor->id,
            (int) $actor->tenant_id,
            TwoFactorPolicy::claims('totp'),
        );

        TenantContext::reset();
        unset($_SERVER['HTTP_X_TENANT_ID'], $_SERVER['HTTP_X_TENANT_SLUG']);
        app('auth')->forgetGuards();

        return $this->withHeaders([
            ...$headers,
            'Accept' => 'application/json',
            'Authorization' => 'Bearer ' . $token,
        ])->json($method, $uri, []);
    }

    /** @return list<int> */
    private function listedUserIds(TestResponse $response): array
    {
        $rows = $response->json('data') ?? [];

        return array_values(array_map(static fn ($row): int => (int) ($row['id'] ?? 0), is_array($rows) ? $rows : []));
    }

    private function tenantSuperAdmin(int $tenantId): User
    {
        return $this->user($tenantId, ['role' => 'admin', 'is_tenant_super_admin' => 1]);
    }

    private function member(int $tenantId): User
    {
        return $this->user($tenantId, ['role' => 'member']);
    }

    /** @param array<string,mixed> $attributes */
    private function user(int $tenantId, array $attributes): User
    {
        return User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
            ...$attributes,
        ]);
    }

    private function slugOf(int $tenantId): string
    {
        return (string) DB::table('tenants')->where('id', $tenantId)->value('slug');
    }

    private function makeTenant(int $id, ?int $parentId, string $path): string
    {
        $slug = 'xte-' . $id . '-' . Str::lower(Str::random(6));
        DB::table('tenants')->where('id', $id)->delete();
        DB::table('tenants')->insert([
            'id' => $id,
            'name' => 'Cross entry ' . $id,
            'slug' => $slug,
            'configuration' => json_encode([]),
            'path' => $path,
            'depth' => $parentId === null ? 0 : 1,
            'parent_id' => $parentId,
            'allows_subtenants' => 0,
            'is_active' => 1,
        ]);

        return $slug;
    }
}
