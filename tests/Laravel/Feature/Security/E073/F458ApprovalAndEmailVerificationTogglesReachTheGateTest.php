<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\Identity\RegistrationPolicyService;
use App\Services\PrerenderContentInvalidator;
use App\Services\RegistrationService;
use App\Services\TenantSettingsService;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Laravel\TestCase;

/**
 * E-073 F-458 — the "require member approval" and "require email verification"
 * toggles must reach the gates that decide whether a new sign-up may use the
 * community.
 *
 * The defect: `AdminConfigController::updateSettings()` persisted every
 * accepted key as `general.<key>`, while `TenantSettingsService`
 * `requiresAdminApproval()` / `requiresEmailVerification()` read the BARE key
 * and consulted the prefixed one only when the bare key was NULL. Two live
 * paths write the bare key — `TenantHierarchyService::seedTenantDefaults()` on
 * every community it creates and `RegistrationPolicyService` on every
 * registration-policy save — so on most communities the administrator's toggle
 * was inert: it answered 200, read back "true", and the gate kept the old
 * value.
 *
 * These tests assert the CORRECT behaviour and therefore fail before the fix.
 */
final class F458ApprovalAndEmailVerificationTogglesReachTheGateTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);

        // The settings-write route schedules a prerender refresh; that is not
        // what is under test. Same stub the repository's own
        // AdminConfigControllerTest uses.
        $this->mock(PrerenderContentInvalidator::class, function ($mock): void {
            $mock->shouldReceive('refreshTenantOrFail')->andReturn(9101);
            $mock->shouldReceive('refreshAllOrFail')->andReturn(9102);
        });

        // Deterministic registration policy: plain open sign-up, no identity
        // or waitlist hold, so the only thing deciding activation is the
        // admin-approval toggle under test.
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->whereIn('setting_key', [
                'general.registration_mode',
                'registration_mode',
                'general.admin_approval',
                'general.email_verification',
                'admin_approval',
                'email_verification',
            ])
            ->delete();
        DB::table('tenant_settings')->insert([
            'tenant_id' => $this->testTenantId,
            'setting_key' => 'general.registration_mode',
            'setting_value' => 'open',
            'setting_type' => 'string',
        ]);
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
    }

    // ------------------------------------------------------------------
    //  THE HARM — a community that has a bare row (most of them)
    // ------------------------------------------------------------------

    public function test_turning_member_approval_back_on_actually_holds_the_next_signup(): void
    {
        $settings = app(TenantSettingsService::class);

        // A community that opted out of approval through the registration
        // policy page. That real path writes the bare key.
        RegistrationPolicyService::upsertPolicy($this->testTenantId, [
            'registration_mode' => 'open',
            'require_email_verify' => true,
        ]);
        $settings->clearCacheForTenant($this->testTenantId);

        $this->assertFalse(
            $settings->requiresAdminApproval($this->testTenantId),
            'precondition: approval is currently OFF',
        );

        // The community administrator turns member approval back ON from the
        // Settings page. Platform super-admin, because that is the tier the
        // platform reserves this key for (F-054/F-153).
        $this->actAsPlatformSuperAdmin();
        $this->apiPut('/v2/admin/settings', ['admin_approval' => 'true'])
            ->assertStatus(200);

        // The page reads its own write back...
        $this->apiGet('/v2/admin/settings')
            ->assertStatus(200)
            ->assertJsonPath('data.settings.admin_approval', 'true');

        // ...and so does the gate.
        $settings->clearCacheForTenant($this->testTenantId);
        $this->assertTrue(
            $settings->requiresAdminApproval($this->testTenantId),
            'the administrator was shown "approval required" and the gate must agree',
        );

        // The outcome that matters: a brand-new sign-up is held for a human.
        $memberId = $this->makePendingSignup();
        $this->assertTrue(app(RegistrationService::class)->verifyEmail($this->tokenFor($memberId)));

        $row = DB::table('users')->where('id', $memberId)->first(['status', 'is_approved']);
        $this->assertSame(
            'pending',
            (string) $row->status,
            'a new account must not activate itself while approval is required',
        );
        $this->assertSame(0, (int) $row->is_approved);

        // ...and is not given the community's starting time credits yet.
        $this->assertSame(
            0,
            $this->walletTransactionCount($memberId),
            'starting credits must wait for the administrator',
        );
    }

    public function test_turning_email_verification_back_on_blocks_an_unverified_login(): void
    {
        $settings = app(TenantSettingsService::class);

        DB::table('tenant_settings')->insert([
            'tenant_id' => $this->testTenantId,
            'setting_key' => 'email_verification',
            'setting_value' => 'false',
            'setting_type' => 'boolean',
        ]);
        $settings->clearCacheForTenant($this->testTenantId);
        $this->assertFalse($settings->requiresEmailVerification($this->testTenantId));

        $this->actAsPlatformSuperAdmin();
        $this->apiPut('/v2/admin/settings', ['email_verification' => 'true'])
            ->assertStatus(200);

        $this->apiGet('/v2/admin/settings')
            ->assertStatus(200)
            ->assertJsonPath('data.settings.email_verification', 'true');

        $settings->clearCacheForTenant($this->testTenantId);
        $this->assertTrue(
            $settings->requiresEmailVerification($this->testTenantId),
            'the administrator was shown "email verification required" and the gate must agree',
        );

        $gate = $settings->checkLoginGatesForUser($this->unverifiedMemberRow());
        $this->assertIsArray(
            $gate,
            'an account with no verified email must be refused at the login gate',
        );
        $this->assertSame('AUTH_EMAIL_NOT_VERIFIED', $gate['code']);
    }

    // ------------------------------------------------------------------
    //  CONTROL 1 — the community with NO bare row still works.
    //  This arm passes today and must keep passing.
    // ------------------------------------------------------------------

    public function test_control_with_no_bare_row_the_toggle_still_takes_effect(): void
    {
        $settings = app(TenantSettingsService::class);

        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->whereIn('setting_key', ['admin_approval', 'email_verification'])
            ->delete();
        DB::table('tenant_settings')->insert([
            'tenant_id' => $this->testTenantId,
            'setting_key' => 'general.admin_approval',
            'setting_value' => 'false',
            'setting_type' => 'boolean',
        ]);
        $settings->clearCacheForTenant($this->testTenantId);
        $this->assertFalse($settings->requiresAdminApproval($this->testTenantId));

        $this->actAsPlatformSuperAdmin();
        $this->apiPut('/v2/admin/settings', ['admin_approval' => 'true'])
            ->assertStatus(200);

        $settings->clearCacheForTenant($this->testTenantId);
        $this->assertTrue($settings->requiresAdminApproval($this->testTenantId));

        $memberId = $this->makePendingSignup();
        $this->assertTrue(app(RegistrationService::class)->verifyEmail($this->tokenFor($memberId)));

        $row = DB::table('users')->where('id', $memberId)->first(['status', 'is_approved']);
        $this->assertSame('pending', (string) $row->status);
        $this->assertSame(0, (int) $row->is_approved);
    }

    // ------------------------------------------------------------------
    //  CONTROL 2 — switching the requirement OFF genuinely lets people in.
    //  A fix that simply pinned both settings to "on" would fail here.
    // ------------------------------------------------------------------

    public function test_control_switching_approval_off_lets_the_next_signup_straight_in(): void
    {
        $settings = app(TenantSettingsService::class);

        // A plain open registration policy, so the only thing deciding
        // activation is the approval toggle (an identity-verification or
        // waitlist policy holds the account for its own reasons).
        RegistrationPolicyService::upsertPolicy($this->testTenantId, [
            'registration_mode' => 'open',
            'require_email_verify' => true,
        ]);

        // Start from the secure default every new community is seeded with:
        // approval ON.
        $this->storeSetting('admin_approval', 'true');
        $this->storeSetting('general.admin_approval', 'true');
        $settings->clearCacheForTenant($this->testTenantId);
        $this->assertTrue($settings->requiresAdminApproval($this->testTenantId));

        $this->actAsPlatformSuperAdmin();
        $this->apiPut('/v2/admin/settings', ['admin_approval' => 'false'])
            ->assertStatus(200);

        $settings->clearCacheForTenant($this->testTenantId);
        $this->assertFalse(
            $settings->requiresAdminApproval($this->testTenantId),
            'CONTROL: an administrator who switches approval off must be obeyed',
        );

        $memberId = $this->makePendingSignup();
        $this->assertTrue(app(RegistrationService::class)->verifyEmail($this->tokenFor($memberId)));

        $row = DB::table('users')->where('id', $memberId)->first(['status', 'is_approved']);
        $this->assertSame('active', (string) $row->status);
        $this->assertSame(1, (int) $row->is_approved);
    }

    public function test_control_switching_email_verification_off_lets_an_unverified_login_through(): void
    {
        $settings = app(TenantSettingsService::class);

        DB::table('tenant_settings')->insert([
            'tenant_id' => $this->testTenantId,
            'setting_key' => 'email_verification',
            'setting_value' => 'true',
            'setting_type' => 'boolean',
        ]);
        $settings->clearCacheForTenant($this->testTenantId);
        $this->assertTrue($settings->requiresEmailVerification($this->testTenantId));

        $this->actAsPlatformSuperAdmin();
        $this->apiPut('/v2/admin/settings', ['email_verification' => 'false'])
            ->assertStatus(200);

        $settings->clearCacheForTenant($this->testTenantId);
        $this->assertFalse(
            $settings->requiresEmailVerification($this->testTenantId),
            'CONTROL: an administrator who switches email verification off must be obeyed',
        );

        $this->assertNull(
            $settings->checkLoginGatesForUser($this->unverifiedMemberRow()),
            'CONTROL: with the requirement off, an unverified address passes',
        );
    }

    // ------------------------------------------------------------------
    //  The registration-policy page and the settings page must not be able
    //  to leave the two stored keys disagreeing with each other.
    // ------------------------------------------------------------------

    public function test_a_registration_policy_save_leaves_both_stored_keys_agreeing(): void
    {
        RegistrationPolicyService::upsertPolicy($this->testTenantId, [
            'registration_mode' => 'open_with_approval',
            'require_email_verify' => true,
        ]);
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);

        foreach (['admin_approval', 'email_verification'] as $key) {
            $this->assertSame(
                $this->settingValue($key),
                $this->settingValue('general.' . $key),
                "the two stored copies of {$key} must never disagree",
            );
            $this->assertNotNull($this->settingValue('general.' . $key));
        }

        $this->assertTrue(app(TenantSettingsService::class)->requiresAdminApproval($this->testTenantId));
    }

    // ------------------------------------------------------------------

    private function actAsPlatformSuperAdmin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'is_super_admin' => true,
        ]);

        $this->withHeaders([
            'Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
                $admin->id,
                $admin->tenant_id,
                TwoFactorPolicy::claims('totp'),
            ),
        ]);
    }

    private function storeSetting(string $key, string $value): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
            ['setting_value' => $value, 'setting_type' => 'boolean'],
        );
    }

    private function settingValue(string $key): ?string
    {
        $value = DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', $key)
            ->value('setting_value');

        return $value === null ? null : (string) $value;
    }

    /** A signed-up account awaiting email verification. */
    private function makePendingSignup(): int
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'pending',
            'is_approved' => 0,
            'email_verified_at' => null,
            'verification_token' => Str::random(64),
            'balance' => 0,
        ]);

        return (int) $user->id;
    }

    private function tokenFor(int $userId): string
    {
        return (string) DB::table('users')->where('id', $userId)->value('verification_token');
    }

    private function walletTransactionCount(int $userId): int
    {
        return (int) DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('receiver_id', $userId)
            ->count();
    }

    /** @return array<string, mixed> */
    private function unverifiedMemberRow(): array
    {
        return [
            'role' => 'member',
            'status' => 'active',
            'tenant_id' => $this->testTenantId,
            'is_approved' => 1,
            'email_verified_at' => null,
            'date_of_birth' => '1980-01-01',
        ];
    }
}
