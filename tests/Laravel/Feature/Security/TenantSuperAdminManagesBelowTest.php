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
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Laravel\Concerns\MakesNetworkAdminHierarchy;
use Tests\Laravel\TestCase;

/**
 * A parent community's tenant super admin MANAGES the communities below it:
 * it can sign in there, keep its session there, and use the event organiser
 * tools there — not only the /api/v2/admin/* screens.
 *
 * 🔴 OWNER, 12 October 2026 (verbatim): "If a user tries to sign in to a
 * community that they're not allowed to sign in to, it should sign them out.
 * If they're allowed to sign in, they're allowed to sign in to manage those
 * communities if they're a super admin. I don't know why event organiser tools
 * are blocked for tenant super admins to tenants below them."
 *
 * Still refused below: taking part as a member (RSVP, waitlist, own tickets,
 * forms, acknowledgements) — managing a community is not belonging to it. And
 * still refused everywhere: above, beside, a separate root, a plain admin.
 *
 * Fixture: parent 999 (path /999/) above the shared test community 2
 * (/999/2/, events switched on), and a sibling 998 (/999/998/).
 */
final class TenantSuperAdminManagesBelowTest extends TestCase
{
    use DatabaseTransactions;
    use MakesNetworkAdminHierarchy;

    private const PARENT = 999;
    private const CHILD = 2;
    private const SIBLING = 998;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        Config::set('events.attendance_credit_mode', 'off');

