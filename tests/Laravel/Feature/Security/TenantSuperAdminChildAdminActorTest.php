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
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Laravel\TestCase;

/**
 * Inside the admin screens of a community below its own, the ACTOR is a user
 * from another community.
 *
 * Once a parent community's tenant super admin is let through the door
 * (TenantSuperAdminCrossTenantEntryTest), every admin endpoint that looked the
 * ACTOR up with `where('tenant_id', <current community>)` silently found nobody
 * and refused, 404'd or skipped a permission. Those lookups now load the actor
 * by id and ask CrossTenantEntry::actorMayActIn(). The TARGETS — the members,
 * events and settings being administered — stay confined to the current
 * community, and each grant here is paired with that confinement.
 *
 * Owner rule, 12 October 2026: "A tenant super admin should be able to
 * administer all tenants below it, but not above it."
 */
final class TenantSuperAdminChildAdminActorTest extends TestCase
{
    use DatabaseTransactions;

    private const HUB = 2;
    private const CHILD = 101;

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
        $features = json_decode((string) DB::table('tenants')->where('id', self::HUB)->value('features'), true);
        $features = is_array($features) ? $features : [];
        $features['events'] = true;
        $features['caring_community'] = true;

        DB::table('tenants')->where('id', self::CHILD)->delete();
        DB::table('tenants')->insert([
            'id' => self::CHILD,
            'name' => 'Actor child ' . self::CHILD,
            'slug' => 'actor-child-' . Str::lower(Str::random(6)),
            'configuration' => json_encode([]),
            'features' => json_encode($features),
            'path' => '/' . self::HUB . '/' . self::CHILD . '/',
            'depth' => 1,
            'parent_id' => self::HUB,
            'allows_subtenants' => 0,
            'is_active' => 1,
        ]);
    }

    public function test_the_safeguarding_screen_of_a_child_community_opens(): void
    {
        $this->asHubTenantSuperAdmin('GET', '/api/v2/admin/safeguarding/dashboard')
            ->assertStatus(200);
    }

    public function test_the_caring_community_safeguarding_screen_of_a_child_community_opens(): void
    {
        $this->asHubTenantSuperAdmin('GET', '/api/v2/admin/caring-community/safeguarding/dashboard')
            ->assertStatus(200);
    }

    public function test_an_event_awaiting_review_in_a_child_community_can_be_approved(): void
    {
        $eventId = $this->event(self::CHILD, 'pending_review');

        $this->asHubTenantSuperAdmin('POST', "/api/v2/admin/events/{$eventId}/approve")
            ->assertStatus(200);

        self::assertSame('published', DB::table('events')->where('id', $eventId)->value('publication_status'));
    }

    public function test_an_event_in_a_child_community_can_be_cancelled_without_a_server_error(): void
    {
        $eventId = $this->event(self::CHILD, 'published');

        $this->asHubTenantSuperAdmin('POST', "/api/v2/admin/events/{$eventId}/cancel", ['reason' => 'Venue unavailable'])
            ->assertStatus(200);

        self::assertSame('cancelled', DB::table('events')->where('id', $eventId)->value('operational_status'));
    }

    public function test_an_event_of_the_hub_is_not_reachable_from_the_child_context(): void
    {
        $eventId = $this->event(self::HUB, 'pending_review');

        $this->asHubTenantSuperAdmin('POST', "/api/v2/admin/events/{$eventId}/approve")
            ->assertStatus(404);

        self::assertSame('pending_review', DB::table('events')->where('id', $eventId)->value('publication_status'));
    }

    public function test_a_child_members_role_can_be_changed(): void
    {
        $member = $this->user(self::CHILD, ['role' => 'member']);

        $this->asHubTenantSuperAdmin('PUT', "/api/v2/admin/users/{$member->id}", ['role' => 'broker'])
            ->assertStatus(200);

        self::assertSame('broker', DB::table('users')->where('id', $member->id)->value('role'));
    }

    public function test_a_hub_member_is_not_editable_from_the_child_context(): void
    {
        $hubMember = $this->user(self::HUB, ['role' => 'member']);

        $this->asHubTenantSuperAdmin('PUT', "/api/v2/admin/users/{$hubMember->id}", ['role' => 'broker'])
            ->assertStatus(404);

        self::assertSame('member', DB::table('users')->where('id', $hubMember->id)->value('role'));
    }

    // ------------------------------------------------------------- helpers

    /** @param array<string,mixed> $body */
    private function asHubTenantSuperAdmin(string $method, string $uri, array $body = []): TestResponse
    {
        $actor = $this->user(self::HUB, ['role' => 'admin', 'is_tenant_super_admin' => 1]);
        $token = app(TokenService::class)->generateToken(
            (int) $actor->id,
            self::HUB,
            TwoFactorPolicy::claims('totp'),
        );

        TenantContext::reset();
        app('auth')->forgetGuards();

        return $this->withHeaders([
            'X-Tenant-ID' => (string) self::CHILD,
            'Accept' => 'application/json',
            'Authorization' => 'Bearer ' . $token,
        ])->json($method, $uri, $body);
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

    private function event(int $tenantId, string $publicationState): int
    {
        $organizer = $this->user($tenantId, ['role' => 'member']);
        $start = now()->addDays(5);

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => (int) $organizer->id,
            'title' => 'Cross-community admin fixture',
            'description' => 'Cross-community admin fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHours(2),
            'status' => $publicationState === 'published' ? 'active' : 'draft',
            'publication_status' => $publicationState,
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'is_recurring_template' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
