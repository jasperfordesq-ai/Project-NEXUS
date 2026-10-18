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

    public function test_access_worked_out_earlier_for_another_account_is_not_reused(): void
    {
        // SuperPanelAccess caches its answer for the life of the PHP process.
        // CI on 17b241424 ran an unrelated test first in the same process, and
        // every request here was refused with 403 on that stale answer.
        $someoneElse = User::factory()->forTenant($this->testTenantId)->create(['role' => 'member']);
        \App\Core\SuperPanelAccess::reset();
        \App\Core\SuperPanelAccess::getAccess((int) $someoneElse->id);

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

    /**
     * The admin page shows its own translated wording for each refusal, so
     * every refusal carries a code that says which one it is (the message
     * text is for API callers only).
     *
     * @dataProvider refusals
     */
    public function test_each_refusal_says_which_rule_was_broken(array $overrides, string $code, string $field): void
    {
        $this->actAsGodPlatformAdmin();

        $error = $this->apiPost(self::BASE, $this->input($overrides))->assertStatus(422)->json('errors.0');

        $this->assertSame($code, $error['code'] ?? null);
        $this->assertSame($field, $error['field'] ?? null);
    }

    public static function refusals(): array
    {
        return [
            'no name' => [['name' => ''], 'WEBHOOK_NAME_REQUIRED', 'name'],
            'not a URL' => [['url' => 'not a url'], 'WEBHOOK_URL_INVALID', 'url'],
            'internal address' => [['url' => 'http://127.0.0.1/hook'], 'WEBHOOK_URL_NOT_ALLOWED', 'url'],
            'no events' => [['events' => []], 'WEBHOOK_EVENTS_REQUIRED', 'events'],
            'unknown event' => [['events' => ['volunteer.applied']], 'WEBHOOK_UNKNOWN_EVENT', 'events'],
            'name too long' => [['name' => str_repeat('x', 256)], 'WEBHOOK_FIELD_TOO_LONG', 'name'],
        ];
    }

    public function test_an_update_to_an_internal_address_is_refused_with_its_code(): void
    {
        $this->actAsGodPlatformAdmin();
        $id = $this->apiPost(self::BASE, $this->input())->assertStatus(201)->json('data.id');

        $error = $this->apiPut(self::BASE . '/' . $id, ['url' => 'http://10.0.0.5/hook'])->assertStatus(422)->json('errors.0');

        $this->assertSame('WEBHOOK_URL_NOT_ALLOWED', $error['code'] ?? null);
    }

    /**
     * Found in production on 18 Oct 2026: tenant 2's seeded webhook points at an
     * internal Docker address and subscribes to twelve retired events. The edit
     * form sends every field back, so switching it off was refused by the
     * address and event checks, and the admin could not switch it off at all.
     */
    private function legacyWebhook(bool $active = true): int
    {
        $id = (int) $this->apiPost(self::BASE, $this->input())->assertStatus(201)->json('data.id');
        DB::table('outbound_webhooks')->where('id', $id)->update([
            'url' => 'http://172.17.0.1:5080/api/webhooks/volunteering',
            'events' => json_encode(['volunteer.applied', 'shift.completed', 'hours.logged']),
            'is_active' => $active ? 1 : 0,
        ]);

        return $id;
    }

    public function test_a_legacy_webhook_can_be_switched_off_with_its_old_fields_sent_back(): void
    {
        $this->actAsGodPlatformAdmin();
        $id = $this->legacyWebhook();

        $this->apiPut(self::BASE . '/' . $id, [
            'name' => 'CRM',
            'url' => 'http://172.17.0.1:5080/api/webhooks/volunteering',
            'events' => ['volunteer.applied', 'shift.completed', 'hours.logged'],
            'is_active' => false,
        ])->assertOk();

        $this->assertSame(0, (int) DB::table('outbound_webhooks')->where('id', $id)->value('is_active'));
    }

    public function test_a_legacy_webhook_cannot_be_switched_back_on_until_its_address_is_fixed(): void
    {
        $this->actAsGodPlatformAdmin();
        $id = $this->legacyWebhook(active: false);

        $error = $this->apiPut(self::BASE . '/' . $id, [
            'url' => 'http://172.17.0.1:5080/api/webhooks/volunteering',
            'is_active' => true,
        ])->assertStatus(422)->json('errors.0');

        $this->assertSame('WEBHOOK_URL_NOT_ALLOWED', $error['code'] ?? null);
        $this->assertSame(0, (int) DB::table('outbound_webhooks')->where('id', $id)->value('is_active'));
    }

    public function test_a_switched_off_webhook_still_cannot_be_given_a_new_internal_address(): void
    {
        $this->actAsGodPlatformAdmin();
        $id = $this->legacyWebhook(active: false);

        $this->apiPut(self::BASE . '/' . $id, ['url' => 'http://10.0.0.9/hook', 'is_active' => false])->assertStatus(422);
        $this->assertSame('http://172.17.0.1:5080/api/webhooks/volunteering', DB::table('outbound_webhooks')->where('id', $id)->value('url'));
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
