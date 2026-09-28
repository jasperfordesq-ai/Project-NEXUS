<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E055;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\Identity\IdentityProviderRegistry;
use App\Services\Identity\IdentityVerificationProviderInterface;
use App\Services\Identity\IdentityVerificationSessionService;
use App\Services\MemberVerificationBadgeService;
use App\Support\Authorization\MinimumAge;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-240 (E-055 A-1): a PASSED identity document showing the holder is under 18
 * must not activate, approve or badge the account. The verification is recorded
 * as failed, the document date of birth is stored when the profile has none, and
 * the platform-wide age gate then refuses sign-in.
 *
 * Control: the same flow with an adult document still activates and signs in.
 */
class F240IdentityVerificationMinimumAgeTest extends TestCase
{
    use DatabaseTransactions;

    private const PASSWORD = 'F240-synthetic-Pass-9xQ!';

    protected function tearDown(): void
    {
        IdentityProviderRegistry::reset();
        parent::tearDown();
    }

    /** @return array{year:int,month:int,day:int} */
    private function minorDob(): array
    {
        return ['year' => (int) date('Y') - 14, 'month' => 1, 'day' => 15];
    }

    public function test_passed_webhook_for_a_minor_document_does_not_activate_badge_or_sign_in(): void
    {
        $docDob = $this->minorDob();
        $docDobStr = sprintf('%04d-%02d-%02d', $docDob['year'], $docDob['month'], $docDob['day']);
        $this->assertTrue(MinimumAge::isUnder($docDobStr), 'fixture sanity: document holder is under 18');

        $outcome = $this->runWebhookVerification('f240_minor_idp', 'sess_f240_minor', $docDob, 'none');

        $this->assertSame('failed', $outcome['session_status']);
        $this->assertNotEmpty($outcome['failure_reason']);
        $this->assertSame(0, $outcome['is_approved']);
        $this->assertNotSame('active', $outcome['status']);
        $this->assertSame('failed', $outcome['verification_status']);
        $this->assertFalse($outcome['has_id_badge']);
        $this->assertSame($docDobStr, $outcome['date_of_birth'], 'document date of birth stored on the profile');
        $this->assertNotSame(200, $outcome['login_status']);
        $this->assertEmpty($outcome['login_access_token']);

        // The stored document date of birth now drives the platform-wide age
        // gate: even if the account is later approved and activated (e.g. by an
        // administrator), sign-in is refused as under the minimum age.
        DB::table('users')->where('id', $outcome['user_id'])->update(['is_approved' => 1, 'status' => 'active']);
        $later = $this->apiPost('/auth/login', ['email' => $outcome['email'], 'password' => self::PASSWORD]);
        $this->assertNotSame(200, $later->getStatusCode());
        $this->assertEmpty($later->json('access_token'));
        $this->assertStringContainsString(MinimumAge::ACCOUNT_ERROR_CODE, $later->getContent());
    }

    public function test_minor_document_is_not_released_by_the_native_registration_fallback(): void
    {
        $outcome = $this->runWebhookVerification('f240_minor_fb_idp', 'sess_f240_minor_fb', $this->minorDob(), 'native_registration');

        $this->assertSame('failed', $outcome['session_status']);
        $this->assertSame(0, $outcome['is_approved'], 'fallback must not approve an under-18 account');
        $this->assertNotSame('active', $outcome['status']);
        $this->assertFalse($outcome['has_id_badge']);
        $this->assertNotSame(200, $outcome['login_status']);
    }

    public function test_scheduled_poll_does_not_badge_a_minor_and_stores_the_birth_date(): void
    {
        $slug = 'f240_minor_cron_idp';
        $user = $this->pendingApplicant();
        $this->useVerifiedIdentityPolicy($slug, 'none');
        IdentityProviderRegistry::register($this->fakeProvider($slug, $this->passedOutputs($this->minorDob())));

        $sessionId = IdentityVerificationSessionService::create(
            $this->testTenantId, (int) $user->id, $slug, 'document_only', ['provider_session_id' => 'sess_f240_cron']
        );
        DB::table('identity_verification_sessions')->where('id', $sessionId)->update([
            'status' => 'processing',
            'updated_at' => now()->subHour(),
        ]);

        Artisan::call('nexus:identity:poll-stuck', ['--minutes' => 5]);

        $this->assertSame('failed', DB::table('identity_verification_sessions')->where('id', $sessionId)->value('status'));
        $this->assertFalse($this->hasIdBadge((int) $user->id));
        $dob = $this->minorDob();
        $this->assertSame(
            sprintf('%04d-%02d-%02d', $dob['year'], $dob['month'], $dob['day']),
            (string) DB::table('users')->where('id', $user->id)->value('date_of_birth')
        );
    }

