<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E055;

use App\Models\User;
use App\Services\BrokerControlConfigService;
use App\Services\BrokerMessageVisibilityService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-242 (E-055 C-1): blanket copying of every private message into broker
 * review is an admin-only policy (`broker_copy_all_messages`). The config
 * service treats a sampling rate at or above
 * BrokerControlConfigService::BLANKET_COPY_SAMPLE_PERCENTAGE as that same
 * policy, so a caller below admin tier must not be able to reach it through
 * `random_sample_percentage` either.
 */
class F242BrokerBlanketCopyAdminOnlyTest extends TestCase
{
    use DatabaseTransactions;

    private function baselineAdminPolicy(): void
    {
        // Nothing is copied between ordinary members under this baseline.
        BrokerControlConfigService::updateConfig([
            'broker_copy_all_messages' => false,
            'random_sample_percentage' => 0,
            'copy_first_contact' => false,
            'copy_new_member_messages' => false,
            'copy_high_risk_listing_messages' => false,
        ]);
    }

    /** @return array{0: User, 1: User} */
    private function members(): array
    {
        $a = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $b = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        return [$a, $b];
    }

    private function flatConfig(): array
    {
        return BrokerControlConfigService::nestedToFlat(BrokerControlConfigService::getConfig());
    }

    private function storedBrokerSettingsRow(): ?string
    {
        $row = DB::selectOne(
            "SELECT setting_value FROM tenant_settings WHERE tenant_id = ? AND setting_key = 'broker_config'",
            [$this->testTenantId]
        );

        return $row ? (string) $row->setting_value : null;
    }

    /** @return array<int, int|string> */
    public static function blanketRates(): array
    {
        return [
            'exactly the threshold' => [BrokerControlConfigService::BLANKET_COPY_SAMPLE_PERCENTAGE],
            'above the threshold (clamped to it)' => [250],
            'numeric string' => [(string) BrokerControlConfigService::BLANKET_COPY_SAMPLE_PERCENTAGE],
        ];
    }

    /**
     * @dataProvider blanketRates
     */
    public function test_broker_cannot_turn_on_blanket_copying_via_sample_rate(int|string $rate): void
    {
        $this->baselineAdminPolicy();
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        [$a, $b] = $this->members();

        $settingsBefore = $this->storedBrokerSettingsRow();
        $configBefore = $this->flatConfig();

        Sanctum::actingAs($broker);
        $response = $this->apiPost('/v2/admin/broker/configuration', ['random_sample_percentage' => $rate]);

        // Refused exactly like the admin-only broker_copy_all_messages key.
        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'FORBIDDEN');

        // Nothing stored changed.
        $this->assertSame($settingsBefore, $this->storedBrokerSettingsRow());
        $configAfter = $this->flatConfig();
        $this->assertSame($configBefore['random_sample_percentage'] ?? null, $configAfter['random_sample_percentage'] ?? null);
        $this->assertFalse((bool) ($configAfter['broker_copy_all_messages'] ?? false));

        // No ordinary private message gets copied.
        $svc = app(BrokerMessageVisibilityService::class);
        for ($i = 0; $i < 20; $i++) {
            $this->assertNull($svc->shouldCopyMessage((int) $a->id, (int) $b->id));
        }
    }

    public function test_refusal_matches_admin_only_key_refusal_shape(): void
    {
        $this->baselineAdminPolicy();
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        Sanctum::actingAs($broker);

        $viaKey = $this->apiPost('/v2/admin/broker/configuration', ['broker_copy_all_messages' => true]);
        $viaRate = $this->apiPost('/v2/admin/broker/configuration', ['random_sample_percentage' => 100]);

        $viaKey->assertStatus(403);
        $viaRate->assertStatus(403);
        $this->assertSame(
            array_keys($viaKey->json()),
            array_keys($viaRate->json()),
            'Same error envelope for both routes to blanket copying'
        );
        $this->assertSame($viaKey->json('errors.0.code'), $viaRate->json('errors.0.code'));
    }

    public function test_control_broker_can_still_set_a_partial_sample_rate(): void
    {
        $this->baselineAdminPolicy();
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        Sanctum::actingAs($broker);

        $response = $this->apiPost('/v2/admin/broker/configuration', ['random_sample_percentage' => 25]);
        $response->assertStatus(200);

        $flat = $this->flatConfig();
        $this->assertSame(25, (int) ($flat['random_sample_percentage'] ?? 0));
        $this->assertFalse((bool) ($flat['broker_copy_all_messages'] ?? false));
    }

    public function test_control_broker_can_set_just_below_the_threshold(): void
    {
        $this->baselineAdminPolicy();
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        Sanctum::actingAs($broker);

        $below = BrokerControlConfigService::BLANKET_COPY_SAMPLE_PERCENTAGE - 1;
        $response = $this->apiPost('/v2/admin/broker/configuration', ['random_sample_percentage' => $below]);
        $response->assertStatus(200);

        $flat = $this->flatConfig();
        $this->assertSame($below, (int) ($flat['random_sample_percentage'] ?? 0));
        $this->assertFalse((bool) ($flat['broker_copy_all_messages'] ?? false));
    }

    public function test_control_admin_can_set_blanket_copying_via_sample_rate(): void
    {
        $this->baselineAdminPolicy();
        $admin = User::factory()->forTenant($this->testTenantId)->create(['role' => 'admin', 'status' => 'active']);
        [$a, $b] = $this->members();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/broker/configuration', ['random_sample_percentage' => 100]);
        $response->assertStatus(200);

        $flat = $this->flatConfig();
        $this->assertSame(100, (int) ($flat['random_sample_percentage'] ?? 0));
        $this->assertTrue((bool) ($flat['broker_copy_all_messages'] ?? false));
        $this->assertNotNull(
            app(BrokerMessageVisibilityService::class)->shouldCopyMessage((int) $a->id, (int) $b->id)
        );
    }
}
