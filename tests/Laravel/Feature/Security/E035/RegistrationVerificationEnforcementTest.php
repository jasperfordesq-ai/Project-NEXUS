<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Services\Identity\RegistrationOrchestrationService;
use App\Services\Identity\RegistrationPolicyService;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Testing\TestResponse;
use Tests\Laravel\TestCase;

/**
 * E-035 F-152 — a community whose registration policy requires identity
 * verification (verified_identity / government_id) or runs a waitlist must not
 * hand a working login to an email/password sign-up that never verified.
 *
 * Before the fix only OAuth sign-up ran the policy orchestration; the email
 * path went active + approved on email verification and signed in with
 * verification_status = none.
 */
final class RegistrationVerificationEnforcementTest extends TestCase
{
    use DatabaseTransactions;

    private const PASSWORD = 'CoffeeMugSundayMorningPhpUnitTest2026';

    private const POLICY_SETTING_KEYS = [
        'general.registration_mode', 'general.admin_approval',
        'registration_mode', 'admin_approval', 'email_verification',
    ];

    /** @var array<string,mixed>|null */
    private ?array $policySnapshot = null;

    /** @var array<int,array<string,mixed>> */
    private array $settingsSnapshot = [];

    protected function setUp(): void
    {
        parent::setUp();
        // Sign-up and login paths run `CREATE TABLE IF NOT EXISTS` guards
        // (login_attempts, email_verification_tokens), and MariaDB commits the
        // open test transaction on any DDL. Snapshot the tenant's registration
        // policy so tearDown can put it back even when the rollback cannot.
        $policy = DB::table('tenant_registration_policies')->where('tenant_id', $this->testTenantId)->first();
        $this->policySnapshot = $policy ? (array) $policy : null;
        $this->settingsSnapshot = DB::table('tenant_settings')->where('tenant_id', $this->testTenantId)
            ->whereIn('setting_key', self::POLICY_SETTING_KEYS)->get()
            ->map(static fn ($row): array => (array) $row)->all();
        foreach (['api:registration:ip:127.0.0.1', 'register_success_ip:127.0.0.1', 'api:verify_email:ip:127.0.0.1'] as $key) {
            RateLimiter::clear($key);
        }
        Cache::forget('register_tenant_breaker:' . $this->testTenantId);
        Cache::forget('register_tenant_hourly:' . $this->testTenantId);
        $this->fakeEmail();
    }

    protected function tearDown(): void
    {
        try {
            DB::table('tenant_registration_policies')->where('tenant_id', $this->testTenantId)->delete();
            if ($this->policySnapshot !== null) {
                DB::table('tenant_registration_policies')->insert($this->policySnapshot);
            }
            DB::table('tenant_settings')->where('tenant_id', $this->testTenantId)
                ->whereIn('setting_key', self::POLICY_SETTING_KEYS)->delete();
            foreach ($this->settingsSnapshot as $row) {
                DB::table('tenant_settings')->insert($row);
            }
            try {
                DB::table('users')->where('tenant_id', $this->testTenantId)
                    ->where('email', 'like', 'e035-f152-%')->delete();
            } catch (\Throwable) {
                // Dependent rows may pin a user; unique addresses are harmless.
            }
            app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
        } finally {
            parent::tearDown();
        }
    }

