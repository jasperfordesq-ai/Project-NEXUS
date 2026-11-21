<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\Auth\ProviderSignInRefused;
use App\Services\Auth\SocialAuthService;
use App\Services\Auth\SsoLinkRequiredException;
use App\Services\Auth\SsoOidcService;
use App\Services\Identity\AdminCreatedAccountAdmission;
use App\Services\Identity\IdentityVerificationSessionService;
use App\Services\Identity\RegistrationOrchestrationService;
use App\Services\TenantBillingService;
use App\Services\TenantSettingsService;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use App\Support\Billing\BillingLock;
use App\Support\Billing\BillingSettings;
use App\Support\Billing\JoiningClosed;
use App\Support\Billing\JoiningGate;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * Every door "stop new members joining" closes (DESIGN 6.7), and the ones it
 * leaves open on purpose.
 *
 * Each closed door is refused at the limit, and opens below it, with the
 * automatic checks off, and under a rule other than `block_joining`.
 *
 * The shared test community (tenant 2) is the capped community for the
 * member-side and community-admin doors; a community made here is the capped
 * destination for the super admin's moves.
 */
final class JoiningClosedDoorsTest extends TestCase
{
    use DatabaseTransactions;
    use TellsCommunityOfMemberLimit;

    private const OPEN_STATES = [
        'below the limit' => ['below'],
        'automatic checks off' => ['switch_off'],
        'a rule other than block_joining' => ['other_rule'],
    ];

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        config(['mail.capture_recipient_domains' => ['nexus.test']]);
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        foreach (['127.0.0.1', '::1'] as $ip) {
            RateLimiter::clear("api:registration:ip:{$ip}");
            RateLimiter::clear("register_success_ip:{$ip}");
            RateLimiter::clear("api:reset_password:ip:{$ip}");
        }
        Cache::forget('register_tenant_breaker:' . $this->testTenantId);
        Cache::forget('register_tenant_hourly:' . $this->testTenantId);

