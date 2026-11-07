<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Auth;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TokenService;
use App\Services\TotpService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use OTPHP\TOTP;
use Tests\Laravel\TestCase;

/**
 * The key a member adds to their authenticator app (November 2026 polish).
 *
 * - New keys are 160 bits: 32 base32 characters, the length RFC 4226 §4
 *   recommends and the one most services use. The library default was 512
 *   bits (103 characters), which nobody can reasonably type by hand, and a
 *   member on a phone or using a screen reader has to type it: a phone cannot
 *   scan its own screen, and a screen reader cannot read a QR code.
 * - The set-up response carries `provisioning_uri` (the `otpauth://` link the
 *   QR code encodes), so a member setting up on the same phone can open their
 *   authenticator app directly.
 * - Keys issued before this change keep working.
 */
class TwoFactorSetupKeyTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        // Real bearer tokens, not Sanctum::actingAs (see E035 TwoFactorEnrolmentStepUpTest).
        \Tests\Laravel\Support\ActingAsVerifiedAdministrator::$disabled = true;
    }

    private function member(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        DB::table('users')->where('id', $u->id)->update([
            'role' => 'admin', 'is_super_admin' => 0, 'is_tenant_super_admin' => 0, 'is_god' => 0,
        ]);
        return $u->refresh();
    }

    /** @return array<string, mixed> the `data` of a successful set-up response */
    private function startSetup(User $u): array
    {
        $tokens = app(TokenService::class);
        $bearer = $tokens->generateToken((int) $u->id, $this->testTenantId, TwoFactorPolicy::claims('totp'));
        $confirmation = $tokens->generateSecurityConfirmationToken((int) $u->id, $this->testTenantId, 'password');

        $res = $this->apiPost('/v2/auth/2fa/setup', [
            'security_confirmation_token' => $confirmation,
        ], ['Authorization' => 'Bearer ' . $bearer]);

        $this->assertSame(200, $res->status(), 'set-up did not start: ' . $res->getContent());

        return (array) $res->json('data');
    }

    public function test_a_new_key_is_32_base32_characters(): void
    {
        $secret = TotpService::generateSecret();

        $this->assertSame(32, strlen($secret), 'a new key should be 160 bits (32 base32 characters)');
        $this->assertMatchesRegularExpression('/^[A-Z2-7]{32}$/', $secret);
        $this->assertNotSame($secret, TotpService::generateSecret(), 'two keys in a row must differ');
    }

    public function test_the_setup_response_gives_the_short_key_and_an_open_in_app_link(): void
    {
        TenantContext::setById($this->testTenantId);
        $member = $this->member();

        $data = $this->startSetup($member);

        $secret = (string) ($data['secret'] ?? '');
        $this->assertMatchesRegularExpression('/^[A-Z2-7]{32}$/', $secret);

        $uri = (string) ($data['provisioning_uri'] ?? '');
        $this->assertStringStartsWith('otpauth://totp/', $uri);
        parse_str((string) parse_url($uri, PHP_URL_QUERY), $query);
        $this->assertSame($secret, $query['secret'] ?? null, 'the link must carry the same key as the QR code');
        $this->assertSame('Project NEXUS', $query['issuer'] ?? null);
        $this->assertStringContainsString(rawurlencode((string) $member->email), $uri);
    }

    public function test_a_key_issued_before_the_change_still_verifies(): void
    {
        // The library default this platform used until November 2026: 64 bytes.
        $legacy = TOTP::generate(null, 64)->getSecret();
        $this->assertSame(103, strlen($legacy));

        $this->assertTrue(TotpService::verifyCode($legacy, TOTP::createFromSecret($legacy)->now()));
    }
}