        $this->makeHomeTenantOversee(self::PARENT, self::CHILD);
        DB::table('tenants')->where('id', self::SIBLING)->delete();
        DB::table('tenants')->insert([
            'id' => self::SIBLING,
            'name' => 'Sibling ' . self::SIBLING,
            'slug' => 'mb-sibling-' . Str::lower(Str::random(6)),
            'configuration' => json_encode([]),
            'path' => '/' . self::PARENT . '/' . self::SIBLING . '/',
            'depth' => 1,
            'parent_id' => self::PARENT,
            'allows_subtenants' => 0,
            'is_active' => 1,
        ]);
        TenantContext::setById(self::CHILD);
    }

    protected function tearDown(): void
    {
        unset($_SERVER['HTTP_AUTHORIZATION'], $_SERVER['HTTP_X_TENANT_ID'], $_SERVER['HTTP_X_TENANT_SLUG']);
        parent::tearDown();
    }

    // ------------------------------------------------ event organiser tools below

    /**
     * @return array<string, array{0:string,1:string}>
     */
    public static function organiserReads(): array
    {
        return [
            'event itself' => ['GET', ''],
            'team tab' => ['GET', '/staff'],
            'history' => ['GET', '/lifecycle-history'],
            'people' => ['GET', '/people'],
            'broadcasts' => ['GET', '/broadcasts'],
        ];
    }

    /** @dataProvider organiserReads */
    public function test_a_parent_tenant_super_admin_opens_a_child_event_organiser_tool(string $method, string $suffix): void
    {
        $eventId = $this->childEvent();

        $response = $this->jwt($method, "/api/v2/events/{$eventId}{$suffix}", $this->tenantSuperAdmin(self::PARENT), self::CHILD);

        self::assertNotSame(
            'TENANT_MISMATCH',
            $response->json('errors.0.code'),
            "The organiser tool {$suffix} must not be refused at the community door."
        );
        $response->assertStatus(200);
    }

    /**
     * Organiser tools whose controllers used to look the acting account up only
     * inside the current community. Some may answer "switched off" for this
     * fixture; what they must never answer is a refusal of the account.
     *
     * @return array<string, array{0:string}>
     */
    public static function organiserToolsWithOwnActorLookup(): array
    {
        return [
            'safety' => ['/safety'],
            'safety reviews' => ['/safety/reviews'],
            'tickets' => ['/tickets'],
            'attendees' => ['/attendees'],
            'attendance' => ['/attendance'],
            'waitlist' => ['/waitlist'],
            'invitations' => ['/registration-product/invitations'],
            'agenda' => ['/agenda'],
            'registration management' => ['/registration-product/manage'],
            'offline check-in' => ['/offline-checkin'],
        ];
    }

    /** @dataProvider organiserToolsWithOwnActorLookup */
    public function test_a_parent_tenant_super_admin_is_recognised_by_every_child_organiser_tool(string $suffix): void
    {
        $eventId = $this->childEvent();

        $control = $this->jwt('GET', "/api/v2/events/{$eventId}{$suffix}", $this->user(self::CHILD, ['role' => 'admin', 'is_admin' => 1]), self::CHILD);
        $response = $this->jwt('GET', "/api/v2/events/{$eventId}{$suffix}", $this->tenantSuperAdmin(self::PARENT), self::CHILD);

        self::assertNotSame('TENANT_MISMATCH', $response->json('errors.0.code'));
        self::assertSame(
            [$control->status(), $control->json('errors.0.code')],
            [$response->status(), $response->json('errors.0.code')],
            "{$suffix}: the parent's tenant super admin must get what the child's own admin gets. Child admin: "
                . $control->getContent() . ' — parent tenant super admin: ' . $response->getContent()
        );
    }

    public function test_a_parent_tenant_super_admin_searches_only_the_child_member_directory(): void
    {
        // The event team tab picks the member to add through this search.
        $suffix = Str::lower(Str::random(6));
        $childMember = $this->user(self::CHILD, ['role' => 'member', 'first_name' => 'Dirsearch' . $suffix]);
        $parentMember = $this->user(self::PARENT, ['role' => 'member', 'first_name' => 'Dirsearch' . $suffix]);

        $response = $this->jwt('GET', '/api/v2/users?q=Dirsearch' . $suffix . '&limit=50&sort=name', $this->tenantSuperAdmin(self::PARENT), self::CHILD);

        $response->assertStatus(200);
        $ids = array_map(static fn ($row): int => (int) ($row['id'] ?? 0), (array) $response->json('data'));
        self::assertContains((int) $childMember->id, $ids);
        self::assertNotContains((int) $parentMember->id, $ids, 'Only the community acted in is searched.');

        // Read only.
        self::assertFalse(CrossTenantEntry::isManagementRequest('POST', 'api/v2/users'));
    }

    public function test_a_parent_tenant_super_admin_adds_a_child_event_team_member(): void
    {
        $eventId = $this->childEvent();
        $helper = $this->user(self::CHILD, ['role' => 'member']);

        $response = $this->jwt('POST', "/api/v2/events/{$eventId}/staff", $this->tenantSuperAdmin(self::PARENT), self::CHILD, [
            'user_id' => (int) $helper->id,
            'role' => 'co_organizer',
        ]);

        self::assertNotSame('TENANT_MISMATCH', $response->json('errors.0.code'));
        self::assertLessThan(300, $response->status(), (string) $response->getContent());
        self::assertTrue(
            DB::table('event_staff_assignments')->where('event_id', $eventId)->where('user_id', $helper->id)->exists(),
            'The team member is recorded on the child community\'s event.'
        );
    }

    /**
     * @return array<string, array{0:string,1:string}>
     */
    public static function participationActions(): array
    {
        return [
            'rsvp' => ['POST', '/rsvp'],
            'join waitlist' => ['POST', '/waitlist'],
            'confirm own registration' => ['POST', '/registration/confirm'],
            'own reminders' => ['PUT', '/reminders'],
            'acknowledge code of conduct' => ['POST', '/safety/code-of-conduct/acknowledgements'],
            'own registration form' => ['POST', '/registration-product/submissions'],
            'own calendar file' => ['GET', '/calendar.ics'],
        ];
    }

    /** @dataProvider participationActions */
    public function test_a_parent_tenant_super_admin_cannot_take_part_in_a_child_event_as_a_member(string $method, string $suffix): void
    {
        $eventId = $this->childEvent();

        $response = $this->jwt($method, "/api/v2/events/{$eventId}{$suffix}", $this->tenantSuperAdmin(self::PARENT), self::CHILD);

        $response->assertStatus(403);
        self::assertSame('TENANT_MISMATCH', $response->json('errors.0.code'));
    }

    /**
     * Organiser changes whose records the database cannot attribute to an
     * account from another community. Refused cleanly at the door — never a
     * half-done write or a server error.
     *
     * @return array<string, array{0:string,1:string}>
     */
    public static function organiserWritesNotAdmitted(): array
    {
        return [
            'cancel the event' => ['POST', '/cancel'],
            'edit the event' => ['PUT', ''],
            'send a broadcast' => ['POST', '/broadcasts'],
            'view analytics (writes an access audit)' => ['GET', '/analytics'],
            'create a ticket type' => ['POST', '/ticket-types'],
            'federation status (not yet checked for a visitor)' => ['GET', '/federation-status'],
            'own relationship to the event' => ['GET', '/relationship'],
        ];
    }

    /** @dataProvider organiserWritesNotAdmitted */
    public function test_a_parent_tenant_super_admin_is_refused_organiser_changes_the_database_cannot_record(string $method, string $suffix): void
    {
        $eventId = $this->childEvent();

        $response = $this->jwt($method, "/api/v2/events/{$eventId}{$suffix}", $this->tenantSuperAdmin(self::PARENT), self::CHILD);

        $response->assertStatus(403);
        self::assertSame('TENANT_MISMATCH', $response->json('errors.0.code'));
    }

    public function test_a_sibling_tenant_super_admin_cannot_open_the_child_event_team(): void
    {
        $eventId = $this->childEvent();

        $response = $this->jwt('GET', "/api/v2/events/{$eventId}/staff", $this->tenantSuperAdmin(self::SIBLING), self::CHILD);

        $response->assertStatus(403);
        self::assertSame('TENANT_MISMATCH', $response->json('errors.0.code'));
    }

    public function test_a_plain_parent_admin_cannot_open_the_child_event_team(): void
    {
        $eventId = $this->childEvent();
        $admin = $this->user(self::PARENT, ['role' => 'admin', 'is_admin' => 1]);

        $response = $this->jwt('GET', "/api/v2/events/{$eventId}/staff", $admin, self::CHILD);

        $response->assertStatus(403);
        self::assertSame('TENANT_MISMATCH', $response->json('errors.0.code'));
    }

    public function test_the_child_tenant_super_admin_cannot_manage_upwards(): void
    {
        $response = $this->jwt('GET', '/api/v2/events/1/staff', $this->tenantSuperAdmin(self::CHILD), self::PARENT);

        $response->assertStatus(403);
        self::assertSame('TENANT_MISMATCH', $response->json('errors.0.code'));
    }

    public function test_the_organiser_path_list_is_exact(): void
    {
        foreach ([
            ['GET', 'api/v2/events/{id}'],
            ['GET', 'api/v2/events/{id}/staff'],
            ['POST', 'api/v2/events/{id}/staff'],
            ['DELETE', 'api/v2/events/{id}/staff/{assignmentId}'],
            ['GET', 'api/v2/events/{eventId}/broadcasts'],
            ['GET', 'api/v2/events/{id}/people/{userId}/history'],
            ['GET', 'api/v2/events/55/lifecycle-history'],
            ['GET', 'api/v2/events/55/people/9/history'],
        ] as [$method, $path]) {
            self::assertTrue(CrossTenantEntry::isManagementRequest($method, $path), "{$method} {$path} is an organiser tool.");
        }

        foreach ([
            // Organiser writes the database cannot record for an account from
            // another community (composite actor foreign keys) — not admitted.
            ['PUT', 'api/v2/events/{id}'],
            ['DELETE', 'api/v2/events/{id}'],
            ['POST', 'api/v2/events/{id}/cancel'],
            ['POST', 'api/v2/events/{id}/people/{userId}/approve'],
            ['POST', 'api/v2/events/{id}/attendees/{attendeeId}/check-in'],
            ['POST', 'api/v2/events/{eventId}/broadcasts'],
            ['POST', 'api/v2/events/{id}/ticket-types'],
            ['GET', 'api/v2/events/{id}/analytics'],
            ['GET', 'api/v2/events/{id}/tickets/reconciliation'],
            ['POST', 'api/v2/events/{id}/registration-product/submissions/export'],
            // Taking part.
            ['POST', 'api/v2/events/{id}/rsvp'],
            ['DELETE', 'api/v2/events/{id}/rsvp'],
            ['POST', 'api/v2/events/{id}/waitlist'],
            ['POST', 'api/v2/events/{id}/tickets/{ticketTypeId}/allocate'],
            ['POST', 'api/v2/events/{id}/tickets/{ticketTypeId}/quote'],
            ['POST', 'api/v2/events/{id}/registration-product/submissions'],
            ['POST', 'api/v2/events/{id}/registration-product/submissions/{submissionId}/submit'],
            ['POST', 'api/v2/events/{id}/registration-product/invitations/accept'],
            ['GET', 'api/v2/events/{id}/offline-checkin/credentials/me'],
            ['GET', 'api/v2/events/{id}/calendar.ics'],
            ['POST', 'api/v2/events'],
            ['GET', 'api/v2/events'],
            ['POST', 'api/v2/events/{id}'],
            ['GET', 'api/v2/events/{id}/staff/'],
            ['GET', 'api/v2/events/{id}/../wallet'],
            ['GET', 'api/v2/events/abc/staff'],
            ['GET', 'api/v2/events/{id}/staff/extra'],
            ['POST', 'api/v2/wallet/transfer'],
        ] as [$method, $path]) {
            self::assertFalse(CrossTenantEntry::isManagementRequest($method, $path), "{$method} {$path} is not an organiser tool.");
        }

        // The admin surface and the identity read are still management requests.
        self::assertTrue(CrossTenantEntry::isManagementRequest('GET', 'api/v2/admin/users'));
        self::assertTrue(CrossTenantEntry::isManagementRequest('GET', 'api/v2/users/me'));
        self::assertFalse(CrossTenantEntry::isManagementRequest('PUT', 'api/v2/users/me'));
    }

    public function test_a_ticket_is_never_given_to_an_account_from_a_community_above(): void
    {
        // The organiser may manage from above; the recipient must belong here.
        $tsa = $this->tenantSuperAdmin(self::PARENT);
        $childMember = $this->user(self::CHILD, ['role' => 'member']);
        $support = app(\App\Support\Events\EventTicketingSupport::class);

        self::assertSame((int) $childMember->id, (int) $support->member(self::CHILD, (int) $childMember->id)->id);

        $this->expectException(\App\Exceptions\EventTicketingException::class);
        $support->member(self::CHILD, (int) $tsa->id);
    }

    // ------------------------------------------------ keeping the session below

    public function test_a_parent_tenant_super_admin_refreshes_its_session_in_a_child_community(): void
    {
        $tsa = $this->tenantSuperAdmin(self::PARENT);

        $response = $this->refresh($tsa, self::CHILD);

        $response->assertStatus(200);
        self::assertNotEmpty($response->json('access_token') ?? $response->json('data.access_token'));
    }

    public function test_a_plain_parent_member_cannot_refresh_its_session_in_a_child_community(): void
    {
        $this->refresh($this->user(self::PARENT, ['role' => 'member']), self::CHILD)->assertStatus(401);
    }

    public function test_a_plain_parent_admin_cannot_refresh_its_session_in_a_child_community(): void
    {
        $this->refresh($this->user(self::PARENT, ['role' => 'admin', 'is_admin' => 1]), self::CHILD)->assertStatus(401);
    }

    public function test_a_sibling_tenant_super_admin_cannot_refresh_its_session_in_the_child(): void
    {
        $this->refresh($this->tenantSuperAdmin(self::SIBLING), self::CHILD)->assertStatus(401);
    }

    public function test_the_child_tenant_super_admin_cannot_refresh_its_session_upwards(): void
    {
        $this->refresh($this->tenantSuperAdmin(self::CHILD), self::PARENT)->assertStatus(401);
    }

    public function test_the_platform_owner_refreshes_its_session_in_any_community(): void
    {
        $owner = $this->user(self::SIBLING, ['role' => 'admin', 'is_admin' => 1, 'is_super_admin' => 1]);

        $this->refresh($owner, self::CHILD)->assertStatus(200);
    }

    // ------------------------------------------------ signing in below

    public function test_a_parent_tenant_super_admin_signs_in_on_a_child_community_page(): void
    {
        $tsa = $this->tenantSuperAdmin(self::PARENT);

        $response = $this->login($tsa, self::CHILD);

        self::assertSame(200, $response->status(), (string) $response->getContent());
        self::assertSame((int) $tsa->id, $this->signedInUserId($response), 'The parent\'s account is the one signed in.');
    }

    public function test_a_plain_parent_admin_cannot_sign_in_on_a_child_community_page(): void
    {
        $this->login($this->user(self::PARENT, ['role' => 'admin', 'is_admin' => 1]), self::CHILD)->assertStatus(401);
    }

    public function test_a_parent_broker_with_a_stray_flag_cannot_sign_in_on_a_child_community_page(): void
    {
        $this->login($this->user(self::PARENT, ['role' => 'broker', 'is_tenant_super_admin' => 1]), self::CHILD)->assertStatus(401);
    }

    public function test_a_sibling_tenant_super_admin_cannot_sign_in_on_the_child_page(): void
    {
        $this->login($this->tenantSuperAdmin(self::SIBLING), self::CHILD)->assertStatus(401);
    }

    // ------------------------------------------------------------- helpers

    /** @param array<string,mixed> $body */
    private function jwt(string $method, string $uri, User $actor, int $tenantId, array $body = []): TestResponse
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
            'X-Tenant-ID' => (string) $tenantId,
            'Accept' => 'application/json',
            'Authorization' => 'Bearer ' . $token,
        ])->json($method, $uri, $body);
    }

    private function refresh(User $actor, int $tenantId): TestResponse
    {
        // Carries second-factor assurance, so an admin's refusal can only come
        // from the community rule, never from the two-factor policy.
        $refresh = app(TokenService::class)->generateRefreshToken(
            (int) $actor->id,
            (int) $actor->tenant_id,
            null,
            TwoFactorPolicy::claims('totp'),
        );

        TenantContext::reset();
        unset($_SERVER['HTTP_X_TENANT_ID'], $_SERVER['HTTP_X_TENANT_SLUG']);
        app('auth')->forgetGuards();

        return $this->withHeaders(['X-Tenant-ID' => (string) $tenantId, 'Accept' => 'application/json'])
            ->postJson('/api/auth/refresh-token', ['refresh_token' => $refresh]);
    }

    private function login(User $actor, int $tenantId): TestResponse
    {
        TenantContext::reset();
        unset($_SERVER['HTTP_X_TENANT_ID'], $_SERVER['HTTP_X_TENANT_SLUG']);
        app('auth')->forgetGuards();

        return $this->withHeaders(['X-Tenant-ID' => (string) $tenantId, 'Accept' => 'application/json'])
            ->postJson('/api/auth/login', ['email' => $actor->email, 'password' => 'password']);
    }

    private function signedInUserId(TestResponse $response): int
    {
        return (int) ($response->json('user.id') ?? $response->json('data.user.id') ?? $response->json('user_id') ?? $response->json('data.user_id') ?? 0);
    }

    private function childEvent(): int
    {
        $organizer = $this->user(self::CHILD, ['role' => 'member']);
        $start = now()->addDays(3);

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => self::CHILD,
            'user_id' => (int) $organizer->id,
            'title' => 'Manages-below fixture',
            'description' => 'Manages-below fixture.',
            'occurrence_key' => 'mb:' . self::CHILD . ':' . bin2hex(random_bytes(8)),
            'start_time' => $start,
            'end_time' => $start->copy()->addHours(2),
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'is_recurring_template' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function tenantSuperAdmin(int $tenantId): User
    {
        return $this->user($tenantId, ['role' => 'admin', 'is_admin' => 1, 'is_tenant_super_admin' => 1]);
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
            'email_verified_at' => now(),
            ...$attributes,
        ]);
        if ($current !== null) {
            TenantContext::setById($current);
        }

        return $user;
    }
}