    private function fakeEmail(): void
    {
        $stub = new class extends \App\Services\EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return true;
            }
        };
        $this->app->instance(\App\Services\EmailDispatchService::class, $stub);
    }

    /** @param array<string,mixed> $policy */
    private function setPolicy(array $policy): void
    {
        DB::table('tenant_settings')->where('tenant_id', $this->testTenantId)
            ->whereIn('setting_key', [
                'general.registration_mode', 'general.admin_approval',
                'registration_mode', 'admin_approval',
            ])->delete();
        RegistrationPolicyService::upsertPolicy($this->testTenantId, $policy + [
            'require_email_verify' => 1,
        ]);
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
    }

    private function register(string $email): TestResponse
    {
        return $this->apiPost('/v2/auth/register', [
            'first_name' => 'Policy', 'last_name' => 'Case', 'email' => $email,
            'location' => 'Toronto, Canada', 'phone' => '+15551234567',
            'password' => self::PASSWORD,
            'password_confirmation' => self::PASSWORD,
            'terms_accepted' => true,
            'form_started_at' => (int) (microtime(true) * 1000) - 6000,
            'latitude' => 43.6532, 'longitude' => -79.3832,
        ]);
    }

    private function verifyEmail(int $userId): TestResponse
    {
        $raw = bin2hex(random_bytes(32));
        DB::table('email_verification_tokens')->where('user_id', $userId)->delete();
        DB::table('email_verification_tokens')->insert([
            'user_id' => $userId, 'tenant_id' => $this->testTenantId,
            'token' => hash('sha256', $raw), 'created_at' => now(), 'expires_at' => now()->addHour(),
        ]);

        return $this->apiPost('/auth/verify-email', ['token' => $raw]);
    }

    private function login(string $email): TestResponse
    {
        RateLimiter::clear('login:' . $email);
        return $this->apiPost('/auth/login', ['email' => $email, 'password' => self::PASSWORD]);
    }

    /** @return array{0:TestResponse,1:object} */
    private function signUpAndVerify(string $label): array
    {
        $email = 'e035-f152-' . $label . '-' . uniqid() . '@gmail.com';
        $reg = $this->register($email);
        $this->assertContains($reg->getStatusCode(), [200, 201], (string) $reg->getContent());

        $user = DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $email)->first();
        $this->assertNotNull($user);
        $this->verifyEmail((int) $user->id)->assertStatus(200);

        return [$reg, $user];
    }

    /** @return array<string, array{0:string}> */
    public static function verificationModes(): array
    {
        return ['verified_identity' => ['verified_identity'], 'government_id' => ['government_id']];
    }

    /** @dataProvider verificationModes */
    public function test_email_signup_cannot_sign_in_before_identity_verification(string $mode): void
    {
        $this->setPolicy([
            'registration_mode' => $mode,
            'verification_provider' => 'mock',
            'verification_level' => 'document_only',
            'post_verification' => 'activate',
        ]);

        [$reg, $user] = $this->signUpAndVerify($mode);
        $reg->assertJsonPath('data.requires_identity_verification', true);

        $row = DB::table('users')->where('id', $user->id)->first(['status', 'is_approved', 'verification_status']);
        $this->assertSame('pending', $row->verification_status, 'sign-up must be marked as awaiting identity verification');
        $this->assertSame(0, (int) $row->is_approved, 'email verification must not approve an unverified identity');

        $login = $this->login($user->email);
        $login->assertStatus(403);
        $this->assertStringNotContainsString('access_token', (string) $login->getContent());
        $this->assertSame('AUTH_PENDING_VERIFICATION', $login->json('errors.0.code') ?? $login->json('code'));
    }

    public function test_member_signs_in_once_identity_verification_passes(): void
    {
        $this->setPolicy([
            'registration_mode' => 'verified_identity',
            'verification_provider' => 'mock',
            'verification_level' => 'document_only',
            'post_verification' => 'activate',
        ]);

        [, $user] = $this->signUpAndVerify('passes');
        RegistrationOrchestrationService::applyPostVerificationAction((int) $user->id, $this->testTenantId, 'passed');

        $this->login($user->email)->assertStatus(200);
    }

    public function test_waitlist_signup_is_not_activated_by_email_verification(): void
    {
        $this->setPolicy(['registration_mode' => 'waitlist']);

        [$reg, $user] = $this->signUpAndVerify('waitlist');
        $reg->assertJsonPath('data.requires_waitlist', true);

        $row = DB::table('users')->where('id', $user->id)->first(['status', 'is_approved', 'verification_status']);
        $this->assertSame(0, (int) $row->is_approved);
        $this->assertSame('pending', $row->status);
        $this->assertContains($row->verification_status, ['none', 'pending'], 'must never write a value outside the column enum');

        $this->login($user->email)->assertStatus(403);
    }

    public function test_open_mode_still_activates_on_email_verification(): void
    {
        $this->setPolicy(['registration_mode' => 'open']);

        [, $user] = $this->signUpAndVerify('open');

        $this->login($user->email)->assertStatus(200);
    }

    public function test_open_with_approval_still_waits_for_an_administrator(): void
    {
        $this->setPolicy(['registration_mode' => 'open_with_approval']);

        [$reg, $user] = $this->signUpAndVerify('approval');
        $reg->assertJsonPath('data.requires_approval', true);

        $login = $this->login($user->email);
        $login->assertStatus(403);
        $this->assertSame('AUTH_ACCOUNT_PENDING_APPROVAL', $login->json('errors.0.code') ?? $login->json('code'));
    }

    public function test_login_gate_refuses_unapproved_unverified_member_in_verification_community(): void
    {
        $this->setPolicy([
            'registration_mode' => 'government_id',
            'verification_provider' => 'mock',
            'verification_level' => 'document_only',
        ]);

        $gate = app(TenantSettingsService::class)->checkLoginGatesForUser([
            'id' => 999999, 'role' => 'member', 'tenant_id' => $this->testTenantId,
            'status' => 'active', 'is_approved' => 0, 'verification_status' => 'none',
            'email_verified_at' => now()->toDateTimeString(),
        ]);

        $this->assertNotNull($gate);
        $this->assertSame('AUTH_PENDING_VERIFICATION', $gate['code']);
    }
}
