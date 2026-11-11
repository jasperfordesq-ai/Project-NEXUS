<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Support\Names;

use App\Core\TenantContext;
use App\Http\Middleware\EnsureIsAdmin;
use App\Http\Middleware\EnsureIsBrokerOrAdmin;
use App\Http\Middleware\EnsureIsSuperAdmin;
use App\Http\Middleware\EnsureIsTenantSuperAdmin;
use App\Models\User;
use App\Support\Members\MemberProfileVisibility;
use App\Support\Names\NameAudience;
use App\Support\Names\NameReason;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * E-122 — who may see surnames.
 *
 * Owner rule, 10 November 2026: "No surnames should be anywhere on the site
 * apart from for admins", and, asked about brokers and coordinators: "Brokers
 * too" — in their own community.
 *
 * These tests pin the DECISION. It is asked whether or not the switch
 * (`names.surname_audience_enforced`) is on; the switch only decides whether
 * the name helpers act on the answer, which UserDisplayNameAudienceTest pins.
 */
class NameAudienceTest extends TestCase
{
    use DatabaseTransactions;

    private const OTHER_COMMUNITY = 999;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
    }

    // E-122 stage 4 (owner, 10 Nov 2026: "Yes, switch it on"): this test pinned
    // the switch OFF while the rule was being built; it now pins it ON.
    public function test_the_switch_is_on(): void
    {
        $this->assertTrue(
            config(NameAudience::CONFIG_KEY),
            'E-122 stage 4 turned the surname rule on. Turning it off again is a reviewed revert, not a setting.'
        );
        $this->assertTrue(NameAudience::enforced());
    }

    /**
     * @return array<string, array{0: array<string, mixed>, 1: int, 2: bool}>
     */
    public static function viewers(): array
    {
        return [
            // who => [account, home community, may see surnames in community 2]
            'ordinary member of the community' => [['role' => 'member'], 2, false],
            'admin of the community (role)' => [['role' => 'admin'], 2, true],
            'tenant_admin of the community (role)' => [['role' => 'tenant_admin'], 2, true],
            'admin of the community (flag only)' => [['role' => 'member', 'is_admin' => 1], 2, true],
            'tenant super admin of the community' => [['role' => 'member', 'is_tenant_super_admin' => 1], 2, true],
            'broker of the community' => [['role' => 'broker'], 2, true],
            'coordinator of the community' => [['role' => 'coordinator'], 2, true],
            'broker of ANOTHER community' => [['role' => 'broker'], self::OTHER_COMMUNITY, false],
            'coordinator of ANOTHER community' => [['role' => 'coordinator'], self::OTHER_COMMUNITY, false],
            'admin of ANOTHER community' => [['role' => 'admin'], self::OTHER_COMMUNITY, false],
            'tenant super admin of ANOTHER community' => [['role' => 'member', 'is_tenant_super_admin' => 1], self::OTHER_COMMUNITY, false],
            'platform super admin from another community' => [['role' => 'member', 'is_super_admin' => 1], self::OTHER_COMMUNITY, true],
            'god from another community' => [['role' => 'member', 'is_god' => 1, 'is_super_admin' => 1], self::OTHER_COMMUNITY, true],
            'broker of another community with a stale platform flag' => [['role' => 'broker', 'is_super_admin' => 1], self::OTHER_COMMUNITY, false],
            'suspended admin' => [['role' => 'admin', 'status' => 'suspended'], 2, false],
            'unapproved broker' => [['role' => 'broker', 'is_approved' => false], 2, false],
        ];
    }

    /** @param array<string, mixed> $account */
    #[DataProvider('viewers')]
    public function test_who_may_see_surnames_in_the_community(array $account, int $homeCommunity, bool $expected): void
    {
        $viewer = $this->person($account, $homeCommunity);

        $this->assertSame(
            $expected,
            MemberProfileVisibility::viewerSeesSurnamesOf((int) $viewer->id, $this->testTenantId),
            'The rule itself.'
        );

        Sanctum::actingAs($viewer, ['*']);
        TenantContext::setById($this->testTenantId);

        $this->assertSame($expected, NameAudience::allowsSurnames(), 'The audience, for the signed-in viewer.');
    }

    public function test_brokers_widen_the_surname_rule_but_not_the_administrator_rule(): void
    {
        $broker = $this->person(['role' => 'broker']);

        $this->assertTrue(MemberProfileVisibility::viewerSeesSurnamesOf((int) $broker->id, $this->testTenantId));
        $this->assertFalse(
            MemberProfileVisibility::viewerIsAdmin((int) $broker->id),
            'viewerIsAdmin() gates far more than names (privacy bypasses, exact coordinates). A broker is not an admin.'
        );
    }

    public function test_no_viewer_means_no_surnames(): void
    {
        $member = $this->person();

        $this->assertNull(Auth::id());
        $this->assertFalse(NameAudience::allowsSurnames());
        $this->assertFalse(NameAudience::allowsSurnameOf((int) $member->id));
        $this->assertFalse(NameAudience::allowsSurnameOf(null));
    }

    public function test_a_member_may_see_their_own_surname_and_nobody_elses(): void
    {
        $me = $this->person();
        $other = $this->person();
        Sanctum::actingAs($me, ['*']);
        TenantContext::setById($this->testTenantId);

        $this->assertFalse(NameAudience::allowsSurnames());
        $this->assertTrue(NameAudience::allowsSurnameOf((int) $me->id));
        $this->assertFalse(NameAudience::allowsSurnameOf((int) $other->id));
        $this->assertFalse(NameAudience::allowsSurnameOf(null));
        $this->assertFalse(NameAudience::allowsSurnameOf(0));
    }

    public function test_an_explicit_full_name_scope_allows_surnames_and_is_closed_afterwards(): void
    {
        $this->assertFalse(NameAudience::allowsSurnames());

        $inside = NameAudience::withFullNames(NameReason::LEGAL_RECORD, static fn (): bool => NameAudience::allowsSurnames());

        $this->assertTrue($inside);
        $this->assertFalse(NameAudience::allowsSurnames());
    }

    public function test_a_public_scope_beats_an_admin_a_route_grant_and_the_viewers_own_name(): void
    {
        $admin = $this->person(['role' => 'admin']);
        Sanctum::actingAs($admin, ['*']);
        TenantContext::setById($this->testTenantId);
        NameAudience::grantForCurrentRequest(NameReason::ADMIN_ROUTE);
        $this->assertTrue(NameAudience::allowsSurnames());

        [$others, $own] = NameAudience::withPublicNames(static fn (): array => [
            NameAudience::allowsSurnames(),
            NameAudience::allowsSurnameOf((int) $admin->id),
        ]);

        $this->assertFalse($others, 'Output for another community, a channel or a cache is public whoever asks for it.');
        $this->assertFalse($own);
        $this->assertTrue(NameAudience::allowsSurnames());
    }

    public function test_scopes_nest_and_the_innermost_decides(): void
    {
        $seen = NameAudience::withPublicNames(static function (): array {
            $inner = NameAudience::withFullNames(NameReason::AUDIT_LOG, static fn (): bool => NameAudience::allowsSurnames());

            return [$inner, NameAudience::allowsSurnames()];
        });

        $this->assertSame([true, false], $seen);
    }

    public function test_a_scope_is_closed_when_the_code_inside_it_throws(): void
    {
        try {
            NameAudience::withFullNames(NameReason::AUDIT_LOG, static function (): void {
                throw new \RuntimeException('boom');
            });
            $this->fail('The exception must reach the caller.');
        } catch (\RuntimeException $e) {
            $this->assertSame('boom', $e->getMessage());
        }

        $this->assertFalse(NameAudience::allowsSurnames(), 'A scope left open would hand full names to whatever runs next in this process.');
    }

    public function test_a_recipient_scope_follows_the_recipient_not_the_http_caller(): void
    {
        $admin = $this->person(['role' => 'admin']);
        $member = $this->person();
        $broker = $this->person(['role' => 'broker']);
        $brokerElsewhere = $this->person(['role' => 'broker'], self::OTHER_COMMUNITY);

        // An admin's request raising a notification for an ordinary member.
        Sanctum::actingAs($admin, ['*']);
        TenantContext::setById($this->testTenantId);
        $this->assertTrue(NameAudience::allowsSurnames());
        $forMember = NameAudience::forRecipient((int) $member->id, static fn (): array => [
            NameAudience::allowsSurnames(),
            NameAudience::allowsSurnameOf((int) $member->id),
            NameAudience::allowsSurnameOf((int) $admin->id),
        ]);
        $this->assertSame(
            [false, true, false],
            $forMember,
            'The member sees first names, their own surname, and NOT the surname of the admin who triggered it.'
        );

        // A member's request raising an alert for staff.
        Sanctum::actingAs($member, ['*']);
        TenantContext::setById($this->testTenantId);
        $this->assertFalse(NameAudience::allowsSurnames());
        $this->assertTrue(NameAudience::forRecipient($broker, static fn (): bool => NameAudience::allowsSurnames()));
        $this->assertTrue(NameAudience::forRecipient(['id' => $admin->id], static fn (): bool => NameAudience::allowsSurnames()));
        $this->assertFalse(NameAudience::forRecipient($brokerElsewhere, static fn (): bool => NameAudience::allowsSurnames()));

        // Nobody to render for.
        Sanctum::actingAs($admin, ['*']);
        TenantContext::setById($this->testTenantId);
        $this->assertFalse(NameAudience::forRecipient(null, static fn (): bool => NameAudience::allowsSurnames()));
        $this->assertFalse(NameAudience::forRecipient(new \stdClass(), static fn (): bool => NameAudience::allowsSurnames()));
    }

    public function test_opening_a_recipient_scope_costs_no_query_until_a_name_is_built(): void
    {
        $member = $this->person();

        DB::flushQueryLog();
        DB::enableQueryLog();
        NameAudience::forRecipient((int) $member->id, static fn (): int => 1);
        $unused = count(DB::getQueryLog());

        NameAudience::forRecipient((int) $member->id, static function (): void {
            NameAudience::allowsSurnames();
            NameAudience::allowsSurnames();
            NameAudience::allowsSurnames();
        });
        $used = count(DB::getQueryLog()) - $unused;
        DB::disableQueryLog();

        $this->assertSame(0, $unused, 'Staff emails open this scope for every recipient; it must be free when no name is built.');
        $this->assertSame(1, $used, 'Decided once per scope, not once per name.');
    }

    public function test_a_tenant_super_admin_below_its_own_community_needs_the_admin_gate(): void
    {
        // Open owner question: on the member side of a community below its
        // own, a tenant super admin is a visitor and gets first names. On that
        // community's admin screens the gate has let it in, so it gets full
        // names there.
        $manager = $this->person(['role' => 'member', 'is_tenant_super_admin' => 1], self::OTHER_COMMUNITY);
        Sanctum::actingAs($manager, ['*']);
        TenantContext::setById($this->testTenantId);

        $this->assertFalse(NameAudience::allowsSurnames());

        NameAudience::grantForCurrentRequest(NameReason::ADMIN_ROUTE);

        $this->assertTrue(NameAudience::allowsSurnames());
    }

    /**
     * @return array<string, array{0: class-string, 1: array<string, mixed>, 2: bool}>
     */
    public static function gates(): array
    {
        return [
            'admin gate, admin' => [EnsureIsAdmin::class, ['role' => 'admin'], true],
            'admin gate, member' => [EnsureIsAdmin::class, ['role' => 'member'], false],
            'admin gate, broker' => [EnsureIsAdmin::class, ['role' => 'broker'], false],
            'broker-or-admin gate, broker' => [EnsureIsBrokerOrAdmin::class, ['role' => 'broker'], true],
            'broker-or-admin gate, coordinator' => [EnsureIsBrokerOrAdmin::class, ['role' => 'coordinator'], true],
            'broker-or-admin gate, admin' => [EnsureIsBrokerOrAdmin::class, ['role' => 'admin'], true],
            'broker-or-admin gate, member' => [EnsureIsBrokerOrAdmin::class, ['role' => 'member'], false],
            'super-admin gate, platform super admin' => [EnsureIsSuperAdmin::class, ['role' => 'member', 'is_super_admin' => 1], true],
            'super-admin gate, tenant super admin' => [EnsureIsSuperAdmin::class, ['role' => 'member', 'is_tenant_super_admin' => 1], false],
            'tenant-super-admin gate, tenant super admin' => [EnsureIsTenantSuperAdmin::class, ['role' => 'member', 'is_tenant_super_admin' => 1], true],
            'tenant-super-admin gate, admin' => [EnsureIsTenantSuperAdmin::class, ['role' => 'admin'], false],
        ];
    }

    /**
     * A gate grants full names for the request only when it lets the caller
     * through. The viewer here belongs to ANOTHER community, so the answer
     * can only come from the grant, never from the viewer rule.
     *
     * @param class-string $gate
     * @param array<string, mixed> $account
     */
    #[DataProvider('gates')]
    public function test_a_gate_grants_full_names_only_on_its_success_path(string $gate, array $account, bool $passes): void
    {
        $caller = $this->person($account, self::OTHER_COMMUNITY);
        $caller->refresh();
        TenantContext::setById($this->testTenantId);

        $request = Request::create('/api/v2/admin/e122-probe', 'GET');
        // Binding the request resets its user resolver, so set ours afterwards.
        $this->app->instance('request', $request);
        $request->setUserResolver(static fn () => $caller);

        $reached = null;
        $response = (new $gate())->handle($request, static function () use (&$reached) {
            $reached = NameAudience::allowsSurnames();

            return response('ok');
        });

        if ($passes) {
            $this->assertSame(200, $response->getStatusCode());
            $this->assertTrue($reached, 'A caller the gate admits sees full names on that screen.');
        } else {
            $this->assertNotSame(200, $response->getStatusCode());
            $this->assertNull($reached);
            $this->assertFalse(NameAudience::allowsSurnames(), 'A refused request must not leave a grant behind.');
        }
    }

    public function test_the_viewers_answer_is_memoised_per_routed_request_and_never_beyond_it(): void
    {
        $viewer = $this->person(['role' => 'broker']);
        Sanctum::actingAs($viewer, ['*']);
        TenantContext::setById($this->testTenantId);

        $first = $this->routedRequest();
        DB::flushQueryLog();
        DB::enableQueryLog();
        for ($i = 0; $i < 25; $i++) {
            $this->assertTrue(NameAudience::allowsSurnames());
        }
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();
        $this->assertSame(1, $queries, 'One lookup per request, however many names the response builds.');

        // The account is demoted between two requests in one process (as in a
        // feature test, a queue worker or Octane).
        DB::table('users')->where('id', $viewer->id)->update(['role' => 'member']);

        $this->assertTrue(NameAudience::allowsSurnames(), 'Within the same request the answer is the one already given.');

        $second = $this->routedRequest();
        $this->assertNotSame($first, $second);
        $this->assertFalse(NameAudience::allowsSurnames(), 'A new request asks again.');
    }

    public function test_nothing_is_memoised_outside_a_routed_request(): void
    {
        $viewer = $this->person(['role' => 'broker']);
        Sanctum::actingAs($viewer, ['*']);
        TenantContext::setById($this->testTenantId);

        // A console command or queue job: a Request is bound but no route is
        // being served, and that Request can live as long as the process.
        $request = Request::create('/', 'GET');
        $this->app->instance('request', $request);

        $this->assertTrue(NameAudience::allowsSurnames());

        DB::table('users')->where('id', $viewer->id)->update(['role' => 'member']);

        $this->assertFalse(NameAudience::allowsSurnames());
        $this->assertSame([], $request->attributes->all(), 'Nothing may be left on a long-lived request.');
    }

    public function test_the_memo_is_per_viewer_and_per_community(): void
    {
        $broker = $this->person(['role' => 'broker']);
        $member = $this->person();
        $this->routedRequest();

        Sanctum::actingAs($broker, ['*']);
        TenantContext::setById($this->testTenantId);
        $this->assertTrue(NameAudience::allowsSurnames());

        // Same request object, a different community resolved (a manager
        // entering a community below its own switches TenantContext).
        TenantContext::setById(self::OTHER_COMMUNITY);
        $this->assertFalse(NameAudience::allowsSurnames(), 'A broker of community 2 is a visitor in community 999.');

        TenantContext::setById($this->testTenantId);
        Sanctum::actingAs($member, ['*']);
        TenantContext::setById($this->testTenantId);
        $this->assertFalse(NameAudience::allowsSurnames(), "One viewer's answer is never another's.");
    }

    // ------------------------------------------------------------------

    private function routedRequest(): Request
    {
        $request = Request::create('/api/v2/e122-probe', 'GET');
        $request->setRouteResolver(static fn (): Route => new Route('GET', '/api/v2/e122-probe', static fn () => null));
        $this->app->instance('request', $request);

        return $request;
    }

    /** @param array<string, mixed> $overrides */
    private function person(array $overrides = [], ?int $tenantId = null): User
    {
        $user = User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