    public function test_control_passed_adult_document_activates_and_signs_in(): void
    {
        $outcome = $this->runWebhookVerification('f240_adult_idp', 'sess_f240_adult', ['year' => 1990, 'month' => 1, 'day' => 15], 'none');

        $this->assertSame('passed', $outcome['session_status']);
        $this->assertSame(1, $outcome['is_approved']);
        $this->assertSame('active', $outcome['status']);
        $this->assertTrue($outcome['has_id_badge']);
        $this->assertSame(200, $outcome['login_status']);
        $this->assertNotEmpty($outcome['login_access_token']);
    }

    private function useVerifiedIdentityPolicy(string $slug, string $fallbackMode): void
    {
        TenantContext::setById($this->testTenantId);
        DB::table('tenant_registration_policies')->where('tenant_id', $this->testTenantId)->delete();
        DB::table('tenant_registration_policies')->insert([
            'tenant_id' => $this->testTenantId,
            'registration_mode' => 'verified_identity',
            'verification_provider' => $slug,
            'verification_level' => 'document_only',
            'post_verification' => 'activate',
            'fallback_mode' => $fallbackMode,
            'require_email_verify' => 0,
            'is_active' => 1,
            'created_at' => now(),
        ]);
    }

    private function pendingApplicant(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Synthia',
            'last_name' => 'Fixture',
            'email' => 'f240.' . bin2hex(random_bytes(4)) . '@example.test',
            'status' => 'pending',
            'is_approved' => 0,
            'date_of_birth' => null,
        ]);
        DB::table('users')->where('id', $user->id)->update([
            'password_hash' => password_hash(self::PASSWORD, PASSWORD_ARGON2ID),
            'verification_status' => 'pending',
            'email_verified_at' => now(),
            'date_of_birth' => null,
        ]);
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    /** @param array{year:int,month:int,day:int} $docDob */
    private function passedOutputs(array $docDob): array
    {
        return [
            'status' => 'passed',
            'verified_first_name' => 'Synthia',
            'verified_last_name' => 'Fixture',
            'verified_dob' => $docDob,
        ];
    }

    private function hasIdBadge(int $userId): bool
    {
        $badges = app(MemberVerificationBadgeService::class)->getUserBadges($userId);

        return collect($badges)->contains(fn ($b) => ($b['badge_type'] ?? null) === 'id_verified');
    }

    /**
     * @param array{year:int,month:int,day:int} $docDob
     * @return array<string,mixed>
     */
    private function runWebhookVerification(string $slug, string $providerSessionId, array $docDob, string $fallbackMode): array
    {
        $this->useVerifiedIdentityPolicy($slug, $fallbackMode);
        $user = $this->pendingApplicant();

        IdentityProviderRegistry::register($this->fakeProvider($slug, $this->passedOutputs($docDob)));

        $sessionId = IdentityVerificationSessionService::create(
            $this->testTenantId,
            (int) $user->id,
            $slug,
            'document_only',
            ['provider_session_id' => $providerSessionId]
        );

        $this->apiPost("/v2/webhooks/identity/{$slug}", [
            'session_id' => $providerSessionId,
            'result' => 'passed',
        ])->assertOk();

        $row = DB::table('users')->where('id', $user->id)
            ->first(['status', 'is_approved', 'date_of_birth', 'email', 'verification_status']);
        $session = DB::table('identity_verification_sessions')->where('id', $sessionId)->first(['status', 'failure_reason']);

        $login = $this->apiPost('/auth/login', [
            'email' => $row->email,
            'password' => self::PASSWORD,
        ]);

        return [
            'session_status' => $session->status,
            'failure_reason' => $session->failure_reason,
            'status' => (string) $row->status,
            'is_approved' => (int) $row->is_approved,
            'verification_status' => (string) $row->verification_status,
            'date_of_birth' => $row->date_of_birth === null ? null : (string) $row->date_of_birth,
            'has_id_badge' => $this->hasIdBadge((int) $user->id),
            'login_status' => $login->getStatusCode(),
            'login_access_token' => $login->json('access_token'),
            'user_id' => (int) $user->id,
            'email' => (string) $row->email,
        ];
    }

    private function fakeProvider(string $slug, array $verifiedOutputs): IdentityVerificationProviderInterface
    {
        return new class($slug, $verifiedOutputs) implements IdentityVerificationProviderInterface {
            public function __construct(private string $slug, private array $verifiedOutputs) {}
            public function getSlug(): string { return $this->slug; }
            public function getName(): string { return 'F240 fake IDP'; }
            public function getSupportedLevels(): array { return ['document_only']; }
            public function createSession(int $userId, int $tenantId, string $level, array $metadata = []): array
            {
                return ['provider_session_id' => 'sess_' . $this->slug];
            }
            public function getSessionStatus(string $providerSessionId): array { return $this->verifiedOutputs; }
            public function handleWebhook(array $payload, array $headers): array
            {
                return [
                    'provider_session_id' => $payload['session_id'] ?? '',
                    'status' => $payload['result'] ?? 'passed',
                ];
            }
            public function verifyWebhookSignature(string $rawBody, array $headers): bool { return true; }
            public function cancelSession(string $providerSessionId): bool { return true; }
            public function isAvailable(int $tenantId): bool { return true; }
        };
    }
}
