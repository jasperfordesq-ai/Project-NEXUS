<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\FederatedConnectionService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Mockery;

class FederatedConnectionServiceTest extends TestCase
{
    private FederatedConnectionService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new FederatedConnectionService();
        DB::shouldReceive('transaction')
            ->zeroOrMoreTimes()
            ->andReturnUsing(static fn (callable $callback) => $callback());

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateCrossTenantContact')
            ->zeroOrMoreTimes()
            ->andReturn($this->allowed());
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }

    // =========================================================================
    // sendRequest()
    // =========================================================================

    public function test_sendRequest_rejects_self_connection(): void
    {
        $result = $this->service->sendRequest(1, 1, 2); // same user, same tenant
        $this->assertFalse($result['success']);
        $this->assertStringContainsString('yourself', $result['error']);
    }

    /**
     * Stub DB::table('federation_partnerships') so FederationPartnershipService::getPartnership()
     * returns an active, profiles-enabled partnership. getPartnership() builds the query with
     * where()->orWhere()->first(), so the chain mock must accept those calls.
     */
    private function stubActivePartnership(): void
    {
        $partnershipQuery = Mockery::mock();
        $partnershipQuery->shouldReceive('where')->andReturnSelf();
        $partnershipQuery->shouldReceive('orWhere')->andReturnSelf();
        $partnershipQuery->shouldReceive('first')->andReturn(
            (object) ['status' => 'active', 'profiles_enabled' => 1]
        );
        DB::shouldReceive('table')->with('federation_partnerships')->andReturn($partnershipQuery);
    }

    /**
     * Stub the DB::table chains used by the post-action notification side-effects
     * (Notification::createNotification → DB::table('users')->where->value + table('notifications')->insertGetId).
     * These run inside try/catch blocks in the service; we let them succeed harmlessly.
     */
    private function stubNotificationSideEffects(): void
    {
        $chain = Mockery::mock();
        $chain->shouldReceive('where')->andReturnSelf();
        $chain->shouldReceive('value')->andReturn(2);
        $chain->shouldReceive('insertGetId')->andReturn(99);
        DB::shouldReceive('table')->with('users')->andReturn($chain);
        DB::shouldReceive('table')->with('notifications')->andReturn($chain);
        DB::shouldReceive('table')->andReturn($chain); // catch-all for any other table()
    }

    public function test_sendRequest_rejects_already_accepted(): void
    {
        // Ordered selectOne sequence: (1) requester active, (2) receiver opted-in, (3) existing connection.
        DB::shouldReceive('selectOne')->once()->ordered()->andReturn((object) ['id' => 1]);
        DB::shouldReceive('selectOne')->once()->ordered()->andReturn(
            (object) ['id' => 2, 'federation_optin' => 1, 'messaging_enabled_federated' => 1]
        );
        $this->stubActivePartnership();
        DB::shouldReceive('selectOne')->once()->ordered()->andReturn((object) ['id' => 1, 'status' => 'accepted']);

        $result = $this->service->sendRequest(1, 2, 3);
        $this->assertFalse($result['success']);
        $this->assertStringContainsString('already exists', $result['error']);
    }

    public function test_sendRequest_rejects_pending_request(): void
    {
        DB::shouldReceive('selectOne')->once()->ordered()->andReturn((object) ['id' => 1]);
        DB::shouldReceive('selectOne')->once()->ordered()->andReturn(
            (object) ['id' => 2, 'federation_optin' => 1, 'messaging_enabled_federated' => 1]
        );
        $this->stubActivePartnership();
        DB::shouldReceive('selectOne')->once()->ordered()->andReturn((object) ['id' => 1, 'status' => 'pending']);

        $result = $this->service->sendRequest(1, 2, 3);
        $this->assertFalse($result['success']);
        $this->assertStringContainsString('already pending', $result['error']);
    }

    public function test_sendRequest_replaces_rejected_request(): void
    {
        DB::shouldReceive('selectOne')->once()->ordered()->andReturn((object) ['id' => 1]);
        DB::shouldReceive('selectOne')->once()->ordered()->andReturn(
            (object) ['id' => 2, 'federation_optin' => 1, 'messaging_enabled_federated' => 1]
        );
        $this->stubActivePartnership();
        DB::shouldReceive('selectOne')->once()->ordered()->andReturn((object) ['id' => 1, 'status' => 'rejected']);
        DB::shouldReceive('delete')->once();
        DB::shouldReceive('insert')->once();
        DB::shouldReceive('getPdo->lastInsertId')->andReturn(5);
        // Post-insert notification lookups (sender, community, receiver locale) — return null;
        // the notification/email side-effects are wrapped in try/catch and log ->warning on failure.
        DB::shouldReceive('selectOne')->andReturn(null);
        $this->stubNotificationSideEffects();
        Log::shouldReceive('info')->once();
        Log::shouldReceive('warning')->zeroOrMoreTimes();

        $result = $this->service->sendRequest(1, 2, 3, 'Hello!');
        $this->assertTrue($result['success']);
        $this->assertEquals(5, $result['connection_id']);
    }

    // =========================================================================
    // acceptRequest()
    // =========================================================================

    public function test_acceptRequest_fails_when_not_found(): void
    {
        DB::shouldReceive('selectOne')->andReturn(null);

        $result = $this->service->acceptRequest(999, 1);
        $this->assertFalse($result['success']);
    }

    public function test_acceptRequest_succeeds(): void
    {
        // Connection must carry requester_* fields used by the post-accept notification block.
        $connection = (object) [
            'id' => 1,
            'status' => 'pending',
            'requester_user_id' => 7,
            'requester_tenant_id' => 3,
        ];
        DB::shouldReceive('selectOne')->andReturn($connection);
        DB::shouldReceive('update')->once();
        $this->stubNotificationSideEffects();
        Log::shouldReceive('info')->once();
        // Cross-tenant notification + email side-effects are wrapped in try/catch logging ->warning.
        Log::shouldReceive('warning')->zeroOrMoreTimes();

        $result = $this->service->acceptRequest(1, 5);
        $this->assertTrue($result['success']);
    }

    public function test_acceptRequest_rechecks_policy_and_leaves_request_pending_when_denied(): void
    {
        $connection = (object) [
            'id' => 1,
            'status' => 'pending',
            'requester_user_id' => 7,
            'requester_tenant_id' => 3,
        ];
        DB::shouldReceive('selectOne')->once()->andReturn($connection);
        DB::shouldReceive('update')->never();

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateCrossTenantContact')
            ->once()
            ->with(7, 3, 5, $this->testTenantId, 'federated_connection_accept')
            ->andReturn($this->denied());
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $result = $this->service->acceptRequest(1, 5);

        $this->assertFalse($result['success']);
        $this->assertSame('VETTING_REQUIRED', $result['error_code']);
        $this->assertFalse($result['retryable']);
    }

    // =========================================================================
    // rejectRequest()
    // =========================================================================

    public function test_rejectRequest_fails_when_not_found(): void
    {
        DB::shouldReceive('selectOne')->andReturn(null);

        $result = $this->service->rejectRequest(999, 1);
        $this->assertFalse($result['success']);
    }

    // =========================================================================
    // removeConnection()
    // =========================================================================

    public function test_removeConnection_fails_when_not_found(): void
    {
        DB::shouldReceive('selectOne')->andReturn(null);

        $result = $this->service->removeConnection(999, 1);
        $this->assertFalse($result['success']);
    }

    public function test_removeConnection_succeeds(): void
    {
        $connection = (object) [
            'id' => 1,
            'status' => 'accepted',
            'requester_user_id' => 5,
            'requester_tenant_id' => $this->testTenantId,
            'receiver_user_id' => 7,
            'receiver_tenant_id' => 3,
        ];
        DB::shouldReceive('selectOne')->andReturn($connection);
        DB::shouldReceive('delete')->once();
        Log::shouldReceive('info')->once();

        $result = $this->service->removeConnection(1, 5);
        $this->assertTrue($result['success']);
    }

    // =========================================================================
    // getStatus()
    // =========================================================================

    public function test_getStatus_returns_none_when_no_connection(): void
    {
        DB::shouldReceive('selectOne')->andReturn(null);

        $result = $this->service->getStatus(1, 2, 3);
        $this->assertEquals('none', $result['status']);
        $this->assertNull($result['connection_id']);
    }

    // =========================================================================
    // getConnections()
    // =========================================================================

    public function test_getConnections_defaults_to_accepted_filter(): void
    {
        DB::shouldReceive('select')->andReturn([]);

        $result = $this->service->getConnections(1, 'invalid_status');
        $this->assertEquals([], $result);
    }

    public function test_getConnections_clamps_limit(): void
    {
        DB::shouldReceive('select')->andReturn([]);

        $result = $this->service->getConnections(1, 'accepted', 500);
        $this->assertEquals([], $result);
    }

    // =========================================================================
    // getPendingCount()
    // =========================================================================

    public function test_getPendingCount_returns_integer(): void
    {
        DB::shouldReceive('selectOne')->andReturn((object) ['cnt' => 3]);

        $this->assertEquals(3, $this->service->getPendingCount(1));
    }

    public function test_getPendingCount_returns_zero_on_error(): void
    {
        DB::shouldReceive('selectOne')->andThrow(new \Exception('DB error'));
        Log::shouldReceive('error')->once();

        $this->assertEquals(0, $this->service->getPendingCount(1));
    }

    private function allowed(): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::ALLOW,
            code: 'SAFEGUARDING_ALLOWED',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
        );
    }

    private function denied(): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::DENY,
            code: 'VETTING_REQUIRED',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
            policyVersion: 'test-v1',
            requiredAttestationCodes: ['dbs_enhanced'],
            requiredAttestationLabels: ['Enhanced DBS'],
            canRequestCoordinator: true,
        );
    }
}
