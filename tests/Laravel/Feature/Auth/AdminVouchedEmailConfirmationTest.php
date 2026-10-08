<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Auth;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TenantSettingsService;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Owner decision, 8 Oct 2026: an administrator creating an account vouches
 * for its email address, so the member is not then asked to confirm it.
 *
 *  - created with an administrator-set password (no invitation) → confirmed
 *    at creation; the same for a CSV import;
 *  - created with an emailed invitation → confirmed when the member uses the
 *    set-password link, which proves the inbox is theirs. Every completed
 *    password reset counts, since reset links are only ever delivered by
 *    email;
 *  - an administrator can mark an existing member's email confirmed.
 *
 * Confirming an email never releases an identity-check hold (F-278).
 */
class AdminVouchedEmailConfirmationTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Cache::flush();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        foreach (['127.0.0.1', '::1', ''] as $ip) {
            RateLimiter::clear("api:reset_password:ip:{$ip}");
        }
        $this->requireEmailVerification();
        // Joining rules are stated, never inherited from the shared test tenant.
        $this->setRegistrationMode('open_with_approval');
    }

    // ------------------------------------------------------------ fixtures

    private function requireEmailVerification(): void
    {
        foreach (['email_verification', 'general.email_verification'] as $key) {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
                ['setting_value' => 'true', 'setting_type' => 'boolean', 'updated_at' => now()]
            );
        }
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
        TenantContext::setById($this->testTenantId);
    }

    private function setRegistrationMode(string $mode): void
    {
        foreach (['general.registration_mode', 'registration_mode'] as $key) {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
                ['setting_value' => 'open', 'setting_type' => 'string', 'updated_at' => now()]
            );
        }
        $identity = in_array($mode, ['verified_identity', 'government_id'], true);
        DB::table('tenant_registration_policies')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            [
                'registration_mode' => $mode,
                'verification_provider' => $identity ? 'vouch_test_idp' : null,
                'verification_level' => $identity ? 'document_only' : 'none',
                'post_verification' => 'admin_approval',
                'fallback_mode' => 'none',
                'require_email_verify' => 1,
                'provider_config' => null,
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
        TenantContext::setById($this->testTenantId);
    }

    private function actingAsRole(string $role): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'role' => $role, 'status' => 'active', 'is_approved' => 1,
        ]);
        Sanctum::actingAs($user);

        return $user;
    }

    private function email(string $tag): string
    {
        return 'vouch-' . $tag . '-' . bin2hex(random_bytes(5)) . '@example.test';
    }

    /** @return array<string,mixed> */
    private function row(string $email): array
    {
        $r = DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $email)->first();
        $this->assertNotNull($r, "precondition: an account exists for {$email}");

        return (array) $r;
    }

    private function assertConfirmed(string $email): void
    {
        $row = $this->row($email);
        $this->assertNotNull($row['email_verified_at'], 'the email must be recorded as confirmed');
        $this->assertSame(1, (int) $row['is_verified'], 'is_verified is the email-confirmed flag and moves with it');
    }

    private function storeUser(string $email, array $extra = []): \Illuminate\Testing\TestResponse
    {
        return $this->apiPost('/v2/admin/users', array_merge([
            'first_name' => 'Vouch', 'last_name' => 'Created', 'email' => $email,
            'password' => 'Str0ng-Vouch-passphrase!', 'role' => 'member',
        ], $extra));
    }

    /** The member import asks for a recently entered second factor (step-up). @return array<string,string> */
    private function freshSecondFactor(User $admin): array
    {
        return ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, TwoFactorPolicy::claims('totp')
        )];
    }

    private function resetPassword(string $email): \Illuminate\Testing\TestResponse
    {
        $plainToken = bin2hex(random_bytes(32));
        DB::table('password_resets')->insert([
            'email' => $email,
            'tenant_id' => $this->testTenantId,
            'token' => hash('sha256', $plainToken),
            'created_at' => now(),
        ]);
        Http::fake(['api.pwnedpasswords.com/*' => Http::response('', 200)]);
        $newPassword = 'vouch-new-password-' . bin2hex(random_bytes(6));

        return $this->apiPost('/auth/reset-password', [
            'token' => $plainToken,
            'password' => $newPassword,
            'password_confirmation' => $newPassword,
        ]);
    }

    // ------------------------------------------------- single create (store)

    public function test_admin_created_account_with_an_admin_set_password_is_confirmed_and_can_sign_in(): void
    {
        $this->actingAsRole('admin');
        $email = $this->email('store');

        $this->storeUser($email)->assertStatus(201);

        $this->assertConfirmed($email);
        $this->assertNull(
            app(TenantSettingsService::class)->checkLoginGatesForUser($this->row($email)),
            'an admin-created member must not be stopped by the email-confirmation gate'
        );
    }

    public function test_admin_created_account_with_an_invitation_waits_for_the_link_to_be_used(): void
    {
        $this->actingAsRole('admin');
        $email = $this->email('invite');

        $this->storeUser($email, ['send_welcome_email' => true])->assertStatus(201);

        $this->assertNull(
            $this->row($email)['email_verified_at'],
            'an invited account is confirmed when the member uses the emailed link, not before'
        );
    }

    public function test_admin_created_account_held_for_an_identity_check_stays_held(): void
    {
        $this->setRegistrationMode('government_id');
        $this->actingAsRole('admin');
        $email = $this->email('held');

        $this->storeUser($email)->assertStatus(201);

        $this->assertConfirmed($email);
        $row = $this->row($email);
        $this->assertSame('pending', (string) $row['status'], 'confirming the email must not release the F-278 hold');
        $this->assertSame('pending', (string) $row['verification_status']);
        $this->assertNotNull(app(TenantSettingsService::class)->checkLoginGatesForUser($row));
    }

    // ------------------------------------------------------------ CSV import

    /** Moved to /v2/admin/members/import on 8 Oct 2026 when the old endpoint was replaced. */
    public function test_csv_imported_accounts_are_confirmed(): void
    {
        $admin = $this->actingAsRole('admin');
        $a = $this->email('csv-a');
        $b = $this->email('csv-b');
        $csv = "first_name,last_name,email,phone,location,balance\nVouch,Alpha,{$a},,,\nVouch,Beta,{$b},,,\n";

        $id = (string) $this->apiPost('/v2/admin/members/import/check', [
            'file_name' => 'members.csv', 'content_base64' => base64_encode($csv),
        ], $this->freshSecondFactor($admin))->assertStatus(200)->assertJsonPath('data.status', 'ready')->json('data.import_id');
        $this->apiPost("/v2/admin/members/import/{$id}/batch", ['from' => 0, 'count' => 10], $this->freshSecondFactor($admin))
            ->assertStatus(200)->assertJsonPath('data.status', 'completed')->assertJsonPath('data.totals.created', 2);

        $this->assertConfirmed($a);
        $this->assertConfirmed($b);
    }

    // ------------------------------------------------------ password reset

    public function test_completing_a_password_reset_confirms_the_email(): void
    {
        $email = $this->email('reset');
        User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email, 'status' => 'active', 'is_approved' => 1,
            'is_verified' => 0, 'email_verified_at' => null,
            'password_hash' => Hash::make('old-vouch-password-123'),
        ]);

        $this->resetPassword($email)->assertStatus(200);

        $this->assertConfirmed($email);
    }

    public function test_an_invited_admin_created_member_is_confirmed_once_they_set_their_password(): void
    {
        $this->actingAsRole('admin');
        $email = $this->email('invite-used');
        $this->storeUser($email, ['send_welcome_email' => true])->assertStatus(201);

        $this->resetPassword($email)->assertStatus(200);

        $this->assertConfirmed($email);
        $this->assertNull(app(TenantSettingsService::class)->checkLoginGatesForUser($this->row($email)));
    }

    public function test_a_reset_activates_a_self_serve_member_exactly_as_the_verification_link_would(): void
    {
        $this->setRegistrationMode('open');
        foreach (['admin_approval', 'general.admin_approval'] as $key) {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
                ['setting_value' => 'false', 'setting_type' => 'boolean', 'updated_at' => now()]
            );
        }
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
        $email = $this->email('self-serve');
        User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email, 'status' => 'pending', 'is_approved' => 0,
            'is_verified' => 0, 'email_verified_at' => null,
            'password_hash' => Hash::make('old-vouch-password-123'),
        ]);

        $this->resetPassword($email)->assertStatus(200);

        $row = $this->row($email);
        $this->assertNotNull($row['email_verified_at']);
        $this->assertSame('active', (string) $row['status'], 'a confirmed self-serve member must not be left stuck pending');
        $this->assertSame(1, (int) $row['is_approved']);
    }

    // ------------------------------------------------ admin "mark confirmed"

    public function test_an_admin_can_mark_a_members_email_confirmed(): void
    {
        $admin = $this->actingAsRole('admin');
        $email = $this->email('button');
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email, 'role' => 'member', 'status' => 'active', 'is_approved' => 1,
            'is_verified' => 0, 'email_verified_at' => null,
        ]);

        $this->apiPut("/v2/admin/users/{$member->id}", ['email_verified' => true])
            ->assertStatus(200)
            ->assertJsonPath('data.is_verified', true);

        $this->assertConfirmed($email);
        $this->assertTrue(
            DB::table('activity_log')
                ->where('user_id', $admin->id)
                ->where('action', 'admin_confirm_user_email')
                ->exists(),
            'who confirmed the address must be recorded'
        );
    }

    public function test_a_broker_cannot_mark_an_email_confirmed(): void
    {
        $this->actingAsRole('broker');
        $email = $this->email('broker');
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email, 'role' => 'member', 'status' => 'active', 'is_approved' => 1,
            'is_verified' => 0, 'email_verified_at' => null,
        ]);

        $this->apiPut("/v2/admin/users/{$member->id}", ['email_verified' => true])->assertStatus(403);

        $this->assertNull($this->row($email)['email_verified_at']);
    }

    public function test_marking_confirmed_never_releases_an_identity_check_hold(): void
    {
        $this->setRegistrationMode('government_id');
        $this->actingAsRole('admin');
        $email = $this->email('button-held');
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email, 'role' => 'member', 'status' => 'pending', 'is_approved' => 0,
            'verification_status' => 'pending', 'is_verified' => 0, 'email_verified_at' => null,
        ]);

        $this->apiPut("/v2/admin/users/{$member->id}", ['email_verified' => true])->assertStatus(200);

        $row = $this->row($email);
        $this->assertNotNull($row['email_verified_at']);
        $this->assertSame('pending', (string) $row['status']);
        $this->assertSame(0, (int) $row['is_approved']);
    }
}