        // An open community, so the only thing that can refuse is the gate.
        foreach (['general.registration_mode', 'registration_mode'] as $key) {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
                ['setting_value' => 'open', 'setting_type' => 'string', 'updated_at' => now()]
            );
        }
        DB::table('tenant_registration_policies')->where('tenant_id', $this->testTenantId)->delete();
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);

        BillingLock::flush();
        BillingSettings::flush();
        PlanTerms::flush();
        JoiningGate::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        // The shared test community is capped here: no cached "shut" may outlive it.
        try {
            JoiningGate::flush();
            BillingLock::flush();
            BillingSettings::flush();
            PlanTerms::flush();
        } finally {
            parent::tearDown();
        }
    }

    /** @return array<string, array{string}> */
    public static function openStates(): array
    {
        return self::OPEN_STATES;
    }

    // ================================================================
    // The public sign-up form — POST /v2/auth/register
    // ================================================================

    public function test_sign_up_form_is_refused_at_the_limit(): void
    {
        $this->limit($this->testTenantId, 'at');

        $r = $this->apiPost('/v2/auth/register', []);

        $r->assertStatus(403)->assertJsonPath('errors.0.code', JoiningGate::CODE);
        $this->assertSame(__('api.community_not_taking_members'), $r->json('errors.0.message'));
        $this->assertStringNotContainsStringIgnoringCase('plan', (string) $r->json('errors.0.message'));
    }

    #[DataProvider('openStates')]
    public function test_sign_up_form_is_open(string $state): void
    {
        $this->limit($this->testTenantId, $state);

        // An empty form: the gate lets it through, and validation answers.
        $r = $this->apiPost('/v2/auth/register', []);

        $this->assertNotSame(JoiningGate::CODE, $r->json('errors.0.code'), $r->getContent());
        $this->assertContains($r->getStatusCode(), [400, 422]);
    }

    // ================================================================
    // Signing up through Google etc.
    // ================================================================

    public function test_provider_sign_up_is_refused_at_the_limit(): void
    {
        $this->limit($this->testTenantId, 'at');
        $email = 'door_' . bin2hex(random_bytes(5)) . '@example.com';

        try {
            app(SocialAuthService::class)->findOrCreateFromOauth('google', $this->providerAccount($email), $this->testTenantId, time(), true);
            $this->fail('A community at its limit created a new account through a provider.');
        } catch (ProviderSignInRefused $refused) {
            // The outcome the website and the phone app already show.
            $this->assertSame(ProviderSignInRefused::REGISTRATION_CLOSED, $refused->reason);
        }

        $this->assertDatabaseMissing('users', ['tenant_id' => $this->testTenantId, 'email' => $email]);
    }

    #[DataProvider('openStates')]
    public function test_provider_sign_up_is_open(string $state): void
    {
        $this->limit($this->testTenantId, $state);
        $email = 'door_' . bin2hex(random_bytes(5)) . '@example.com';

        $result = app(SocialAuthService::class)->findOrCreateFromOauth('google', $this->providerAccount($email), $this->testTenantId, time(), true);

        $this->assertTrue($result['is_new']);
    }

    public function test_an_existing_member_still_signs_in_through_a_provider_at_the_limit(): void
    {
        $email = 'door_' . bin2hex(random_bytes(5)) . '@example.com';
        $account = $this->providerAccount($email);
        $service = app(SocialAuthService::class);
        $created = $service->findOrCreateFromOauth('google', $account, $this->testTenantId, time(), true);
        $this->limit($this->testTenantId, 'at');

        $again = $service->findOrCreateFromOauth('google', $account, $this->testTenantId, time(), false);

        $this->assertFalse($again['is_new']);
        $this->assertSame((int) $created['user']->id, (int) $again['user']->id);
    }

    // ================================================================
    // Single sign-on creating an account
    // ================================================================

    public function test_single_sign_on_creates_no_account_at_the_limit(): void
    {
        $provider = $this->ssoProvider();
        $this->limit($this->testTenantId, 'at');
        $email = 'door-sso-' . bin2hex(random_bytes(4)) . '@example.test';

        try {
            $this->ssoProvision($provider, $email);
            $this->fail('A community at its limit created an account through single sign-on.');
        } catch (SsoLinkRequiredException) {
            // Refused exactly as a closed community is.
        }

        $this->assertDatabaseMissing('users', ['tenant_id' => $this->testTenantId, 'email' => $email]);
    }

    #[DataProvider('openStates')]
    public function test_single_sign_on_creates_the_account(string $state): void
    {
        $provider = $this->ssoProvider();
        $this->limit($this->testTenantId, $state);
        $email = 'door-sso-' . bin2hex(random_bytes(4)) . '@example.test';

        $result = $this->ssoProvision($provider, $email);

        $this->assertTrue($result['is_new']);
        $this->assertDatabaseHas('users', ['tenant_id' => $this->testTenantId, 'email' => $email]);
    }

    // ================================================================
    // Admin adds a member by hand — POST /v2/admin/users
    // ================================================================

    public function test_admin_adding_a_member_is_refused_at_the_limit(): void
    {
        $admin = $this->admin();
        $max = $this->limit($this->testTenantId, 'at');
        $email = 'door-add-' . bin2hex(random_bytes(4)) . '@nexus.test';

        $r = $this->apiPost('/v2/admin/users', $this->newMember($email), $this->bearer($admin));

        $r->assertStatus(403)->assertJsonPath('errors.0.code', JoiningGate::CODE);
        $this->assertSame(__('api.community_member_limit_reached', ['max' => $max]), $r->json('errors.0.message'));
        $this->assertStringContainsString((string) $max, (string) $r->json('errors.0.message'));
        $this->assertDatabaseMissing('users', ['email' => $email]);
    }

    #[DataProvider('openStates')]
    public function test_admin_adding_a_member_is_open(string $state): void
    {
        $admin = $this->admin();
        $this->limit($this->testTenantId, $state);
        $email = 'door-add-' . bin2hex(random_bytes(4)) . '@nexus.test';

        $this->apiPost('/v2/admin/users', $this->newMember($email), $this->bearer($admin))->assertStatus(201);
    }

    // ================================================================
    // The shared step for every admin-created account (assisted and paper
    // sign-up, club import go through it; so do the two doors above and
    // below that are tested over HTTP).
    // ================================================================

    public function test_the_shared_admission_step_refuses_at_the_limit_and_answers_403(): void
    {
        $max = $this->limit($this->testTenantId, 'at');

        try {
            AdminCreatedAccountAdmission::decide($this->testTenantId, false);
            $this->fail('decide() admitted an account to a community at its limit.');
        } catch (JoiningClosed $closed) {
            $this->assertSame($max, $closed->closedBy['max']);
            // Any caller that lets it through still answers 403, never 500.
            $response = $closed->render();
            $this->assertSame(403, $response->getStatusCode());
            $this->assertSame(JoiningGate::CODE, $response->getData(true)['errors'][0]['code']);
        }
    }

    #[DataProvider('openStates')]
    public function test_the_shared_admission_step_admits(string $state): void
    {
        $this->limit($this->testTenantId, $state);

        $this->assertSame('active', AdminCreatedAccountAdmission::decide($this->testTenantId, false)['columns']['status']);
    }

    // ================================================================
    // Super admin creates a user in a community — POST /v2/admin/super/users
    // ================================================================

    public function test_super_admin_creating_a_user_is_refused_at_the_limit(): void
    {
        $actor = $this->superAdmin();
        $capped = $this->community('Door capped create', true);
        $max = $this->limit($capped, 'at');
        $email = 'door-super-' . bin2hex(random_bytes(4)) . '@nexus.test';

        $r = $this->apiPost('/v2/admin/super/users', ['tenant_id' => $capped] + $this->newMember($email), $this->bearer($actor));

        $r->assertStatus(403)->assertJsonPath('errors.0.code', JoiningGate::CODE);
        $this->assertSame(__('api.community_member_limit_reached', ['max' => $max]), $r->json('errors.0.message'));
        $this->assertDatabaseMissing('users', ['email' => $email]);
    }

    #[DataProvider('openStates')]
    public function test_super_admin_creating_a_user_is_open(string $state): void
    {
        $actor = $this->superAdmin();
        $capped = $this->community('Door capped create', true);
        $this->limit($capped, $state);
        $email = 'door-super-' . bin2hex(random_bytes(4)) . '@nexus.test';

        $this->apiPost('/v2/admin/super/users', ['tenant_id' => $capped] + $this->newMember($email), $this->bearer($actor))
            ->assertStatus(201);
    }

    // ================================================================
    // Admin approves a waiting sign-up — POST /v2/admin/users/{id}/approve
    // ================================================================

    public function test_approving_a_waiting_sign_up_is_refused_at_the_limit(): void
    {
        $admin = $this->admin();
        $waiting = $this->waiting();
        $max = $this->limit($this->testTenantId, 'at');

        $r = $this->apiPost("/v2/admin/users/{$waiting->id}/approve", [], $this->bearer($admin));

        $r->assertStatus(403)->assertJsonPath('errors.0.code', JoiningGate::CODE);
        $this->assertSame(__('api.community_member_limit_reached', ['max' => $max]), $r->json('errors.0.message'));
        $this->assertSame(0, (int) DB::table('users')->where('id', $waiting->id)->value('is_approved'));
    }

    #[DataProvider('openStates')]
    public function test_approving_a_waiting_sign_up_is_open(string $state): void
    {
        $admin = $this->admin();
        $waiting = $this->waiting();
        $this->limit($this->testTenantId, $state);

        $this->apiPost("/v2/admin/users/{$waiting->id}/approve", [], $this->bearer($admin))->assertOk();
        $this->assertSame(1, (int) DB::table('users')->where('id', $waiting->id)->value('is_approved'));
    }

    // ================================================================
    // Bulk approve — POST /v2/admin/users/bulk-approve
    // ================================================================

    public function test_bulk_approve_approves_up_to_the_room_left_and_reports_the_rest(): void
    {
        $admin = $this->admin();
        $first = $this->waiting();
        $second = $this->waiting();
        $third = $this->waiting();
        $max = $this->limit($this->testTenantId, 'below', 2);

        $r = $this->apiPost('/v2/admin/users/bulk-approve', ['user_ids' => [$first->id, $second->id, $third->id]], $this->bearer($admin));

        $r->assertOk();
        $this->assertSame(2, $r->json('data.success'));
        $this->assertSame([(int) $third->id], $r->json('data.limit_refused_ids'));
        $this->assertSame(__('api.community_member_limit_reached', ['max' => $max]), $r->json('data.limit_refused_message'));
        $this->assertContains((int) $third->id, $r->json('data.skipped_ids'));
        $this->assertSame(1, (int) DB::table('users')->where('id', $first->id)->value('is_approved'));
        $this->assertSame(1, (int) DB::table('users')->where('id', $second->id)->value('is_approved'));
        $this->assertSame(0, (int) DB::table('users')->where('id', $third->id)->value('is_approved'));
    }

    public function test_bulk_approve_approves_nobody_at_the_limit(): void
    {
        $admin = $this->admin();
        $waiting = $this->waiting();
        $this->limit($this->testTenantId, 'at');

        $r = $this->apiPost('/v2/admin/users/bulk-approve', ['user_ids' => [$waiting->id]], $this->bearer($admin));

        $r->assertOk();
        $this->assertSame(0, $r->json('data.success'));
        $this->assertSame([(int) $waiting->id], $r->json('data.limit_refused_ids'));
        $this->assertSame(0, (int) DB::table('users')->where('id', $waiting->id)->value('is_approved'));
    }

    #[DataProvider('openStates')]
    public function test_bulk_approve_is_open(string $state): void
    {
        $admin = $this->admin();
        $waiting = $this->waiting();
        $this->limit($this->testTenantId, $state);

        $r = $this->apiPost('/v2/admin/users/bulk-approve', ['user_ids' => [$waiting->id]], $this->bearer($admin));

        $r->assertOk();
        $this->assertSame(1, $r->json('data.success'));
        $this->assertSame([], $r->json('data.limit_refused_ids'));
    }

    // ================================================================
    // Super admin moves a user INTO the community
    // ================================================================

    public function test_moving_a_user_in_is_refused_at_the_limit(): void
    {
        $actor = $this->superAdmin();
        $capped = $this->community('Door capped move', true);
        $max = $this->limit($capped, 'at');
        $mover = $this->accountIn($this->community('Door source'));

        $r = $this->apiPost("/v2/admin/super/users/{$mover->id}/move-tenant", ['new_tenant_id' => $capped], $this->bearer($actor));

        $r->assertStatus(403)->assertJsonPath('errors.0.code', JoiningGate::CODE);
        $this->assertSame(__('api.community_member_limit_reached', ['max' => $max]), $r->json('errors.0.message'));
        $this->assertNotSame($capped, (int) DB::table('users')->where('id', $mover->id)->value('tenant_id'));
    }

    #[DataProvider('openStates')]
    public function test_moving_a_user_in_is_open(string $state): void
    {
        $actor = $this->superAdmin();
        $capped = $this->community('Door capped move', true);
        $this->limit($capped, $state);
        $mover = $this->accountIn($this->community('Door source'));

        $this->apiPost("/v2/admin/super/users/{$mover->id}/move-tenant", ['new_tenant_id' => $capped], $this->bearer($actor))
            ->assertOk();
        $this->assertSame($capped, (int) DB::table('users')->where('id', $mover->id)->value('tenant_id'));
    }

    public function test_moving_a_user_out_of_a_community_at_its_limit_is_never_refused(): void
    {
        $actor = $this->superAdmin();
        $capped = $this->community('Door capped source', true);
        $mover = $this->accountIn($capped);
        $this->limit($capped, 'at');
        $destination = $this->community('Door open destination', true);

        $this->apiPost("/v2/admin/super/users/{$mover->id}/move-tenant", ['new_tenant_id' => $destination], $this->bearer($actor))
            ->assertOk();
    }

    public function test_move_and_promote_is_refused_at_the_limit(): void
    {
        $actor = $this->superAdmin();
        $capped = $this->community('Door capped promote', true);
        $this->limit($capped, 'at');
        $mover = $this->accountIn($this->community('Door source'));

        $r = $this->apiPost("/v2/admin/super/users/{$mover->id}/move-and-promote", ['target_tenant_id' => $capped], $this->bearer($actor));

        $r->assertStatus(403)->assertJsonPath('errors.0.code', JoiningGate::CODE);
        $this->assertSame(0, (int) DB::table('users')->where('id', $mover->id)->value('is_tenant_super_admin'));
    }

    #[DataProvider('openStates')]
    public function test_move_and_promote_is_open(string $state): void
    {
        $actor = $this->superAdmin();
        $capped = $this->community('Door capped promote', true);
        $this->limit($capped, $state);
        $mover = $this->accountIn($this->community('Door source'));

        $this->apiPost("/v2/admin/super/users/{$mover->id}/move-and-promote", ['target_tenant_id' => $capped], $this->bearer($actor))
            ->assertOk();
    }

    public function test_bulk_move_is_refused_at_the_limit_per_user(): void
    {
        $actor = $this->superAdmin();
        $capped = $this->community('Door capped bulk', true);
        $max = $this->limit($capped, 'at');
        $mover = $this->accountIn($this->community('Door source'));

        $r = $this->apiPost('/v2/admin/super/bulk/move-users', ['user_ids' => [$mover->id], 'target_tenant_id' => $capped], $this->bearer($actor));

        $r->assertOk();
        $this->assertSame(0, (int) $r->json('data.updated_count'));
        $this->assertSame(JoiningGate::CODE, $r->json('data.errors.0.code'));
        $this->assertSame((int) $mover->id, (int) $r->json('data.errors.0.params.user_id'));
        $this->assertSame($max, (int) $r->json('data.errors.0.params.max'));
        $this->assertNotSame($capped, (int) DB::table('users')->where('id', $mover->id)->value('tenant_id'));
    }

    #[DataProvider('openStates')]
    public function test_bulk_move_is_open(string $state): void
    {
        $actor = $this->superAdmin();
        $capped = $this->community('Door capped bulk', true);
        $this->limit($capped, $state);
        $mover = $this->accountIn($this->community('Door source'));

        $this->apiPost('/v2/admin/super/bulk/move-users', ['user_ids' => [$mover->id], 'target_tenant_id' => $capped], $this->bearer($actor))
            ->assertOk();
        $this->assertSame($capped, (int) DB::table('users')->where('id', $mover->id)->value('tenant_id'));
    }

    public function test_bulk_move_moves_up_to_the_room_left_and_refuses_the_rest_with_a_message(): void
    {
        $actor = $this->superAdmin();
        $capped = $this->community('Door capped bulk room', true);
        $max = $this->limit($capped, 'below', 1);
        $source = $this->community('Door source');
        $movers = [$this->accountIn($source), $this->accountIn($source), $this->accountIn($source)];

        $r = $this->apiPost('/v2/admin/super/bulk/move-users', [
            'user_ids' => array_map(static fn (User $u): int => (int) $u->id, $movers),
            'target_tenant_id' => $capped,
        ], $this->bearer($actor));

        $r->assertOk();
        $this->assertSame(1, (int) $r->json('data.moved_count'), $r->getContent());
        $refused = array_values(array_filter($r->json('data.errors') ?? [], static fn (array $e): bool => $e['code'] === JoiningGate::CODE));
        $this->assertCount(2, $refused);
        $this->assertSame(__('api.community_member_limit_reached', ['max' => $max]), $refused[0]['message']);
        $this->assertSame(1, DB::table('users')->whereIn('id', array_map(static fn (User $u): int => (int) $u->id, $movers))->where('tenant_id', $capped)->count());
    }

    // ================================================================
    // Letting a waiting sign-up in by a status change or reactivate
    // ================================================================

    public function test_setting_a_never_approved_sign_up_to_active_is_refused_at_the_limit(): void
    {
        $admin = $this->admin();
        $waiting = $this->waiting();
        $max = $this->limit($this->testTenantId, 'at');

        $r = $this->apiPut("/v2/admin/users/{$waiting->id}", ['status' => 'active'], $this->bearer($admin));

        $r->assertStatus(403)->assertJsonPath('errors.0.code', JoiningGate::CODE);
        $this->assertSame(__('api.community_member_limit_reached', ['max' => $max]), $r->json('errors.0.message'));
        $this->assertSame(0, (int) DB::table('users')->where('id', $waiting->id)->value('is_approved'));
    }

    #[DataProvider('openStates')]
    public function test_setting_a_never_approved_sign_up_to_active_is_open(string $state): void
    {
        $admin = $this->admin();
        $waiting = $this->waiting();
        $this->limit($this->testTenantId, $state);

        $this->apiPut("/v2/admin/users/{$waiting->id}", ['status' => 'active'], $this->bearer($admin))->assertOk();
        $this->assertSame(1, (int) DB::table('users')->where('id', $waiting->id)->value('is_approved'));
    }

    public function test_reactivating_a_never_approved_sign_up_is_refused_at_the_limit(): void
    {
        $admin = $this->admin();
        $waiting = $this->waiting();
        $this->limit($this->testTenantId, 'at');

        $r = $this->apiPost("/v2/admin/users/{$waiting->id}/reactivate", [], $this->bearer($admin));

        $r->assertStatus(403)->assertJsonPath('errors.0.code', JoiningGate::CODE);
        $this->assertSame(0, (int) DB::table('users')->where('id', $waiting->id)->value('is_approved'));
    }

    #[DataProvider('openStates')]
    public function test_reactivating_a_never_approved_sign_up_is_open(string $state): void
    {
        $admin = $this->admin();
        $waiting = $this->waiting();
        $this->limit($this->testTenantId, $state);

        $this->apiPost("/v2/admin/users/{$waiting->id}/reactivate", [], $this->bearer($admin))->assertOk();
        $this->assertSame(1, (int) DB::table('users')->where('id', $waiting->id)->value('is_approved'));
    }

    // ================================================================
    // A limit from a community above, and a plan change seen at once
    // ================================================================

    public function test_a_door_shut_from_above_does_not_quote_the_other_communitys_number(): void
    {
        $actor = $this->superAdmin();
        $hub = $this->community('Door capped hub', true);
        $child = (int) DB::table('tenants')->insertGetId([
            'name' => 'Door child', 'slug' => 'door-' . bin2hex(random_bytes(5)), 'is_active' => 1,
            'parent_id' => $hub, 'allows_subtenants' => 0, 'depth' => 2, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $child)->update(['path' => "/1/{$hub}/{$child}/"]);
        $max = $this->limit($hub, 'at');
        $email = 'door-above-' . bin2hex(random_bytes(4)) . '@nexus.test';

        $r = $this->apiPost('/v2/admin/super/users', ['tenant_id' => $child] + $this->newMember($email), $this->bearer($actor));

        $r->assertStatus(403)->assertJsonPath('errors.0.code', JoiningGate::CODE);
        $this->assertSame(__('api.community_member_limit_reached_above'), $r->json('errors.0.message'));
        $this->assertStringNotContainsString((string) $max, (string) $r->json('errors.0.message'));
    }

    public function test_a_bigger_plan_lets_the_very_next_approval_through(): void
    {
        $admin = $this->admin();
        $waiting = $this->waiting();
        $max = $this->limit($this->testTenantId, 'at');
        $this->apiPost("/v2/admin/users/{$waiting->id}/approve", [], $this->bearer($admin))->assertStatus(403);

        $bigger = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Door bigger plan', 'slug' => 'door-plan-' . bin2hex(random_bytes(5)), 'tier_level' => 2,
            'max_users' => $max + 10, 'is_standard' => 1, 'is_active' => 1, 'created_at' => now(),
        ]);
        TenantBillingService::changePlanOnly($this->testTenantId, $bigger, (int) $admin->id, 'platform');

        $this->apiPost("/v2/admin/users/{$waiting->id}/approve", [], $this->bearer($admin))->assertOk();
    }

    // ================================================================
    // Member import — POST /v2/admin/members/import/{id}/batch
    // ================================================================

    public function test_an_import_adds_only_the_room_left_and_reports_the_rest_per_row(): void
    {
        $admin = $this->admin();
        $max = $this->limit($this->testTenantId, 'below', 2);
        $prefix = 'door-imp-' . bin2hex(random_bytes(3));
        $id = $this->importCheck($admin, $prefix, 5);

        $r = $this->apiPost("/v2/admin/members/import/{$id}/batch", ['from' => 0, 'count' => 50], $this->bearer($admin));

        $r->assertOk();
        $this->assertSame('completed', $r->json('data.status'), 'leaving rows out does not fail the batch');
        $this->assertSame(2, $r->json('data.totals.created'));
        $this->assertSame(3, $r->json('data.totals.left_out'));
        $this->assertSame([4, 5, 6], array_column($r->json('data.left_out_rows'), 'row'));
        $this->assertSame('member_limit_reached', $r->json('data.left_out_rows.0.code'));
        $this->assertSame($max, $r->json('data.left_out_rows.0.params.max'));
        $this->assertSame(__('api.community_member_limit_reached', ['max' => $max]), $r->json('data.left_out_message'));
        $this->assertSame(2, DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', 'like', $prefix . '-%')->count());
    }

    public function test_the_room_is_counted_across_the_batches_of_one_import(): void
    {
        // A new account does not count as active until it signs in, so the
        // import itself remembers how many it has added.
        $admin = $this->admin();
        $this->limit($this->testTenantId, 'below', 12);
        $prefix = 'door-imp-' . bin2hex(random_bytes(3));
        $id = $this->importCheck($admin, $prefix, 25);

        $next = 0;
        $r = null;
        while ($next < 25) {
            $r = $this->apiPost("/v2/admin/members/import/{$id}/batch", ['from' => $next, 'count' => 10], $this->bearer($admin))->assertOk();
            $next = (int) $r->json('data.next_index');
        }

        $this->assertSame(12, $r->json('data.totals.created'));
        $this->assertSame(13, $r->json('data.totals.left_out'));
        $this->assertSame(12, DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', 'like', $prefix . '-%')->count());
    }

    public function test_an_import_at_the_limit_adds_nobody(): void
    {
        $admin = $this->admin();
        $this->limit($this->testTenantId, 'at');
        $prefix = 'door-imp-' . bin2hex(random_bytes(3));
        $id = $this->importCheck($admin, $prefix, 3);

        $r = $this->apiPost("/v2/admin/members/import/{$id}/batch", ['from' => 0, 'count' => 50], $this->bearer($admin));

        $r->assertOk();
        $this->assertSame(0, $r->json('data.totals.created'));
        $this->assertSame(3, $r->json('data.totals.left_out'));
        $this->assertSame(0, DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', 'like', $prefix . '-%')->count());
    }

    #[DataProvider('openStates')]
    public function test_an_import_is_open(string $state): void
    {
        $admin = $this->admin();
        $this->limit($this->testTenantId, $state, $state === 'below' ? 10 : 0);
        $prefix = 'door-imp-' . bin2hex(random_bytes(3));
        $id = $this->importCheck($admin, $prefix, 3);

        $r = $this->apiPost("/v2/admin/members/import/{$id}/batch", ['from' => 0, 'count' => 50], $this->bearer($admin));

        $r->assertOk();
        $this->assertSame(3, $r->json('data.totals.created'));
        $this->assertSame(0, $r->json('data.totals.left_out'));
        $this->assertSame([], $r->json('data.left_out_rows'));
    }

    // ================================================================
    // Left open on purpose (the person already joined before the door shut)
    // ================================================================

    /** An approved member, suspended later: they already joined, so the door stays open. */
    public function test_left_open_reactivating_an_approved_then_suspended_member(): void
    {
        $admin = $this->admin();
        $suspended = User::factory()->forTenant($this->testTenantId)->create(['status' => 'suspended', 'is_approved' => true]);
        $this->limit($this->testTenantId, 'at');

        $this->apiPost("/v2/admin/users/{$suspended->id}/reactivate", [], $this->bearer($admin))->assertOk();
        $this->assertSame('active', (string) DB::table('users')->where('id', $suspended->id)->value('status'));
    }

    /** An approved member: changing their status is not letting someone new in. */
    public function test_left_open_an_admin_editing_an_approved_members_status(): void
    {
        $admin = $this->admin();
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'pending', 'is_approved' => true]);
        $this->limit($this->testTenantId, 'at');

        $this->apiPut("/v2/admin/users/{$member->id}", ['status' => 'active'], $this->bearer($admin))->assertOk();
        $this->assertSame('active', (string) DB::table('users')->where('id', $member->id)->value('status'));
    }

    public function test_left_open_the_email_confirmation_link(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email_verified_at' => null, 'is_verified' => false, 'is_approved' => true, 'status' => 'pending',
        ]);
        $plaintext = bin2hex(random_bytes(32));
        DB::table('email_verification_tokens')->insert([
            'user_id' => $member->id, 'tenant_id' => $this->testTenantId,
            'token' => hash('sha256', $plaintext), 'expires_at' => now()->addDay(),
        ]);
        $this->limit($this->testTenantId, 'at');

        $this->apiPost('/auth/verify-email', ['token' => $plaintext])->assertOk();
        $this->assertSame('active', (string) DB::table('users')->where('id', $member->id)->value('status'));
    }

    public function test_left_open_password_reset(): void
    {
        Http::fake(['api.pwnedpasswords.com/*' => Http::response('', 200)]);
        $email = 'door-reset-' . bin2hex(random_bytes(5)) . '@example.test';
        User::factory()->forTenant($this->testTenantId)->create(['email' => $email, 'status' => 'active', 'is_approved' => 1]);
        $token = bin2hex(random_bytes(32));
        DB::table('password_resets')->insert([
            'email' => $email, 'tenant_id' => $this->testTenantId,
            'token' => hash('sha256', $token), 'created_at' => DB::raw('NOW()'),
        ]);
        $this->limit($this->testTenantId, 'at');

        $password = 'door-reset-new-password-' . bin2hex(random_bytes(6));
        $this->apiPost('/auth/reset-password', [
            'token' => $token, 'password' => $password, 'password_confirmation' => $password,
        ])->assertOk();
    }

    public function test_left_open_an_identity_check_result(): void
    {
        $this->identityPolicy();
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'pending', 'is_approved' => false, 'verification_status' => 'pending', 'email_verified_at' => now(),
        ]);
        $this->limit($this->testTenantId, 'at');

        RegistrationOrchestrationService::applyPostVerificationAction((int) $member->id, $this->testTenantId, 'passed');

        $this->assertSame('active', (string) DB::table('users')->where('id', $member->id)->value('status'));
    }

    public function test_left_open_an_admins_approval_of_an_identity_check(): void
    {
        $this->identityPolicy();
        $admin = $this->admin();
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'pending', 'is_approved' => false, 'verification_status' => 'pending', 'email_verified_at' => now(),
        ]);
        $sessionId = IdentityVerificationSessionService::create($this->testTenantId, (int) $member->id, 'mock', 'document_only', []);
        $this->limit($this->testTenantId, 'at');
        TenantContext::setById($this->testTenantId);

        RegistrationOrchestrationService::adminReview($sessionId, (int) $admin->id, 'approve');

        $this->assertSame('active', (string) DB::table('users')->where('id', $member->id)->value('status'));
    }

    // ------------------------------------------------------------------ helpers

    /**
     * Cap a community: a standard plan whose member number is its active
     * members now (state `at`), or that plus $room (state `below`); its own
     * rule `block_joining`, or `pause` for `other_rule`; the automatic
     * checks on, except for `switch_off`; and the community told of its
     * number under those terms. Returns the member number.
     */
    private function limit(int $tenantId, string $state, int $room = 5): int
    {
        // At least one active member, so the member number is a positive number.
        $this->addActiveMember($tenantId);
        $active = TenantBillingService::getSubtreeActiveMemberCount($tenantId);
        $max = $state === 'below' ? $active + $room : $active;

        $plan = (int) DB::table('pay_plans')->insertGetId([
            'name' => "Door plan {$max}",
            'slug' => 'door-plan-' . bin2hex(random_bytes(5)),
            'tier_level' => 1,
            'max_users' => $max,
            'is_standard' => 1,
            'is_active' => 1,
            'created_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->where('tenant_id', $tenantId)->delete();
        DB::table('tenant_plan_assignments')->insert(['tenant_id' => $tenantId, 'pay_plan_id' => $plan, 'status' => 'active']);

        $standing = [
            'over_limit_action' => $state === 'other_rule' ? 'pause' : 'block_joining',
            'exempt' => 0,
            'suspended_at' => null,
        ];
        if (DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->exists()) {
            DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->update($standing);
        } else {
            DB::table('tenant_billing_standing')->insert($standing + ['tenant_id' => $tenantId, 'created_at' => now(), 'updated_at' => now()]);
        }

        BillingSettings::set('automation_enabled', $state !== 'switch_off', null);
        BillingLock::flush();
        PlanTerms::flush();
        JoiningGate::flush();

        // The door shuts only once the daily check has told the community,
        // under these terms, that it is at its number: as a real run leaves it.
        $this->tellCommunityOfMemberLimit($tenantId);

        return $max;
    }

    private function addActiveMember(int $tenantId): void
    {
        DB::table('users')->insert([
            'tenant_id' => $tenantId,
            'first_name' => 'Door',
            'last_name' => 'Member',
            'name' => 'Door Member',
            'email' => 'door.active.' . bin2hex(random_bytes(7)) . '@example.com',
            'password_hash' => 'x',
            'role' => 'member',
            'status' => 'active',
            'is_approved' => 1,
            'last_login_at' => now()->subDays(3),
            'created_at' => now(),
        ]);
    }

    private function community(string $name, bool $hub = false): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'door-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => 1,
            'allows_subtenants' => $hub ? 1 : 0,
            'max_depth' => $hub ? 2 : 0,
            'depth' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "/1/{$id}/"]);

        return $id;
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active', 'is_approved' => true]);
    }

    private function superAdmin(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active', 'is_approved' => true]);
        DB::table('users')->where('id', $u->id)->update(['is_super_admin' => 1, 'role' => 'admin']);

        return User::withoutGlobalScopes()->find($u->id);
    }

    private function accountIn(int $tenantId): User
    {
        $u = User::factory()->forTenant($tenantId)->create(['status' => 'active', 'is_approved' => 1, 'role' => 'member']);
        DB::table('users')->where('id', $u->id)->update([
            'tenant_id' => $tenantId, 'role' => 'member', 'is_admin' => 0,
            'is_super_admin' => 0, 'is_tenant_super_admin' => 0, 'is_god' => 0,
        ]);

        return User::withoutGlobalScopes()->find($u->id);
    }

    private function waiting(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'pending', 'is_approved' => false, 'email_verified_at' => now(),
        ]);
    }

    /** @return array<string, string> */
    private function bearer(User $as): array
    {
        return ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            (int) $as->id,
            (int) $as->tenant_id,
            TwoFactorPolicy::claims('totp')
        )];
    }

    /** @return array<string, string> */
    private function newMember(string $email): array
    {
        return [
            'first_name' => 'Door',
            'last_name' => 'Newcomer',
            'email' => $email,
            'password' => 'door-newcomer-password-' . bin2hex(random_bytes(4)),
            'role' => 'member',
        ];
    }

    private function importCheck(User $admin, string $prefix, int $rows): string
    {
        $csv = "first_name,last_name,email,phone,location,balance\n";
        for ($i = 0; $i < $rows; $i++) {
            $csv .= "Member,{$i},{$prefix}-{$i}@nexus.test,,Town {$i},0\n";
        }
        $check = $this->apiPost('/v2/admin/members/import/check', [
            'file_name' => 'members.csv', 'content_base64' => base64_encode($csv),
        ], $this->bearer($admin))->assertOk();
        $this->assertSame('ready', $check->json('data.status'), $check->getContent());

        return (string) $check->json('data.import_id');
    }

    private function providerAccount(string $email): object
    {
        return new class('g_' . bin2hex(random_bytes(6)), $email) {
            public function __construct(private string $id, private string $email)
            {
            }

            public function getId(): string
            {
                return $this->id;
            }

            public function getEmail(): ?string
            {
                return $this->email;
            }

            public function getName(): ?string
            {
                return 'New Member';
            }

            public function getAvatar(): ?string
            {
                return null;
            }

            /** @return array<string, mixed> */
            public function getRaw(): array
            {
                return ['sub' => $this->id, 'email' => $this->email, 'email_verified' => true, 'hd' => 'example.com'];
            }
        };
    }

    private function ssoProvider(): object
    {
        $suffix = bin2hex(random_bytes(4));
        $id = (int) DB::table('tenant_sso_providers')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'provider_key' => 'door' . substr($suffix, 0, 6),
            'display_name' => 'Community IdP',
            'preset' => 'generic',
            'issuer_url' => 'https://93.184.216.34/door-' . $suffix,
            'client_id' => 'door-client-' . $suffix,
            'client_secret_encrypted' => null,
            'scopes' => 'openid profile email',
            'allowed_email_domains' => null,
            'auto_provision' => 1,
            'is_enabled' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return DB::table('tenant_sso_providers')->where('id', $id)->first();
    }

    /**
     * The account-creating step of single sign-on, reached after the ID token
     * is verified (F270SsoProvisionRegistrationPolicyTest drives the whole
     * callback; this test needs only the step the gate sits in).
     *
     * @return array<string, mixed>
     */
    private function ssoProvision(object $provider, string $email): array
    {
        $claims = [
            'iss' => (string) $provider->issuer_url,
            'aud' => (string) $provider->client_id,
            'sub' => 'door-sub-' . bin2hex(random_bytes(4)),
            'email' => $email,
            'email_verified' => true,
            'name' => 'Idp Person',
        ];
        $method = new \ReflectionMethod(SsoOidcService::class, 'findOrCreateFromClaims');

        return $method->invoke(app(SsoOidcService::class), $provider, $claims, $email, true, time());
    }

    private function identityPolicy(): void
    {
        DB::table('tenant_registration_policies')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            [
                'registration_mode' => 'verified_identity', 'verification_provider' => 'mock',
                'verification_level' => 'document_only', 'post_verification' => 'activate',
                'fallback_mode' => 'none', 'require_email_verify' => 0, 'provider_config' => null,
                'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
            ]
        );
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
    }
}
