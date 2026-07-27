<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Services\FederationFeatureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The external partner federation kill switch must fail CLOSED.
 *
 * Internal cross-tenant federation deliberately fails OPEN on a transient DB
 * fault (so a hiccup cannot sever same-install federation). External protocol
 * traffic has the inverse risk profile: an unaudited protocol answering
 * partners during a fault is worse than downtime. These tests pin that
 * asymmetry, because it is the whole point of the feature.
 */
final class FederationFeatureServiceExternalKillSwitchTest extends TestCase
{
    use DatabaseTransactions;

    private FederationFeatureService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(FederationFeatureService::class);
    }

    /** @param array<string, mixed> $overrides */
    private function seedControls(array $overrides = []): void
    {
        $row = array_merge([
            'federation_enabled' => 1,
            'emergency_lockdown_active' => 0,
            'external_federation_enabled' => 1,
            'updated_at' => now(),
        ], $overrides);

        foreach (FederationFeatureService::externalProtocolNames() as $protocol) {
            $column = (string) FederationFeatureService::externalProtocolColumn($protocol);
            if (! array_key_exists($column, $row)) {
                $row[$column] = 1;
            }
        }

        DB::table('federation_system_control')->updateOrInsert(['id' => 1], $row);
        $this->service->clearCache();
    }

    public function test_all_protocols_allowed_when_master_and_protocol_enabled(): void
    {
        $this->seedControls();

        $this->assertTrue($this->service->isExternalFederationEnabled());
        foreach (FederationFeatureService::externalProtocolNames() as $protocol) {
            $this->assertTrue(
                $this->service->isExternalProtocolEnabled($protocol),
                "expected {$protocol} to be allowed",
            );
        }
    }

    public function test_master_switch_off_blocks_every_protocol(): void
    {
        $this->seedControls(['external_federation_enabled' => 0]);

        $this->assertFalse($this->service->isExternalFederationEnabled());
        foreach (FederationFeatureService::externalProtocolNames() as $protocol) {
            $this->assertFalse(
                $this->service->isExternalProtocolEnabled($protocol),
                "expected {$protocol} to be blocked by the master switch",
            );
        }
    }

    public function test_protocols_are_independently_switchable(): void
    {
        $this->seedControls([
            'external_protocol_komunitin_enabled' => 1,
            'external_protocol_credit_commons_enabled' => 0,
        ]);

        $this->assertTrue($this->service->isExternalProtocolEnabled(FederationFeatureService::EXTERNAL_PROTOCOL_KOMUNITIN));
        $this->assertFalse($this->service->isExternalProtocolEnabled(FederationFeatureService::EXTERNAL_PROTOCOL_CREDIT_COMMONS));
    }

    public function test_platform_master_switch_off_blocks_external(): void
    {
        $this->seedControls(['federation_enabled' => 0]);

        $this->assertFalse($this->service->isExternalFederationEnabled());
        $this->assertFalse($this->service->isExternalProtocolEnabled(FederationFeatureService::EXTERNAL_PROTOCOL_NEXUS));
    }

    public function test_emergency_lockdown_blocks_external(): void
    {
        $this->seedControls(['emergency_lockdown_active' => 1]);

        $this->assertFalse($this->service->isExternalFederationEnabled());
        $this->assertFalse($this->service->isExternalProtocolEnabled(FederationFeatureService::EXTERNAL_PROTOCOL_KOMUNITIN));
    }

    public function test_unknown_protocol_fails_closed(): void
    {
        $this->seedControls();

        $this->assertFalse($this->service->isExternalProtocolEnabled('not_a_real_protocol'));
        $this->assertFalse($this->service->isExternalProtocolEnabled(''));
    }

    public function test_missing_control_row_fails_closed(): void
    {
        DB::table('federation_system_control')->where('id', 1)->delete();
        $this->service->clearCache();

        $this->assertFalse($this->service->isExternalFederationEnabled());
        foreach (FederationFeatureService::externalProtocolNames() as $protocol) {
            $this->assertFalse($this->service->isExternalProtocolEnabled($protocol));
        }
    }

    /**
     * A DB fault must block external traffic — the opposite of the internal
     * fail-open default in getSystemDefaults().
     */
    public function test_database_error_fails_closed(): void
    {
        $this->seedControls();
        $this->assertTrue($this->service->isExternalFederationEnabled());

        $fresh = app()->make(FederationFeatureService::class);
        $fresh->clearCache();

        DB::shouldReceive('table')
            ->andThrow(new \RuntimeException('simulated database outage'));

        $this->assertFalse($fresh->isExternalFederationEnabled());
        $this->assertFalse($fresh->isExternalProtocolEnabled(FederationFeatureService::EXTERNAL_PROTOCOL_NEXUS));
    }

    /**
     * The regression guard for the feature's core promise: switching external
     * federation off must not disturb internal cross-tenant federation.
     */
    public function test_internal_federation_unaffected_when_external_disabled(): void
    {
        $internalFeatures = [
            FederationFeatureService::SYSTEM_PROFILES_ENABLED,
            FederationFeatureService::SYSTEM_MESSAGING_ENABLED,
            FederationFeatureService::SYSTEM_TRANSACTIONS_ENABLED,
            FederationFeatureService::SYSTEM_LISTINGS_ENABLED,
            FederationFeatureService::SYSTEM_EVENTS_ENABLED,
            FederationFeatureService::SYSTEM_GROUPS_ENABLED,
        ];

        // Capture internal state with external federation ON...
        $this->seedControls(['external_federation_enabled' => 1]);
        $this->assertTrue($this->service->isGloballyEnabled());
        $before = [];
        foreach ($internalFeatures as $feature) {
            $before[$feature] = $this->service->isSystemFeatureEnabled($feature);
        }
        $maxLevelBefore = $this->service->getMaxFederationLevel();

        // ...then withdraw external federation and assert nothing internal moved.
        $this->seedControls(['external_federation_enabled' => 0]);

        $this->assertFalse($this->service->isExternalFederationEnabled());
        $this->assertTrue(
            $this->service->isGloballyEnabled(),
            'internal federation master switch must stay on',
        );
        foreach ($internalFeatures as $feature) {
            $this->assertSame(
                $before[$feature],
                $this->service->isSystemFeatureEnabled($feature),
                "internal cross-tenant feature {$feature} changed when external federation was disabled",
            );
        }
        $this->assertSame($maxLevelBefore, $this->service->getMaxFederationLevel());
    }

    public function test_external_protocol_status_reports_effective_state(): void
    {
        $this->seedControls(['external_protocol_aggregates_enabled' => 0]);

        $status = $this->service->externalProtocolStatus();

        $this->assertTrue($status['platform_enabled']);
        $this->assertTrue($status['master_enabled']);
        $this->assertTrue($status['effective']);
        $this->assertFalse($status['emergency_lockdown_active']);
        $this->assertTrue($status['protocols'][FederationFeatureService::EXTERNAL_PROTOCOL_KOMUNITIN]);
        $this->assertFalse($status['protocols'][FederationFeatureService::EXTERNAL_PROTOCOL_AGGREGATES]);
    }

    public function test_set_external_federation_persists_and_records_reason(): void
    {
        $this->seedControls();

        $this->assertTrue($this->service->setExternalFederation(false, 1, 'pending audit'));
        $this->assertFalse($this->service->isExternalFederationEnabled());

        $row = DB::table('federation_system_control')->where('id', 1)->first();
        $this->assertSame(0, (int) $row->external_federation_enabled);
        $this->assertSame('pending audit', $row->external_federation_disabled_reason);

        $this->assertTrue($this->service->setExternalFederation(true, 1));
        $this->assertTrue($this->service->isExternalFederationEnabled());
        $this->assertNull(
            DB::table('federation_system_control')->where('id', 1)->value('external_federation_disabled_reason'),
        );
    }

    /**
     * @dataProvider inboundPathProvider
     */
    public function test_protocol_for_inbound_path(string $path, ?string $expected): void
    {
        $this->assertSame($expected, FederationFeatureService::protocolForInboundPath($path));
    }

    /** @return array<string, array{0: string, 1: ?string}> */
    public static function inboundPathProvider(): array
    {
        return [
            'komunitin' => ['api/v2/federation/komunitin/currencies', 'komunitin'],
            'komunitin no api prefix' => ['/v2/federation/komunitin/currencies', 'komunitin'],
            'credit commons' => ['api/v2/federation/cc/about', 'credit_commons'],
            'nexus ingest' => ['api/v2/federation/ingest/listings', 'nexus'],
            'webhooks' => ['api/v2/federation/external/webhooks/receive', 'webhooks'],
            'hour transfer' => ['api/v2/federation/hour-transfer/inbound', 'hour_transfer'],
            'aggregates' => ['api/v2/federation/aggregates', 'aggregates'],
            'legacy v1 root' => ['api/v1/federation', 'legacy_v1'],
            'legacy v1 health' => ['api/v1/federation/health', 'legacy_v1'],
            'legacy v1 oauth' => ['api/v1/federation/oauth/token', 'legacy_v1'],
            // Member-facing internal cross-tenant routes must NOT map to a
            // protocol, or the switch would take internal federation with it.
            'internal status' => ['api/v2/federation/status', null],
            'internal listings' => ['api/v2/federation/listings', null],
            'internal messages' => ['api/v2/federation/messages', null],
            'unrelated' => ['api/v2/listings', null],
        ];
    }

    /**
     * @dataProvider partnerTypeProvider
     */
    public function test_protocol_for_partner_type(?string $type, ?string $expected): void
    {
        $this->assertSame($expected, FederationFeatureService::protocolForPartnerType($type));
    }

    /** @return array<string, array{0: ?string, 1: ?string}> */
    public static function partnerTypeProvider(): array
    {
        return [
            'nexus' => ['nexus', 'nexus'],
            'komunitin' => ['komunitin', 'komunitin'],
            'credit commons' => ['credit_commons', 'credit_commons'],
            'timeoverflow maps to webhooks' => ['timeoverflow', 'webhooks'],
            'null fails closed' => [null, null],
            'garbage fails closed' => ['definitely-not-a-protocol', null],
        ];
    }
}
