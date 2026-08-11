<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Auth;

use App\Models\Tenant;
use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Tests\Laravel\TestCase;

/**
 * A community that has no domain of its own is served at
 * `<parent-domain>/<slug>` (e.g. `uk.timebank.global/minehead-and-coast-timebank`).
 * Arriving at the parent domain ROOT resolves the PARENT tenant, so before this
 * fix a strict `tenant_id = ?` lookup could not see the member's account:
 *
 *   - login failed with no explanation, and
 *   - forgot-password sent NOTHING while still telling the member to check
 *     their inbox.
 *
 * Both entry points must now search the resolved tenant's own subtree, and must
 * not reach outside it.
 */
class SubCommunityEntryPointsTest extends TestCase
{
    use DatabaseTransactions;

    private int $hubTenantId;
    private int $childTenantId;
    private int $unrelatedTenantId;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
        foreach (['forgot_password', 'login'] as $action) {
            foreach (['127.0.0.1', '::1', ''] as $ip) {
                RateLimiter::clear("api:{$action}:ip:{$ip}");
            }
        }

        // A hub with one community beneath it, plus an unrelated community that
        // the hub must never be able to reach. Paths are deliberately outside
        // the seeded `/1/4/...` tree so real tenants cannot affect the result.
        // Unique domain per run — `tenants.domain` is UNIQUE, and a run aborted
        // mid-transaction can leave a fixed value behind.
        $unique = str_replace('.', '', uniqid('', true));

        $hub = Tenant::factory()->create([
            'domain' => "hub-{$unique}.example.test",
            'path' => '/9000/',
            'depth' => 0,
            'parent_id' => null,
            'allows_subtenants' => true,
            'is_active' => true,
        ]);
        $this->hubTenantId = (int) $hub->id;

        $child = Tenant::factory()->create([
            // No domain of its own — this is the whole point.
            'domain' => null,
            'path' => '/9000/' . $hub->id . '/',
            'depth' => 1,
            'parent_id' => $this->hubTenantId,
            'allows_subtenants' => false,
            'is_active' => true,
        ]);
        $this->childTenantId = (int) $child->id;

        $unrelated = Tenant::factory()->create([
            'domain' => null,
            'path' => '/9500/',
            'depth' => 0,
            'parent_id' => null,
            'is_active' => true,
        ]);
        $this->unrelatedTenantId = (int) $unrelated->id;
    }

    private function memberIn(int $tenantId, string $email, string $password): User
    {
        return User::factory()->forTenant($tenantId)->create([
            'email' => $email,
            'status' => 'active',
            'is_approved' => true,
            'is_verified' => true,
            // The login gate checks `email_verified_at`, not `is_verified` —
            // setting only the boolean still trips AUTH_EMAIL_NOT_VERIFIED.
            'email_verified_at' => now(),
            'password_hash' => Hash::make($password),
        ]);
    }

    // ------------------------------------------------------------------
    //  forgot-password
    // ------------------------------------------------------------------

    public function test_forgot_password_reaches_a_sub_community_member_from_the_parent_domain(): void
    {
        $email = 'sub-reset-' . uniqid('', true) . '@example.test';
        $this->memberIn($this->childTenantId, $email, 'old-password-123456');

        $mailer = new RecordingEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);

        // Request arrives on the HUB, as it would at the parent domain root.
        $response = $this->withTenant($this->hubTenantId)
            ->apiPost('/auth/forgot-password', ['email' => $email]);

        $response->assertStatus(200);

        // The email must actually have been dispatched, and against the CHILD.
        $this->assertCount(1, $mailer->calls, 'No reset email was dispatched.');
        $this->assertSame($email, $mailer->calls[0]['to']);
        $this->assertSame('password_reset', $mailer->calls[0]['options']['category']);
        $this->assertSame($this->childTenantId, $mailer->calls[0]['options']['tenant_id']);

        // A password_resets row is written only after the mailer accepts, so its
        // presence is the authoritative proof a reset was really issued.
        $this->assertSame(1, DB::table('password_resets')
            ->where('email', $email)
            ->where('tenant_id', $this->childTenantId)
            ->count());
    }

    public function test_forgot_password_does_not_reach_a_community_outside_the_hub_subtree(): void
    {
        $email = 'outside-reset-' . uniqid('', true) . '@example.test';
        $this->memberIn($this->unrelatedTenantId, $email, 'old-password-123456');

        $mailer = new RecordingEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);

        $response = $this->withTenant($this->hubTenantId)
            ->apiPost('/auth/forgot-password', ['email' => $email]);

        // Still a generic 200 — revealing "no such account" here would turn the
        // endpoint into an email-enumeration oracle.
        $response->assertStatus(200);
        $this->assertCount(0, $mailer->calls, 'Reset escaped the hub subtree.');
        $this->assertSame(0, DB::table('password_resets')->where('email', $email)->count());
    }

    public function test_forgot_password_sends_nothing_when_two_sub_communities_share_the_address(): void
    {
        $secondChild = Tenant::factory()->create([
            'domain' => null,
            'path' => '/9000/sibling-' . uniqid('', false) . '/',
            'depth' => 1,
            'parent_id' => $this->hubTenantId,
            'is_active' => true,
        ]);

        $email = 'ambiguous-reset-' . uniqid('', true) . '@example.test';
        $this->memberIn($this->childTenantId, $email, 'old-password-123456');
        $this->memberIn((int) $secondChild->id, $email, 'other-password-123456');

        $mailer = new RecordingEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);

        $response = $this->withTenant($this->hubTenantId)
            ->apiPost('/auth/forgot-password', ['email' => $email]);

        // We cannot tell which community was meant, so we send nothing rather
        // than guess or issue two tokens. The member uses their own slug link.
        $response->assertStatus(200);
        $this->assertCount(0, $mailer->calls);
    }

    // ------------------------------------------------------------------
    //  login
    // ------------------------------------------------------------------

    public function test_login_signs_in_a_sub_community_member_from_the_parent_domain(): void
    {
        $email = 'sub-login-' . uniqid('', true) . '@example.test';
        $password = 'sub-community-pass-123';
        $member = $this->memberIn($this->childTenantId, $email, $password);

        $response = $this->withTenant($this->hubTenantId)
            ->apiPost('/auth/login', ['email' => $email, 'password' => $password]);

        $response->assertStatus(200);

        // Whatever the envelope shape, the account signed in must be the
        // sub-community one, not a hub account.
        $this->assertStringContainsString(
            (string) $member->id,
            json_encode($response->json(), JSON_THROW_ON_ERROR),
            'Login did not return the sub-community member.'
        );
    }

    public function test_login_does_not_sign_in_a_member_outside_the_hub_subtree(): void
    {
        $email = 'outside-login-' . uniqid('', true) . '@example.test';
        $password = 'outside-pass-123456';
        $this->memberIn($this->unrelatedTenantId, $email, $password);

        $response = $this->withTenant($this->hubTenantId)
            ->apiPost('/auth/login', ['email' => $email, 'password' => $password]);

        $this->assertNotSame(
            200,
            $response->getStatusCode(),
            'Login escaped the hub subtree into an unrelated community.'
        );
    }
}

/**
 * Records dispatches instead of sending. `EmailDispatchService::sendRaw()` is
 * static but resolves `app(self::class)->send(...)`, so a container binding is
 * enough to intercept it.
 */
class RecordingEmailDispatchService extends EmailDispatchService
{
    /** @var list<array{to: string, subject: string, body: string, options: array<string, mixed>}> */
    public array $calls = [];

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->calls[] = compact('to', 'subject', 'body', 'options');

        return true;
    }
}
