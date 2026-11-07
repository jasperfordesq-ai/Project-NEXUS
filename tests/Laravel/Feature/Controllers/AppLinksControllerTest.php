<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * AWID accessibility report, Oct 2026, point 15: getting the phone app from a
 * computer relied on scanning a QR code, which a blind member cannot do.
 * POST /v2/app-links/email sends the store links to the signed-in member's
 * OWN address (never one the request names), so they can open them on the
 * phone. Rate-limited.
 */
class AppLinksControllerTest extends TestCase
{
    use DatabaseTransactions;

    private AppLinksCapturingEmailDispatch $mailer;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->mailer = new AppLinksCapturingEmailDispatch();
        app()->instance(EmailDispatchService::class, $this->mailer);
    }

    public function test_the_links_go_to_the_members_own_address(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'app-links-' . uniqid() . '@example.test', 'status' => 'active', 'is_approved' => true,
        ]);
        Sanctum::actingAs($member, ['*']);

        $this->apiPost('/v2/app-links/email', ['email' => 'someone-else@example.test'])->assertStatus(200);

        $this->assertCount(1, $this->mailer->sent);
        $this->assertSame($member->email, $this->mailer->sent[0]['to']);
        $body = $this->mailer->sent[0]['body'];
        $this->assertStringContainsString('https://play.google.com/store/apps/details?id=ie.project.nexus', $body);
        $this->assertStringContainsString('https://apps.apple.com/app/timebank-global/id6823712395', $body);
    }

    /**
     * Found walking the email on the test environment (7 Nov): the store links
     * were wrapped in <a> tags that the email builder only allows for the
     * community's own site, so members saw the markup as text.
     */
    public function test_the_store_links_never_show_as_raw_markup(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'app-links-' . uniqid() . '@example.test', 'status' => 'active', 'is_approved' => true,
        ]);
        Sanctum::actingAs($member, ['*']);

        $this->apiPost('/v2/app-links/email')->assertStatus(200);

        $body = $this->mailer->sent[0]['body'];
        $this->assertStringNotContainsString('&lt;a', $body);
        $this->assertStringNotContainsString('&lt;/a', $body);
    }

    public function test_signing_in_is_required(): void
    {
        $response = $this->apiPost('/v2/app-links/email');

        $this->assertContains($response->getStatusCode(), [401, 403]);
        $this->assertCount(0, $this->mailer->sent);
    }

    public function test_a_member_cannot_send_the_links_again_and_again(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'app-links-limit-' . uniqid() . '@example.test', 'status' => 'active', 'is_approved' => true,
        ]);
        Sanctum::actingAs($member, ['*']);

        for ($i = 0; $i < 3; $i++) {
            $this->apiPost('/v2/app-links/email')->assertStatus(200);
        }
        $this->apiPost('/v2/app-links/email')->assertStatus(429);
        $this->assertCount(3, $this->mailer->sent);
    }
}

class AppLinksCapturingEmailDispatch extends EmailDispatchService
{
    /** @var array<int, array{to:string, subject:string, body:string}> */
    public array $sent = [];

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->sent[] = ['to' => $to, 'subject' => $subject, 'body' => $body];

        return true;
    }
}
