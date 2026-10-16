<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\Identity;

use App\Models\User;
use App\Services\Identity\IdentityVerificationSessionService;
use App\Services\Identity\StripeIdentityProvider;
use App\Services\Identity\TenantProviderCredentialService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * A community may run Stripe Identity checks through its own Stripe account by
 * storing its own key and webhook secret. Sessions were already created with
 * that key, but status reads, cancellation and webhook signature checks used
 * the platform's key and secret only — so for such a community Stripe answered
 * 404 on every status read and every webhook was rejected as unsigned.
 *
 * These tests pin that the credentials follow the session's owner.
 */
final class StripeIdentityProviderTenantCredentialsTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_SESSION = 'vs_tenant_owned_session';
    private const PLATFORM_SESSION = 'vs_platform_owned_session';
    private const PLATFORM_SECRET = 'whsec_platform_secret';
    private const TENANT_SECRET = 'whsec_tenant_secret';

    private StripeIdentityProvider $provider;
    private int $otherTenantId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->provider = new StripeIdentityProvider();

        putenv('STRIPE_IDENTITY_SECRET_KEY=sk_test_platform');
        putenv('STRIPE_IDENTITY_WEBHOOK_SECRET=' . self::PLATFORM_SECRET);
        unset($_ENV['STRIPE_IDENTITY_SECRET_KEY'], $_ENV['STRIPE_IDENTITY_WEBHOOK_SECRET']);

        // This community runs checks through its own Stripe account.
        DB::table('tenant_provider_credentials')
            ->where('tenant_id', $this->testTenantId)->where('provider_slug', 'stripe_identity')->delete();
        TenantProviderCredentialService::save($this->testTenantId, 'stripe_identity', [
            'api_key' => 'sk_test_tenant_own',
            'webhook_secret' => self::TENANT_SECRET,
        ]);
        $member = User::factory()->forTenant($this->testTenantId)->create();
        IdentityVerificationSessionService::create($this->testTenantId, $member->id, 'stripe_identity', 'document_selfie', [
            'provider_session_id' => self::TENANT_SESSION,
        ]);

        // This community uses the platform's account (no stored credentials).
        $this->otherTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Platform Identity Tenant',
            'slug' => 'platform-identity-' . strtolower(\Illuminate\Support\Str::random(8)),
            'is_active' => true,
            'depth' => 0,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $otherMember = User::factory()->forTenant($this->otherTenantId)->create();
        IdentityVerificationSessionService::create($this->otherTenantId, $otherMember->id, 'stripe_identity', 'document_selfie', [
            'provider_session_id' => self::PLATFORM_SESSION,
        ]);
    }

    protected function tearDown(): void
    {
        putenv('STRIPE_IDENTITY_SECRET_KEY=');
        putenv('STRIPE_IDENTITY_WEBHOOK_SECRET=');
        parent::tearDown();
    }

    /** @return array<string,string> */
    private function signedHeaders(string $body, string $secret): array
    {
        $timestamp = time();
        $signature = hash_hmac('sha256', $timestamp . '.' . $body, $secret);

        return ['Stripe-Signature' => "t={$timestamp},v1={$signature}"];
    }

    private function eventBody(string $sessionId): string
    {
        return json_encode([
            'type' => 'identity.verification_session.verified',
            'data' => ['object' => ['id' => $sessionId, 'object' => 'identity.verification_session', 'status' => 'verified']],
        ], JSON_THROW_ON_ERROR);
    }

    public function test_a_session_owned_by_a_community_with_its_own_key_resolves_that_key_and_secret(): void
    {
        $creds = $this->provider->credentialsForSession(self::TENANT_SESSION);

        $this->assertSame('sk_test_tenant_own', $creds['api_key']);
        $this->assertSame(self::TENANT_SECRET, $creds['webhook_secret']);
        $this->assertSame($this->testTenantId, $creds['tenant_id']);
        $this->assertTrue($creds['uses_tenant_key']);
    }

    public function test_a_session_owned_by_a_community_without_credentials_resolves_the_platform_key(): void
    {
        $creds = $this->provider->credentialsForSession(self::PLATFORM_SESSION);

        $this->assertSame('sk_test_platform', $creds['api_key']);
        $this->assertSame(self::PLATFORM_SECRET, $creds['webhook_secret']);
        $this->assertFalse($creds['uses_tenant_key']);
    }

    public function test_an_unknown_session_resolves_the_platform_key(): void
    {
        $creds = $this->provider->credentialsForSession('vs_never_seen');

        $this->assertSame('sk_test_platform', $creds['api_key']);
        $this->assertNull($creds['tenant_id']);
    }

    public function test_webhook_from_the_communitys_own_stripe_account_is_accepted_with_its_own_secret(): void
    {
        $body = $this->eventBody(self::TENANT_SESSION);

        $this->assertTrue(
            $this->provider->verifyWebhookSignature($body, $this->signedHeaders($body, self::TENANT_SECRET)),
            'The community\'s own endpoint secret must verify its own webhooks',
        );
        $this->assertFalse(
            $this->provider->verifyWebhookSignature($body, $this->signedHeaders($body, self::PLATFORM_SECRET)),
            'The platform secret must not verify a webhook about a session on another Stripe account',
        );
    }

    public function test_webhook_about_a_platform_account_session_still_uses_the_platform_secret(): void
    {
        $body = $this->eventBody(self::PLATFORM_SESSION);

        $this->assertTrue($this->provider->verifyWebhookSignature($body, $this->signedHeaders($body, self::PLATFORM_SECRET)));
        $this->assertFalse($this->provider->verifyWebhookSignature($body, $this->signedHeaders($body, self::TENANT_SECRET)));
    }

    public function test_a_body_that_is_not_json_falls_back_to_the_platform_secret_and_still_requires_a_valid_signature(): void
    {
        $body = 'not json at all';

        $this->assertTrue($this->provider->verifyWebhookSignature($body, $this->signedHeaders($body, self::PLATFORM_SECRET)));
        $this->assertFalse($this->provider->verifyWebhookSignature($body, $this->signedHeaders($body, 'whsec_wrong')));
    }
}
