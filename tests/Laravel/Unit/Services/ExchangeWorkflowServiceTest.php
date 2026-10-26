<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Models\Listing;
use App\Models\User;
use App\Services\ExchangeWorkflowService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class ExchangeWorkflowServiceTest extends TestCase
{
    use DatabaseTransactions;

    // ExchangeWorkflowService uses Eloquent models (ExchangeRequest, Listing, ExchangeHistory)
    // with complex state machine transitions. Best tested as integration tests.

    public function test_status_constants_are_defined(): void
    {
        $this->assertEquals('pending_provider', ExchangeWorkflowService::STATUS_PENDING_PROVIDER);
        $this->assertEquals('pending_broker', ExchangeWorkflowService::STATUS_PENDING_BROKER);
        $this->assertEquals('accepted', ExchangeWorkflowService::STATUS_ACCEPTED);
        $this->assertEquals('in_progress', ExchangeWorkflowService::STATUS_IN_PROGRESS);
        $this->assertEquals('pending_confirmation', ExchangeWorkflowService::STATUS_PENDING_CONFIRMATION);
        $this->assertEquals('completed', ExchangeWorkflowService::STATUS_COMPLETED);
        $this->assertEquals('disputed', ExchangeWorkflowService::STATUS_DISPUTED);
        $this->assertEquals('cancelled', ExchangeWorkflowService::STATUS_CANCELLED);
        $this->assertEquals('expired', ExchangeWorkflowService::STATUS_EXPIRED);
    }

    // The createRequest self-exchange guard, acceptRequest wrong-provider guard, and
    // cancelExchange terminal-status guard need real Eloquent models, so they are
    // covered against the real DB in tests/Laravel/Integration/ExchangeWorkflowTest.php
    // (test_createRequest_returns_null_for_self_exchange,
    //  test_only_provider_can_accept_exchange [API level],
    //  test_cancelExchange_rejects_a_terminal_exchange) — not stubbed here.

    /**
     * A broken community approval setting must hold the exchange for a
     * coordinator, not wave it through (safeguarding gap found 26 Oct 2026).
     */
    public function test_needs_broker_approval_fails_safe_when_the_community_setting_cannot_be_read(): void
    {
        TenantContext::setById($this->testTenantId);
        $broken = \Mockery::mock(\App\Services\BrokerControlConfigService::class);
        $broken->shouldReceive('isExchangeWorkflowEnabled')->andThrow(new \RuntimeException('config table unreadable'));
        $this->app->instance(\App\Services\BrokerControlConfigService::class, $broken);

        $method = new \ReflectionMethod(ExchangeWorkflowService::class, 'needsBrokerApproval');
        $method->setAccessible(true);

        $this->assertTrue($method->invoke(null, 1, 1.0, null, null));
    }

    public function test_getExchange_returns_null_when_not_found(): void
    {
        // Real query against nexus_test: an id that does not exist must resolve to null
        // (exercises the actual tenant-scoped join, not a mocked chain).
        TenantContext::setById($this->testTenantId);
        $this->assertNull(ExchangeWorkflowService::getExchange(999999999));
    }

    public function test_getStatistics_returns_expected_structure(): void
    {
        // Real call: runs the five tenant-scoped count queries against nexus_test.
        TenantContext::setById($this->testTenantId);
        $result = ExchangeWorkflowService::getStatistics(30);

        foreach (['total', 'completed', 'pending_broker', 'cancelled', 'disputed', 'days'] as $key) {
            $this->assertArrayHasKey($key, $result);
        }
        $this->assertIsInt($result['total']);
        $this->assertGreaterThanOrEqual(0, $result['total']);
        $this->assertSame(30, $result['days']);
        // total must be >= each sub-count (they are subsets of all exchanges in the window).
        $this->assertGreaterThanOrEqual($result['completed'], $result['total']);
    }

    public function test_checkComplianceRequirements_returns_empty_for_no_risk_tags(): void
    {
        TenantContext::setById($this->testTenantId);

        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $listing = Listing::factory()->forTenant($this->testTenantId)->offer()->create([
            'user_id' => $owner->id,
        ]);

        // No listing_risk_tags row exists for this listing -> no compliance requirements.
        TenantContext::setById($this->testTenantId);
        $this->assertSame(
            [],
            ExchangeWorkflowService::checkComplianceRequirements((int) $listing->id, (int) $owner->id)
        );
    }

    public function test_checkComplianceRequirements_flags_missing_dbs_vetting(): void
    {
        // A risk tag requiring DBS, against a provider with no verified vetting record,
        // must surface a compliance violation — the real safety guard on the exchange path.
        TenantContext::setById($this->testTenantId);

        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listing = Listing::factory()->forTenant($this->testTenantId)->offer()->create([
            'user_id' => $owner->id,
        ]);

        DB::table('listing_risk_tags')->insert([
            'tenant_id'    => $this->testTenantId,
            'listing_id'   => (int) $listing->id,
            'risk_level'   => 'high',
            'dbs_required' => 1,
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);
        DB::table('tenant_safeguarding_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            [
                'jurisdiction' => 'england_wales',
                'policy_version' => 'safeguarded-contact-v1:listing-test',
                'configured_by' => null,
                'configured_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ],
        );
        app(\App\Services\SafeguardingJurisdictionService::class)->forget($this->testTenantId);

        // Re-pin: the factory creates above drift TenantContext, and the service reads
        // listing_risk_tags scoped to TenantContext::getId() — it must match the row's tenant.
        TenantContext::setById($this->testTenantId);
        $violations = ExchangeWorkflowService::checkComplianceRequirements((int) $listing->id, (int) $provider->id);

        $this->assertCount(1, $violations, 'A DBS-required listing with an unvetted provider must flag exactly one violation');
        $this->assertStringContainsString('DBS', $violations[0]);
    }
}
