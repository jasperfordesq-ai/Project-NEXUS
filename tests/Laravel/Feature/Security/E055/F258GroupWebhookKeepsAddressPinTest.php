<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Models\Group;
use App\Models\User;
use App\Services\GroupWebhookService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * E-055 F-258 — group webhook delivery must go out through the cURL handler,
 * which honours OutboundUrlGuard's CURLOPT_RESOLVE address pin. Guzzle routes a
 * request with `stream => true` to its PHP-stream handler, which ignores every
 * `curl` option and resolves the host again itself (DNS rebinding window).
 */
final class F258GroupWebhookKeepsAddressPinTest extends TestCase
{
    use DatabaseTransactions;

    private Group $group;

    protected function setUp(): void
    {
        parent::setUp();

        TenantContext::setById($this->testTenantId);
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $owner->id,
            'status' => GroupStatus::Active->value,
            'is_active' => true,
            'visibility' => 'public',
        ]);
        Queue::fake();
        Http::preventStrayRequests();
    }

    public function test_delivery_uses_the_pinned_curl_transport_and_still_delivers(): void
    {
        $captured = null;
        Http::fake(function (Request $request, array $options) use (&$captured) {
            $captured = $options;

            return Http::response('accepted', 200);
        });

        $webhookId = (int) DB::table('group_webhooks')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'group_id' => (int) $this->group->id,
            'url' => 'https://8.8.8.8/group-hook',
            'events' => json_encode([GroupWebhookService::EVENT_FILE_UPLOADED], JSON_THROW_ON_ERROR),
            'secret' => null,
            'is_active' => true,
            'failure_count' => 0,
            'disabled_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        GroupWebhookService::fire((int) $this->group->id, GroupWebhookService::EVENT_FILE_UPLOADED, ['file_id' => 4242]);
        $deliveryId = (string) DB::table('group_webhook_deliveries')->where('webhook_id', $webhookId)->value('id');
        $this->assertNotSame('', $deliveryId, 'Fixture: firing the event must queue a delivery.');

        // Control: the delivery still succeeds.
        $this->assertSame('delivered', GroupWebhookService::deliver($deliveryId, $this->testTenantId));

        $this->assertIsArray($captured);
        $this->assertFalse(
            (bool) ($captured['stream'] ?? false),
            'Webhook delivery must not use the streaming transport: it ignores the cURL address pin.'
        );
        $this->assertArrayHasKey('curl', $captured, 'The guard\'s cURL options must reach the request.');
        $this->assertSame(CURLPROTO_HTTP | CURLPROTO_HTTPS, $captured['curl'][CURLOPT_PROTOCOLS] ?? null);
        $this->assertFalse($captured['allow_redirects'] ?? true, 'Redirects must stay disabled.');
    }
}
