<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Services\EmailDispatchService;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use App\Models\User;

/**
 * Feature tests for CoreController — contact form, messages, members API.
 */
class CoreControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  POST /v2/contact (public route)
    // ------------------------------------------------------------------

    public function test_contact_form_accepts_submission(): void
    {
        // CoreController::apiSubmit returns a 500 (no_contact_email_configured)
        // when the tenant has no contact_email. The clean test tenant row created
        // by TestCase omits it, so seed one to exercise the normal flow.
        \Illuminate\Support\Facades\DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update(['contact_email' => 'contact@example.com']);
        \App\Core\TenantContext::setById($this->testTenantId);

        $response = $this->apiPost('/v2/contact', [
            'name' => 'Test User',
            'email' => 'test@example.com',
            'message' => 'This is a test contact message.',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201, 422]);
    }

    public function test_contact_form_replays_one_submission_without_sending_email_twice(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update(['contact_email' => 'contact@project-nexus.ie']);
        \App\Core\TenantContext::setById($this->testTenantId);
        $mailer = Mockery::mock(EmailDispatchService::class);
        $mailer->shouldReceive('send')->once()->andReturnTrue();
        $this->app->instance(EmailDispatchService::class, $mailer);

        $key = 'mobile-contact-replay-key-1';
        $payload = [
            'name' => 'Aoife Ryan',
            'email' => 'aoife@example.org',
            'subject' => 'Account Help',
            'message' => 'Please help with my account.',
            'idempotency_key' => $key,
        ];

        $first = $this->apiPost('/v2/contact', $payload, ['Idempotency-Key' => $key]);
        $second = $this->apiPost('/v2/contact', $payload, ['Idempotency-Key' => $key]);

        $first->assertOk();
        $second->assertOk();
        $this->assertSame(1, DB::table('contact_submissions')
            ->where('tenant_id', $this->testTenantId)
            ->where('idempotency_key_hash', hash('sha256', $key))
            ->count());
        $this->assertSame(1, (int) DB::table('contact_submissions')
            ->where('tenant_id', $this->testTenantId)
            ->where('idempotency_key_hash', hash('sha256', $key))
            ->value('email_sent'));
    }

    public function test_contact_form_rejects_changed_request_for_same_key(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update(['contact_email' => 'contact@project-nexus.ie']);
        \App\Core\TenantContext::setById($this->testTenantId);
        $mailer = Mockery::mock(EmailDispatchService::class);
        $mailer->shouldReceive('send')->once()->andReturnTrue();
        $this->app->instance(EmailDispatchService::class, $mailer);

        $key = 'mobile-contact-conflict-key-1';
        $payload = [
            'name' => 'Aoife Ryan',
            'email' => 'aoife@example.org',
            'subject' => 'Account Help',
            'message' => 'Original request.',
            'idempotency_key' => $key,
        ];
        $this->apiPost('/v2/contact', $payload, ['Idempotency-Key' => $key])->assertOk();

        $response = $this->apiPost('/v2/contact', [
            ...$payload,
            'message' => 'Changed request.',
        ], ['Idempotency-Key' => $key]);

        $response->assertStatus(409);
        $response->assertJsonPath('errors.0.code', 'IDEMPOTENCY_CONFLICT');
        $this->assertSame(1, DB::table('contact_submissions')
            ->where('tenant_id', $this->testTenantId)
            ->where('idempotency_key_hash', hash('sha256', $key))
            ->count());
    }

    public function test_contact_form_replay_keeps_failed_email_at_most_once_while_preserving_submission(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update(['contact_email' => 'contact@project-nexus.ie']);
        \App\Core\TenantContext::setById($this->testTenantId);
        $mailer = Mockery::mock(EmailDispatchService::class);
        $mailer->shouldReceive('send')->once()->andThrow(new \RuntimeException('Provider response unavailable'));
        $this->app->instance(EmailDispatchService::class, $mailer);

        $key = 'mobile-contact-provider-boundary-1';
        $payload = [
            'name' => 'Aoife Ryan',
            'email' => 'aoife@example.org',
            'subject' => 'General Inquiry',
            'message' => 'Please preserve this submission.',
            'idempotency_key' => $key,
        ];

        $this->apiPost('/v2/contact', $payload, ['Idempotency-Key' => $key])->assertOk();
        $this->apiPost('/v2/contact', $payload, ['Idempotency-Key' => $key])->assertOk();

        $row = DB::table('contact_submissions')
            ->where('tenant_id', $this->testTenantId)
            ->where('idempotency_key_hash', hash('sha256', $key))
            ->first();
        $this->assertNotNull($row);
        $this->assertSame(0, (int) $row->email_sent);
        $this->assertNotNull($row->delivery_started_at);
    }

    // ------------------------------------------------------------------
    //  GET /messages/unread-count (auth required)
    // ------------------------------------------------------------------

    public function test_unread_count_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/messages/unread-count');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /members (auth required)
    // ------------------------------------------------------------------

    // Retired (F-145): GET /members, /listings and /groups bypassed the
    // directory, listing and group visibility rules. See
    // tests/Laravel/Feature/Security/LegacyCoreListRoutesTest.php.

    public function test_legacy_members_route_is_retired(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/members');

        $response->assertStatus(404);
    }

    public function test_legacy_listings_route_is_retired(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/listings');

        $response->assertStatus(404);
    }

    // ------------------------------------------------------------------
    //  GET /notifications (auth required)
    // ------------------------------------------------------------------

    public function test_notifications_requires_auth(): void
    {
        $response = $this->apiGet('/notifications');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /notifications/unread-count (auth required)
    // ------------------------------------------------------------------

    public function test_notifications_unread_count_requires_auth(): void
    {
        $response = $this->apiGet('/notifications/unread-count');

        $response->assertStatus(401);
    }
}
