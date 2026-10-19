<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

class EmergencyAlertControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function setCaringCommunityFeature(bool $enabled): void
    {
        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && ! empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }

        $features['caring_community'] = $enabled;
        DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    private function requireEmergencyAlertTable(): void
    {
        if (! Schema::hasTable('caring_emergency_alerts')) {
            $this->markTestSkipped('Emergency alert table is not present in the test database.');
        }
    }

    public function test_admin_can_broadcast_and_member_can_dismiss_active_safety_alert(): void
    {
        $this->requireEmergencyAlertTable();
        $this->setCaringCommunityFeature(true);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);

        $create = $this->apiPost('/v2/admin/caring-community/emergency-alerts', [
            'title' => 'Water safety notice',
            'body' => 'Please boil tap water until the municipality issues an all-clear.',
            'severity' => 'danger',
            'expires_at' => now()->addHours(6)->toDateTimeString(),
        ]);

        $create->assertStatus(201);
        $create->assertJsonPath('data.title', 'Water safety notice');
        $create->assertJsonPath('data.severity', 'danger');

        $alertId = (int) $create->json('data.id');

        // Caring Community is outside both adults-only native apps, so FCMPushService
        // suppresses every caring_* push by policy. Since 2026-10-18 the service records
        // push_sent honestly: 1 only when a device was actually sent to. It used to write 1
        // regardless, which this assertion pinned.
        $this->assertDatabaseHas('caring_emergency_alerts', [
            'id' => $alertId,
            'tenant_id' => $this->testTenantId,
            'is_active' => 1,
            'push_sent' => 0,
        ]);

        Sanctum::actingAs($member);

        $active = $this->apiGet('/v2/caring-community/emergency-alerts');
        $active->assertStatus(200);
        $active->assertJsonPath('data.0.id', $alertId);
        $active->assertJsonPath('data.0.title', 'Water safety notice');

        $dismiss = $this->apiPost("/v2/caring-community/emergency-alerts/{$alertId}/dismiss");
        $dismiss->assertStatus(200);
        $dismiss->assertJsonPath('data.ok', true);

        $this->assertDatabaseHas('caring_emergency_alerts', [
            'id' => $alertId,
            'tenant_id' => $this->testTenantId,
            'dismissed_count' => 1,
        ]);
    }

    public function test_emergency_alert_routes_respect_caring_community_feature_gate(): void
    {
        $this->requireEmergencyAlertTable();
        $this->setCaringCommunityFeature(false);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/caring-community/emergency-alerts');

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    public function test_targeted_emergency_alerts_are_visible_only_to_active_targeted_tenant_members(): void
    {
        $this->requireEmergencyAlertTable();
        $this->setCaringCommunityFeature(true);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $targeted = User::factory()->forTenant($this->testTenantId)->create();
        $notTargeted = User::factory()->forTenant($this->testTenantId)->create();
        $inactiveTarget = User::factory()->forTenant($this->testTenantId)->create(['status' => 'suspended']);
        $otherTenantTarget = User::factory()->forTenant(999)->create();

        Sanctum::actingAs($admin);

        $create = $this->apiPost('/v2/admin/caring-community/emergency-alerts', [
            'title' => 'Targeted care safety notice',
            'body' => 'Only the care recipient circle should see this notice.',
            'severity' => 'warning',
            'target_user_ids' => [
                $targeted->id,
                $inactiveTarget->id,
                $otherTenantTarget->id,
            ],
        ]);

        $create->assertStatus(201);
        $alertId = (int) $create->json('data.id');

        $storedTargets = json_decode((string) DB::table('caring_emergency_alerts')
            ->where('id', $alertId)
            ->value('target_user_ids'), true);

        $this->assertSame([$targeted->id], $storedTargets);

        Sanctum::actingAs($targeted);
        $visibleToTarget = $this->apiGet('/v2/caring-community/emergency-alerts');
        $visibleToTarget->assertStatus(200);
        $this->assertContains($alertId, array_column($visibleToTarget->json('data'), 'id'));

        Sanctum::actingAs($notTargeted);
        $hiddenFromOtherMember = $this->apiGet('/v2/caring-community/emergency-alerts');
        $hiddenFromOtherMember->assertStatus(200);
        $this->assertNotContains($alertId, array_column($hiddenFromOtherMember->json('data'), 'id'));

        Sanctum::actingAs($admin);
        $createInvalidTargets = $this->apiPost('/v2/admin/caring-community/emergency-alerts', [
            'title' => 'Invalid target notice',
            'body' => 'This should not become a tenant-wide alert.',
            'severity' => 'warning',
            'target_user_ids' => [
                $inactiveTarget->id,
                $otherTenantTarget->id,
            ],
        ]);

        $createInvalidTargets->assertStatus(201);
        $invalidAlertId = (int) $createInvalidTargets->json('data.id');

        $emptyTargets = json_decode((string) DB::table('caring_emergency_alerts')
            ->where('id', $invalidAlertId)
            ->value('target_user_ids'), true);

        $this->assertSame([], $emptyTargets);

        Sanctum::actingAs($notTargeted);
        $hiddenInvalidTargets = $this->apiGet('/v2/caring-community/emergency-alerts');
        $hiddenInvalidTargets->assertStatus(200);
        $this->assertNotContains($invalidAlertId, array_column($hiddenInvalidTargets->json('data'), 'id'));
    }
}
