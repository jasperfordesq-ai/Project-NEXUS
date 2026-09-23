<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringCommunity\EmergencyAlertService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-128 — the member emergency-alert endpoint must not expose push delivery
 * internals (push_result, whose FCM error strings embed device tokens) or the
 * list of targeted recipients, and push_result must never store raw tokens.
 */
class CaringEmergencyAlertExposureTest extends TestCase
{
    use DatabaseTransactions;

    private const DEVICE_TOKEN = 'fcm-device-token-SECRET-abc123def456';

    protected function setUp(): void
    {
        parent::setUp();

        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && ! empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
    }

    public function test_member_endpoint_returns_only_member_facing_fields(): void
    {
        $member = $this->member();
        $other = $this->member();

        $alertId = (int) DB::table('caring_emergency_alerts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'Storm warning',
            'body' => 'Stay indoors tonight.',
            'severity' => 'danger',
            'target_user_ids' => json_encode([$member->id, $other->id]),
            'is_active' => 1,
            'push_sent' => 1,
            'push_result' => json_encode(['sent' => 1, 'failed' => 1, 'errors' => ['Token ' . self::DEVICE_TOKEN . ': UNREGISTERED']]),
            'sent_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($member);
        $response = $this->apiGet('/v2/caring-community/emergency-alerts');
        $response->assertStatus(200);

        $alerts = $response->json('data');
        $this->assertIsArray($alerts);
        $mine = array_values(array_filter($alerts, fn ($a) => (int) ($a['id'] ?? 0) === $alertId));
        $this->assertCount(1, $mine, 'Control: the targeted member still sees the alert.');
        $alert = $mine[0];

        $this->assertSame('Storm warning', $alert['title']);
        $this->assertSame('Stay indoors tonight.', $alert['body']);
        $this->assertSame('danger', $alert['severity']);

        foreach (['push_result', 'target_user_ids', 'created_by', 'dismissed_count', 'push_sent'] as $field) {
            $this->assertArrayNotHasKey($field, $alert);
        }
        $this->assertStringNotContainsString(self::DEVICE_TOKEN, $response->getContent());
    }

    public function test_broadcast_stores_only_delivery_counts_in_push_result(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $recipient = $this->member();

        $alert = EmergencyAlertService::createAndBroadcast($this->testTenantId, [
            'title' => 'Boil water notice',
            'body' => 'Boil tap water.',
            'severity' => 'warning',
            'target_user_ids' => [$recipient->id],
        ], $admin->id);

        $stored = json_decode((string) DB::table('caring_emergency_alerts')->where('id', $alert['id'])->value('push_result'), true);
        $this->assertIsArray($stored);
        // Counts only: the raw FCM error list (which carries "Token {token}: …"
        // strings) is never persisted.
        $this->assertArrayNotHasKey('errors', $stored);
        $this->assertArrayHasKey('sent', $stored, 'Control: admins still get delivery counts.');
        $this->assertArrayHasKey('failed', $stored);
    }

    public function test_push_result_summary_never_carries_device_tokens(): void
    {
        $summary = EmergencyAlertService::summarisePushResult([
            'sent' => 2,
            'failed' => 1,
            'errors' => ['Token ' . self::DEVICE_TOKEN . ': UNREGISTERED'],
        ]);

        $this->assertSame(['sent' => 2, 'failed' => 1, 'error_count' => 1], $summary);
        $this->assertStringNotContainsString(self::DEVICE_TOKEN, (string) json_encode($summary));
    }

    public function test_admin_list_redacts_tokens_from_legacy_push_results(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();

        DB::table('caring_emergency_alerts')->insert([
            'tenant_id' => $this->testTenantId,
            'title' => 'Legacy alert',
            'body' => 'Body',
            'severity' => 'info',
            'is_active' => 1,
            'push_sent' => 1,
            'push_result' => json_encode(['sent' => 3, 'failed' => 1, 'errors' => ['Token ' . self::DEVICE_TOKEN . ': NotRegistered']]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($admin);
        $response = $this->apiGet('/v2/admin/caring-community/emergency-alerts');
        $response->assertStatus(200);
        $this->assertStringNotContainsString(self::DEVICE_TOKEN, $response->getContent());

        $legacy = collect($response->json('data'))->firstWhere('title', 'Legacy alert');
        $this->assertNotNull($legacy);
        $push = is_string($legacy['push_result']) ? json_decode($legacy['push_result'], true) : $legacy['push_result'];
        $this->assertSame(3, $push['sent'] ?? null, 'Control: admin keeps delivery counts.');
        $this->assertSame(1, $push['failed'] ?? null);
    }
}
