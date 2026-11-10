<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E122;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use App\Support\Names\NameAudience;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\Concerns\MakesNetworkAdminHierarchy;
use Tests\Laravel\TestCase;

/**
 * E-122 stages 2–3 — the central surname rule over real routes.
 *
 * Owner rule, 10 November 2026: "No surnames should be anywhere on the site
 * apart from for admins" ("Brokers too").
 *
 * The rule ships behind `config('names.surname_audience_enforced')`, which is
 * OFF. With it off every response is what it was before (the first test, and
 * SurnameSweepTest with its untouched baseline). The rest force it ON in the
 * test only, to prove — before stage 4 turns it on for real — that:
 *
 *  - a member-facing route then shows first names to a member and full names
 *    to staff of the community;
 *  - 🔴 the member's OWN account and profile still carry their surname. If
 *    they did not, an edit-profile form prefilled from them could save an
 *    empty surname over the real one;
 *  - the admin and broker screens still show surnames, including to a tenant
 *    super admin working in a community below its own.
 */
class SurnameSwitchTest extends TestCase
{
    use DatabaseTransactions;
    use MakesNetworkAdminHierarchy;

    private const FIRST = 'Zqxfirstposter';
    private const LAST = 'Zqxsurnameposter';
    private const SELF_FIRST = 'Zqxfirstself';
    private const SELF_LAST = 'Zqxsurnameself';

