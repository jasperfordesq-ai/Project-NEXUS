<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Integrations;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\WebhookDispatchService;
use App\Support\OutboundWebhookTransport;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Outbound webhooks moved from the volunteering admin page to a platform-level
 * Integrations page on 2026-10-18 (owner decision). Only a god account that is
 * also a platform super admin may manage them: `is_god` AND `is_super_admin`,
 * both. The existing "platform super admin" checks admit a god-only account,
 * so the gate here has its own helper and these tests pin both legs.
 */
final class AdminOutboundWebhooksControllerTest extends TestCase
{
    use DatabaseTransactions;

    private const BASE = '/v2/admin/integrations/webhooks';

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        // No webhook should ever reach the network from a test.
        $this->app->instance(OutboundWebhookTransport::class, new FakeWebhookTransport());
    }

    private function actAs(array $attributes): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create($attributes);
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function actAsGodPlatformAdmin(): User
    {
        return $this->actAs(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
    }

    private function input(array $overrides = []): array
    {
        return array_merge([
            'name' => 'CRM',
            'url' => 'https://93.184.216.34/hooks',
            'events' => ['shift.completed'],
        ], $overrides);
    }

    // ---------------------------------------------------------------- the gate

    public function test_a_tenant_admin_is_refused(): void
    {
        $this->actAs(['role' => 'admin']);

        $this->apiGet(self::BASE)->assertStatus(403);
    }

    public function test_a_platform_super_admin_who_is_not_god_is_refused(): void
    {
        $this->actAs(['is_super_admin' => true, 'role' => 'super_admin']);

        $this->apiGet(self::BASE)->assertStatus(403);
        $this->apiPost(self::BASE, $this->input())->assertStatus(403);
    }

    public function test_a_god_who_is_not_platform_super_admin_is_refused(): void
    {
        // The route group's super-admin middleware lets is_god through on its
        // own; the controller must still refuse without is_super_admin.
        $this->actAs(['is_god' => true]);

        $this->apiGet(self::BASE)->assertStatus(403);
        $this->apiPost(self::BASE, $this->input())->assertStatus(403);
    }

    public function test_a_god_who_is_also_platform_super_admin_is_admitted(): void
    {
        $this->actAsGodPlatformAdmin();

        $this->apiGet(self::BASE)->assertOk();
    }

    // -------------------------------------------------------------- the events

    public function test_lists_only_the_events_the_platform_really_fires(): void
    {
        $this->actAsGodPlatformAdmin();

        $events = $this->apiGet(self::BASE . '/events')->assertOk()->json('data');

        $this->assertSame([
            'shift.completed',
            'job.vacancy.created',
            'job.application.created',
            'job.application.status_changed',
            'job.application.bulk_status_changed',
            'job.offer.accepted',
        ], $events);
    }

    public function test_an_event_nothing_fires_is_refused(): void
    {
        $this->actAsGodPlatformAdmin();

        $this->apiPost(self::BASE, $this->input(['events' => ['volunteer.applied']]))->assertStatus(422);
        $this->assertFalse(DB::table('outbound_webhooks')->where('tenant_id', $this->testTenantId)->where('name', 'CRM')->exists());
    }

    // -------------------------------------------------------------- the secret

    public function test_the_secret_is_shown_once_on_create_and_never_in_the_list(): void
    {
        $this->actAsGodPlatformAdmin();

        $created = $this->apiPost(self::BASE, $this->input())->assertStatus(201)->json('data');
        $this->assertIsString($created['secret'] ?? null);
        $this->assertGreaterThanOrEqual(32, strlen($created['secret']));

        $listed = $this->apiGet(self::BASE)->assertOk()->json('data');
        $this->assertCount(1, array_filter($listed, fn ($row) => (int) $row['id'] === (int) $created['id']));
        foreach ($listed as $row) {
            $this->assertArrayNotHasKey('secret', $row, 'a listing must never carry the signing secret');
        }
    }

    public function test_rotating_the_secret_returns_a_new_one_and_stores_it(): void
    {
        $this->actAsGodPlatformAdmin();
        $created = $this->apiPost(self::BASE, $this->input())->assertStatus(201)->json('data');

        $rotated = $this->apiPost(self::BASE . "/{$created['id']}/rotate-secret", [])->assertOk()->json('data');

        $this->assertIsString($rotated['secret'] ?? null);
        $this->assertNotSame($created['secret'], $rotated['secret']);
        $this->assertSame($rotated['secret'], (string) DB::table('outbound_webhooks')->where('id', $created['id'])->value('secret'));
    }

    // -------------------------------------------------------- tenant selection

    public function test_tenant_id_selects_which_community_is_managed(): void
    {
        $this->actAsGodPlatformAdmin();
        $other = (int) (DB::table('tenants')->where('id', '!=', $this->testTenantId)->orderBy('id')->value('id') ?? 0);
        if ($other === 0) {
            $this->markTestSkipped('needs a second tenant row');
        }

        $created = $this->apiPost(self::BASE, $this->input(['tenant_id' => $other, 'name' => 'Other community hook']))
            ->assertStatus(201)->json('data');

        $this->assertSame($other, (int) DB::table('outbound_webhooks')->where('id', $created['id'])->value('tenant_id'));

        $own = $this->apiGet(self::BASE)->assertOk()->json('data');
        $this->assertSame([], array_values(array_filter($own, fn ($row) => (int) $row['id'] === (int) $created['id'])), 'the current community listing must not show another community\'s webhook');

        $theirs = $this->apiGet(self::BASE . '?tenant_id=' . $other)->assertOk()->json('data');
        $this->assertCount(1, array_filter($theirs, fn ($row) => (int) $row['id'] === (int) $created['id']));
    }

    // ------------------------------------------------------ test + failure log

    public function test_testing_an_unknown_webhook_is_not_found_not_a_server_error(): void
    {
        $this->actAsGodPlatformAdmin();

        $this->apiPost(self::BASE . '/999999999/test', [])->assertStatus(404);
    }

    public function test_sending_a_test_reports_the_receivers_answer(): void
    {
        $this->actAsGodPlatformAdmin();
        $created = $this->apiPost(self::BASE, $this->input())->assertStatus(201)->json('data');

        $result = $this->apiPost(self::BASE . "/{$created['id']}/test", [])->assertOk()->json('data');

        $this->assertTrue($result['success']);
        $this->assertSame(200, $result['http_code']);
    }

    public function test_webhook_failure_count_rises_on_failure_and_resets_on_success(): void
    {
        $admin = $this->actAsGodPlatformAdmin();

        $id = (int) DB::table('outbound_webhooks')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'created_by' => $admin->id,
            'name' => 'Wiring hook',
            'url' => 'https://example.com/hook',
            'events' => json_encode(['shift.completed']),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        WebhookDispatchService::recordDeliveryOutcome($this->testTenantId, $id, false);
        WebhookDispatchService::recordDeliveryOutcome($this->testTenantId, $id, false);
        $this->assertSame(2, (int) DB::table('outbound_webhooks')->where('id', $id)->value('failure_count'));

        WebhookDispatchService::recordDeliveryOutcome($this->testTenantId, $id, true);
        $row = DB::table('outbound_webhooks')->where('id', $id)->first();
        $this->assertSame(0, (int) $row->failure_count);
        $this->assertNotNull($row->last_triggered_at);
    }
}

/** Answers every delivery with 200 and records nothing on the network. */
final class FakeWebhookTransport extends OutboundWebhookTransport
{
    /** @var list<array{url: string, body: string, headers: array<int, string>}> */
    public array $calls = [];

    public int $httpCode = 200;

    public function post(string $url, string $body, array $headers): array
    {
        $this->calls[] = ['url' => $url, 'body' => $body, 'headers' => $headers];

        return ['http_code' => $this->httpCode, 'response' => 'ok', 'error' => ''];
    }
}
