<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Federation;

use App\Core\TenantContext;
use App\Services\CaringCommunity\FederationAggregateService;
use App\Services\FederationFeatureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * FederationAggregateTest — covers the R1+R2 aggregates surface:
 *  - Public endpoint opt-out → 404
 *  - Public endpoint opt-in → signed JSON
 *  - HMAC-SHA256 signature verifies with the tenant's secret
 *  - Member counts always return as a bracket, never raw
 *  - Top categories list is capped at 10
 *  - Each query is logged to the audit trail
 *  - Admin can toggle consent and rotate secret
 *  - pruneOldLogs deletes records older than 12 months
 */
final class FederationAggregateTest extends TestCase
{
    use DatabaseTransactions;

    private FederationAggregateService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new FederationAggregateService();
        $this->enableAggregateFederation();
    }

    /**
     * The public aggregates endpoint is gated by the external partner
     * federation kill switch, which ships disabled. Opt in explicitly so these
     * tests exercise the consent contract rather than the kill switch.
     */
    private function enableAggregateFederation(): void
    {
        DB::table('federation_system_control')->updateOrInsert(['id' => 1], [
            'federation_enabled' => 1,
            'emergency_lockdown_active' => 0,
            'external_federation_enabled' => 1,
            'external_protocol_aggregates_enabled' => 1,
            'updated_at' => now(),
        ]);

        app(FederationFeatureService::class)->clearCache();
    }

    private function disableConsent(int $tenantId): void
    {
        DB::table('federation_aggregate_consents')
            ->where('tenant_id', $tenantId)
            ->update(['enabled' => false]);
    }

    public function test_aggregate_endpoint_returns_404_when_consent_disabled(): void
    {
        // Ensure consent is disabled for the test tenant.
        $this->service->setEnabled($this->testTenantId, false);
        $this->disableConsent($this->testTenantId);

        $resp = $this->getJson(
            "/api/v2/federation/aggregates?tenant_slug={$this->testTenantSlug}"
        );

        $resp->assertStatus(404);
        $resp->assertJson(['success' => false]);
    }

    public function test_aggregate_endpoint_returns_signed_json_when_consent_enabled(): void
    {
        $this->service->setEnabled($this->testTenantId, true);

        $resp = $this->getJson(
            "/api/v2/federation/aggregates?tenant_slug={$this->testTenantSlug}"
        );

        $resp->assertStatus(200);
        $resp->assertJsonStructure([
            'data' => [
                'payload' => [
                    'period' => ['from', 'to'],
                    'tenant' => ['slug', 'name'],
                    'hours'  => ['total_approved', 'by_month', 'by_category'],
                    'members' => ['bracket'],
                    'partner_orgs' => ['count'],
                    'generated_at',
                ],
                'signature',
                'algorithm',
            ],
        ]);

        $this->assertSame('HMAC-SHA256', $resp->json('data.algorithm'));
        $this->assertNotEmpty($resp->json('data.signature'));
    }

    public function test_public_aggregate_contract_requires_consent_not_member_auth(): void
    {
        $this->service->setEnabled($this->testTenantId, true);

        $resp = $this->getJson(
            "/api/v2/federation/aggregates?tenant_slug={$this->testTenantSlug}",
            ['Accept' => 'application/json']
        );

        $resp->assertStatus(200);
        $this->assertSame($this->testTenantSlug, $resp->json('data.payload.tenant.slug'));

        $this->service->setEnabled($this->testTenantId, false);
        $this->getJson(
            "/api/v2/federation/aggregates?tenant_slug={$this->testTenantSlug}",
            ['Accept' => 'application/json']
        )->assertStatus(404);
    }

    public function test_signature_verifies_with_tenant_secret(): void
    {
        $this->service->setEnabled($this->testTenantId, true);

        $consent = DB::table('federation_aggregate_consents')
            ->where('tenant_id', $this->testTenantId)
            ->first();
        $this->assertNotNull($consent);
        $this->assertNotEmpty($consent->signing_secret);

        $resp = $this->getJson(
            "/api/v2/federation/aggregates?tenant_slug={$this->testTenantSlug}"
        );
        $resp->assertStatus(200);

        $payload   = $resp->json('data.payload');
        $signature = $resp->json('data.signature');

        $expected = $this->service->signPayload($payload, (string) $consent->signing_secret);
        $this->assertSame($expected, $signature);

        // Tamper the payload — signature must NOT verify.
        $tampered = $payload;
        $tampered['hours']['total_approved'] = 999_999.99;
        $tamperedSig = $this->service->signPayload($tampered, (string) $consent->signing_secret);
        $this->assertNotSame($signature, $tamperedSig);
    }

    public function test_member_count_returned_as_bracket_not_raw(): void
    {
        $this->service->setEnabled($this->testTenantId, true);

        $resp = $this->getJson(
            "/api/v2/federation/aggregates?tenant_slug={$this->testTenantSlug}"
        );
        $resp->assertStatus(200);

        $bracket = $resp->json('data.payload.members.bracket');
        $this->assertContains($bracket, ['<50', '50-200', '200-1000', '>1000']);

        // Crucially: there must be no `count` or `total` raw integer field on members.
        $members = $resp->json('data.payload.members');
        $this->assertArrayNotHasKey('count', $members);
        $this->assertArrayNotHasKey('total', $members);
        $this->assertArrayNotHasKey('raw', $members);
    }

    public function test_top_categories_capped_at_10(): void
    {
        TenantContext::setById($this->testTenantId);

        // Compute directly. Even with no data, the response is well-formed.
        $payload = $this->service->compute(
            date('Y-m-d', strtotime('-30 days')),
            date('Y-m-d')
        );

        $byCategory = $payload['hours']['by_category'];
        $this->assertIsArray($byCategory);
        $this->assertLessThanOrEqual(
            10,
            count($byCategory),
            'by_category must be capped at 10 entries.'
        );
    }

    public function test_low_volume_volunteering_and_partner_org_metrics_are_suppressed(): void
    {
        if (!\Illuminate\Support\Facades\Schema::hasTable('vol_logs')) {
            $this->markTestSkipped('vol_logs table is not available.');
        }

        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Aggregate Privacy Tenant',
            'slug' => 'aggregate-privacy-' . substr(uniqid(), -8),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Aggregate Privacy User',
            'email' => 'agg-privacy-' . uniqid('', true) . '@example.test',
            'username' => 'agg_privacy_' . substr(md5(uniqid('', true)), 0, 10),
            'status' => 'active',
            'created_at' => now(),
        ]);

        foreach ([1, 2, 3] as $i) {
            DB::table('vol_logs')->insert([
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'date_logged' => '2040-01-0' . $i,
                'hours' => 1,
                'status' => 'approved',
                'created_at' => now(),
            ]);
        }

        if (\Illuminate\Support\Facades\Schema::hasTable('vol_organizations')) {
            foreach ([1, 2] as $i) {
                DB::table('vol_organizations')->insert([
                    'tenant_id' => $tenantId,
                    'user_id' => $userId,
                    'name' => 'Aggregate Privacy Org ' . $i,
                    'status' => 'approved',
                    'created_at' => now(),
                ]);
            }
        }

        TenantContext::setById($tenantId);
        $payload = $this->service->compute('2040-01-01', '2040-01-31');
        TenantContext::setById($this->testTenantId);

        $this->assertNull($payload['hours']['total_approved']);
        $this->assertTrue($payload['hours']['suppressed']);
        $this->assertSame([], $payload['hours']['by_month']);
        $this->assertSame(5, $payload['privacy']['suppression_threshold']);

        if (\Illuminate\Support\Facades\Schema::hasTable('vol_organizations')) {
            $this->assertNull($payload['partner_orgs']['count']);
            $this->assertTrue($payload['partner_orgs']['suppressed']);
            $this->assertSame('<5', $payload['partner_orgs']['bracket']);
        }
    }

    public function test_query_is_logged_to_audit_trail(): void
    {
        $this->service->setEnabled($this->testTenantId, true);

        $before = DB::table('federation_aggregate_query_log')
            ->where('tenant_id', $this->testTenantId)
            ->count();

        $resp = $this->getJson(
            "/api/v2/federation/aggregates?tenant_slug={$this->testTenantSlug}",
            ['Origin' => 'https://example.test']
        );
        $resp->assertStatus(200);

        $after = DB::table('federation_aggregate_query_log')
            ->where('tenant_id', $this->testTenantId)
            ->count();

        $this->assertGreaterThan($before, $after, 'Audit log entry must be created.');

        $latest = DB::table('federation_aggregate_query_log')
            ->where('tenant_id', $this->testTenantId)
            ->orderByDesc('id')
            ->first();
        $this->assertNotNull($latest);
        $this->assertSame('https://example.test', $latest->requester_origin);
        $this->assertNotEmpty($latest->response_signature);
    }

    public function test_admin_can_toggle_consent_and_rotate_secret(): void
    {
        // Toggle off → on
        $consent = $this->service->setEnabled($this->testTenantId, true);
        $this->assertTrue($consent['enabled']);
        $this->assertTrue($consent['has_secret']);

        $row = DB::table('federation_aggregate_consents')
            ->where('tenant_id', $this->testTenantId)
            ->first();
        $firstSecret = (string) $row->signing_secret;
        $this->assertNotEmpty($firstSecret);

        // Rotate
        $newSecret = $this->service->rotateSecret($this->testTenantId);
        $this->assertNotEmpty($newSecret);
        $this->assertNotSame($firstSecret, $newSecret);

        // Toggle off — keeps secret but flips enabled
        $consent = $this->service->setEnabled($this->testTenantId, false);
        $this->assertFalse($consent['enabled']);
    }

    public function test_pruneOldLogs_deletes_records_older_than_12_months(): void
    {
        // Seed an old entry and a fresh entry for the test tenant.
        DB::table('federation_aggregate_query_log')->insert([
            [
                'tenant_id'          => $this->testTenantId,
                'requester_origin'   => 'old.example',
                'period_from'        => '2024-01-01',
                'period_to'          => '2024-01-31',
                'fields_returned'    => json_encode([]),
                'response_signature' => str_repeat('a', 64),
                'created_at'         => now()->subDays(400),
            ],
            [
                'tenant_id'          => $this->testTenantId,
                'requester_origin'   => 'new.example',
                'period_from'        => '2026-04-01',
                'period_to'          => '2026-04-30',
                'fields_returned'    => json_encode([]),
                'response_signature' => str_repeat('b', 64),
                'created_at'         => now()->subDays(10),
            ],
        ]);

        $deleted = $this->service->pruneOldLogs();
        $this->assertGreaterThanOrEqual(1, $deleted);

        $remaining = DB::table('federation_aggregate_query_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('requester_origin', 'old.example')
            ->count();
        $this->assertSame(0, $remaining);

        $stillThere = DB::table('federation_aggregate_query_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('requester_origin', 'new.example')
            ->count();
        $this->assertSame(1, $stillThere);
    }
}