    private const PARENT_COMMUNITY = 999;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        Cache::flush();
        TenantContext::setById($this->testTenantId);
    }

    protected function tearDown(): void
    {
        unset($_SERVER['HTTP_AUTHORIZATION'], $_SERVER['HTTP_X_TENANT_ID'], $_SERVER['HTTP_X_TENANT_SLUG']);
        parent::tearDown();
    }

    // ------------------------------------------------------------------
    // Switch off, as shipped
    // ------------------------------------------------------------------

    public function test_as_shipped_the_switch_is_off_and_a_member_facing_route_is_unchanged(): void
    {
        $this->assertFalse(NameAudience::enforced());

        $pollId = $this->pollBy($this->poster());
        $this->signInAs($this->person());

        $poll = $this->apiGet("/v2/polls/{$pollId}")->assertStatus(200)->json('data');

        // Today's behaviour (a known leak in the sweep baseline), untouched by
        // stages 2 and 3.
        $this->assertSame(self::FIRST . ' ' . self::LAST, $poll['creator']['name']);
        $this->assertSame(self::FIRST . ' ' . self::LAST, $poll['user']['name']);
    }

    // ------------------------------------------------------------------
    // Switch forced on: a member-facing route
    // ------------------------------------------------------------------

    public function test_switched_on_a_member_sees_first_names_on_a_member_facing_route(): void
    {
        $pollId = $this->pollBy($this->poster());
        $this->switchOn();
        $this->signInAs($this->person());

        $response = $this->apiGet("/v2/polls/{$pollId}")->assertStatus(200);

        $this->assertSame(self::FIRST, $response->json('data.creator.name'));
        $this->assertSame(self::FIRST, $response->json('data.user.name'));
        $this->assertStringNotContainsString(self::LAST, (string) $response->getContent());
    }

    /**
     * @return array<string, array{0: array<string, mixed>}>
     */
    public static function staffOfTheCommunity(): array
    {
        return [
            'admin' => [['role' => 'admin']],
            'broker' => [['role' => 'broker']],
            'coordinator' => [['role' => 'coordinator']],
        ];
    }

    /** @param array<string, mixed> $staff */
    #[DataProvider('staffOfTheCommunity')]
    public function test_switched_on_staff_of_the_community_see_full_names_on_a_member_facing_route(array $staff): void
    {
        $pollId = $this->pollBy($this->poster());
        $this->switchOn();
        $this->signInAs($this->person($staff));

        $response = $this->apiGet("/v2/polls/{$pollId}")->assertStatus(200);

        $this->assertSame(self::FIRST . ' ' . self::LAST, $response->json('data.creator.name'));
    }

    public function test_switched_on_the_author_still_sees_their_own_full_name_on_their_own_content(): void
    {
        $poster = $this->poster();
        $pollId = $this->pollBy($poster);
        $this->switchOn();
        $this->signInAs($poster);

        $response = $this->apiGet("/v2/polls/{$pollId}")->assertStatus(200);

        $this->assertSame(self::FIRST . ' ' . self::LAST, $response->json('data.creator.name'));
    }

    // ------------------------------------------------------------------
    // Switch forced on: the erasure guard
    // ------------------------------------------------------------------

    /**
     * @return array<string, array{0: bool}>
     */
    public static function switchStates(): array
    {
        return ['switch off (as shipped)' => [false], 'switch forced on' => [true]];
    }

    #[DataProvider('switchStates')]
    public function test_a_members_own_account_and_profile_always_carry_their_surname(bool $on): void
    {
        $me = $this->me();
        if ($on) {
            $this->switchOn();
        }
        $this->signInAs($me);

        foreach (['/v2/users/me', '/v2/users/' . $me->id] as $uri) {
            $response = $this->apiGet($uri)->assertStatus(200);

            $this->assertSame(self::SELF_LAST, $response->json('data.last_name'), "GET {$uri} must return the member's own last_name.");
            $this->assertSame(self::SELF_FIRST, $response->json('data.first_name'));
            $this->assertSame(self::SELF_FIRST . ' ' . self::SELF_LAST, $response->json('data.name'));
        }
    }

    #[DataProvider('switchStates')]
    public function test_saving_the_profile_returns_and_keeps_the_members_own_surname(bool $on): void
    {
        $me = $this->me();
        if ($on) {
            $this->switchOn();
        }
        $this->signInAs($me);

        // An edit screen that sends only what it changed.
        $response = $this->apiPut('/v2/users/me', ['bio' => 'E-122 switch test'])->assertStatus(200);

        $this->assertSame(self::SELF_LAST, $response->json('data.last_name'), 'The saved profile is what the form is refilled from.');
        $this->assertSame(self::SELF_FIRST . ' ' . self::SELF_LAST, $response->json('data.name'));
        $this->assertSame(self::SELF_LAST, $this->storedSurname($me), 'A save that does not mention last_name leaves it alone.');

        // An edit screen that posts the whole profile back as it received it.
        $prefill = (array) $this->apiGet('/v2/users/me')->assertStatus(200)->json('data');
        $this->assertArrayHasKey('last_name', $prefill);
        $this->apiPut('/v2/users/me', [
            'first_name' => $prefill['first_name'],
            'last_name' => $prefill['last_name'],
            'bio' => 'E-122 round trip',
        ])->assertStatus(200);

        $this->assertSame(self::SELF_LAST, $this->storedSurname($me), 'A round trip through the edit form keeps the surname.');
    }

    public function test_switched_on_another_members_profile_shows_no_surname_to_a_member(): void
    {
        $poster = $this->poster();
        $this->switchOn();
        $this->signInAs($this->me());

        $response = $this->apiGet('/v2/users/' . $poster->id)->assertStatus(200);

        $this->assertSame(self::FIRST, $response->json('data.name'));
        $this->assertStringNotContainsString(self::LAST, (string) $response->getContent());
    }

    // ------------------------------------------------------------------
    // Switch forced on: the staff screens
    // ------------------------------------------------------------------

    /** @param array<string, mixed> $staff */
    #[DataProvider('staffOfTheCommunity')]
    public function test_switched_on_the_staff_member_list_still_shows_surnames(array $staff): void
    {
        $poster = $this->poster();
        $this->switchOn();
        $this->signInAs($this->person($staff));

        $list = $this->apiGet('/v2/admin/users?search=' . self::FIRST . '&per_page=100')->assertStatus(200);
        $this->assertStringContainsString(self::LAST, (string) $list->getContent());

        $detail = $this->apiGet('/v2/admin/users/' . $poster->id)->assertStatus(200);
        $this->assertStringContainsString(self::LAST, (string) $detail->getContent());
    }

    public function test_switched_on_a_tenant_super_admin_keeps_surnames_on_the_admin_screens_of_a_community_below(): void
    {
        $this->makeHomeTenantOversee(self::PARENT_COMMUNITY, $this->testTenantId);
        $poster = $this->poster();
        $manager = $this->person(
            ['role' => 'admin', 'is_admin' => 1, 'is_tenant_super_admin' => 1, 'email_verified_at' => now()],
            self::PARENT_COMMUNITY,
        );
        $this->switchOn();

        $list = $this->asBearer($manager, '/api/v2/admin/users?search=' . self::FIRST . '&per_page=100');

        $list->assertStatus(200);
        $this->assertStringContainsString(
            self::LAST,
            (string) $list->getContent(),
            'The admin gate let the manager into this community, so the panel shows it full names. Whether it should also see them on the member side there is an open owner question; today it does not.'
        );
        $this->assertSame($poster->id, collect($list->json('data'))->firstWhere('id', $poster->id)['id'] ?? null);
    }

    // ------------------------------------------------------------------

    private function switchOn(): void
    {
        config([NameAudience::CONFIG_KEY => true]);
    }

    private function signInAs(User $user): void
    {
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($this->testTenantId);
    }

    private function asBearer(User $actor, string $uri): TestResponse
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
            'X-Tenant-ID' => (string) $this->testTenantId,
            'Accept' => 'application/json',
            'Authorization' => 'Bearer ' . $token,
        ])->json('GET', $uri);
    }

    private function poster(): User
    {
        return $this->person([
            'first_name' => self::FIRST,
            'last_name' => self::LAST,
            'name' => self::FIRST . ' ' . self::LAST,
        ]);
    }

    private function me(): User
    {
        return $this->person([
            'first_name' => self::SELF_FIRST,
            'last_name' => self::SELF_LAST,
            'name' => self::SELF_FIRST . ' ' . self::SELF_LAST,
        ]);
    }

    private function pollBy(User $author): int
    {
        return (int) DB::table('polls')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $author->id,
            'question' => 'E-122 switch fixture ' . bin2hex(random_bytes(3)),
            'is_active' => 1,
            'created_at' => now(),
        ]);
    }

    private function storedSurname(User $user): ?string
    {
        return DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('id', $user->id)
            ->value('last_name');
    }

    /** @param array<string, mixed> $overrides */
    private function person(array $overrides = [], ?int $tenantId = null): User
    {
        $user = User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
