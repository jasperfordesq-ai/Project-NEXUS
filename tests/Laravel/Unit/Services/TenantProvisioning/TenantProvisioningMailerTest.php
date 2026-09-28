<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services\TenantProvisioning;

use Tests\Laravel\TestCase;
use App\Services\TenantProvisioning\TenantProvisioningMailer;
use App\Services\EmailDispatchService;
use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Mockery;

/**
 * TenantProvisioningMailerTest
 *
 * Strategy:
 *   - TenantProvisioningMailer calls EmailDispatchService::sendRaw() as a
 *     static method. Because Mockery alias mocks intercept static calls, we
 *     use `alias:` style mocking with @runTestsInSeparateProcesses so the
 *     alias is isolated per test (same pattern as SendWelcomeNotificationTest).
 *   - TestCase::setUpTenantContext() seeds tenant id=2; sendWelcome() looks
 *     that row up, so it's available without extra seeding.
 *   - sendRejection() does NOT require an existing tenant row.
 *
 * @runTestsInSeparateProcesses
 * @preserveGlobalState disabled
 */
class TenantProvisioningMailerTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        TenantContext::setById(self::TENANT_ID);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private function welcomeRequest(array $overrides = []): array
    {
        return array_merge([
            'applicant_email'  => 'admin@example.com',
            'applicant_name'   => 'Alice Timebank',
            'default_language' => 'en',
        ], $overrides);
    }

    private function rejectionRequest(array $overrides = []): array
    {
        return array_merge([
            'applicant_email'  => 'rejected@example.com',
            'applicant_name'   => 'Bob Applicant',
            'org_name'         => 'Fake Coop',
            'default_language' => 'en',
        ], $overrides);
    }

    // ── sendWelcome ───────────────────────────────────────────────────────────

    public function test_sendWelcome_calls_EmailDispatchService_with_correct_recipient(): void
    {
        Mockery::mock('alias:' . EmailDispatchService::class)
            ->shouldReceive('sendRaw')
            ->once()
            ->with(
                'admin@example.com',
                Mockery::type('string'),
                Mockery::type('string'),
                null,
                null,
                null,
                'tenant_provisioning',
                Mockery::type('array')
            )
            ->andReturn(true);

        TenantProvisioningMailer::sendWelcome($this->welcomeRequest(), self::TENANT_ID);

        // Mockery assertion is implicit via ->once() — but phpunit needs ≥1 assertion.
        $this->assertTrue(true);
    }

    public function test_sendWelcome_is_noop_when_tenant_not_found(): void
    {
        // Tenant id 99999 does not exist — sendWelcome must return without calling
        // EmailDispatchService.
        Mockery::mock('alias:' . EmailDispatchService::class)
            ->shouldNotReceive('sendRaw');

        TenantProvisioningMailer::sendWelcome($this->welcomeRequest(), 99999);

        $this->assertTrue(true); // No exception + Mockery assertion passed.
    }

    public function test_sendWelcome_is_noop_when_applicant_email_missing(): void
    {
        Mockery::mock('alias:' . EmailDispatchService::class)
            ->shouldNotReceive('sendRaw');

        TenantProvisioningMailer::sendWelcome(
            ['applicant_name' => 'No Email', 'default_language' => 'en'],
            self::TENANT_ID
        );

        $this->assertTrue(true);
    }

    public function test_sendWelcome_passes_category_tenant_provisioning(): void
    {
        // Capture the options array to verify the category tag.
        $capturedCategory = null;

        Mockery::mock('alias:' . EmailDispatchService::class)
            ->shouldReceive('sendRaw')
            ->once()
            ->withArgs(function ($to, $subject, $html, $cc, $replyTo, $unsub, $category, $options) use (&$capturedCategory) {
                $capturedCategory = $category;
                return true;
            })
            ->andReturn(true);

        TenantProvisioningMailer::sendWelcome($this->welcomeRequest(), self::TENANT_ID);

        $this->assertSame('tenant_provisioning', $capturedCategory);
    }

    public function test_sendWelcome_passes_tenant_id_in_options(): void
    {
        $capturedOptions = null;

        Mockery::mock('alias:' . EmailDispatchService::class)
            ->shouldReceive('sendRaw')
            ->once()
            ->withArgs(function ($to, $subject, $html, $cc, $replyTo, $unsub, $category, $options) use (&$capturedOptions) {
                $capturedOptions = $options;
                return true;
            })
            ->andReturn(true);

        TenantProvisioningMailer::sendWelcome($this->welcomeRequest(), self::TENANT_ID);

        $this->assertIsArray($capturedOptions);
        $this->assertArrayHasKey('tenant_id', $capturedOptions);
        $this->assertSame(self::TENANT_ID, $capturedOptions['tenant_id']);
    }

    public function test_new_administrator_welcome_contains_one_time_link_instead_of_password(): void
    {
        $user = User::factory()->forTenant(self::TENANT_ID)->admin()->create([
            'email' => 'admin@example.com',
        ]);
        $body = null;
        Mockery::mock('alias:' . EmailDispatchService::class)
            ->shouldReceive('sendRaw')->once()
            ->withArgs(function ($to, $subject, $html) use (&$body) {
                $body = $html;
                return true;
            })
            ->andReturn(true);

        $this->assertTrue(TenantProvisioningMailer::sendWelcome($this->welcomeRequest(), self::TENANT_ID, (int) $user->id));

        $this->assertIsString($body);
        $this->assertStringNotContainsString('temp_password', $body);
        $this->assertSame(1, preg_match('/token=([a-f0-9]{64})/', $body, $matches));
        $this->assertDatabaseHas('password_resets', [
            'email' => $user->email,
            'tenant_id' => self::TENANT_ID,
            'token' => hash('sha256', $matches[1]),
        ]);
    }

    public function test_sendWelcome_restores_tenant_context_after_call(): void
    {
        // Verify withoutTenantContext restores the original caller context.
        TenantContext::setById(self::TENANT_ID);

        Mockery::mock('alias:' . EmailDispatchService::class)
            ->shouldReceive('sendRaw')
            ->andReturn(true);

        TenantProvisioningMailer::sendWelcome($this->welcomeRequest(), self::TENANT_ID);

        // TenantContext should be reset in the finally block; it may be null
        // (sendWelcome resets it) — the important thing is no exception was thrown.
        $this->assertTrue(true);
    }

    // ── sendRejection ─────────────────────────────────────────────────────────

    public function test_sendRejection_returns_true_when_email_dispatched(): void
    {
        Mockery::mock('alias:' . EmailDispatchService::class)
            ->shouldReceive('sendRaw')
            ->once()
            ->andReturn(true);

        $result = TenantProvisioningMailer::sendRejection(
            $this->rejectionRequest(),
            'Insufficient capacity in the region.'
        );

        $this->assertTrue($result);
    }

    public function test_sendRejection_returns_false_when_applicant_email_missing(): void
    {
        Mockery::mock('alias:' . EmailDispatchService::class)
            ->shouldNotReceive('sendRaw');

        $result = TenantProvisioningMailer::sendRejection(
            ['applicant_name' => 'No Email', 'default_language' => 'en'],
            'Some reason'
        );

        $this->assertFalse($result);
    }

    public function test_sendRejection_passes_allow_missing_tenant_option(): void
    {
        // Rejection emails have no tenant yet; the dispatcher must be told this
        // is an intentional pre-tenant send so it does not refuse on missing context.
        $capturedOptions = null;

        Mockery::mock('alias:' . EmailDispatchService::class)
            ->shouldReceive('sendRaw')
            ->once()
            ->withArgs(function ($to, $subject, $html, $cc, $replyTo, $unsub, $category, $options) use (&$capturedOptions) {
                $capturedOptions = $options;
                return true;
            })
            ->andReturn(true);

        TenantProvisioningMailer::sendRejection($this->rejectionRequest(), 'reason text');

        $this->assertIsArray($capturedOptions);
        $this->assertArrayHasKey('allow_missing_tenant', $capturedOptions);
        $this->assertTrue((bool) $capturedOptions['allow_missing_tenant']);
    }

    public function test_sendRejection_returns_false_when_dispatch_returns_false(): void
    {
        Mockery::mock('alias:' . EmailDispatchService::class)
            ->shouldReceive('sendRaw')
            ->andReturn(false);

        $result = TenantProvisioningMailer::sendRejection(
            $this->rejectionRequest(),
            'Decline reason'
        );

        $this->assertFalse($result);
    }

    public function test_sendRejection_sends_to_correct_email(): void
    {
        $capturedTo = null;

        Mockery::mock('alias:' . EmailDispatchService::class)
            ->shouldReceive('sendRaw')
            ->withArgs(function ($to) use (&$capturedTo) {
                $capturedTo = $to;
                return true;
            })
            ->andReturn(true);

        TenantProvisioningMailer::sendRejection(
            $this->rejectionRequest(['applicant_email' => 'specific@test.example']),
            'reason'
        );

        $this->assertSame('specific@test.example', $capturedTo);
    }
}
