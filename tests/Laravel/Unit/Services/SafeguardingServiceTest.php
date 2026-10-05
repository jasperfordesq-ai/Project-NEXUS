<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\SafeguardingService;
use App\Models\SafeguardingAssignment;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Mockery;

class SafeguardingServiceTest extends TestCase
{
    private SafeguardingService $service;
    private $mockAssignment;

    protected function setUp(): void
    {
        parent::setUp();
        $this->mockAssignment = Mockery::mock(SafeguardingAssignment::class);
        $this->service = new SafeguardingService($this->mockAssignment);
    }

    // ── createAssignment ──

    public function test_createAssignment_fails_for_same_person(): void
    {
        $result = $this->service->createAssignment(1, 1, 2);
        $this->assertFalse($result['success']);
        $errors = $this->service->getErrors();
        $this->assertEquals('VALIDATION_ERROR', $errors[0]['code']);
    }

    public function test_createAssignment_fails_when_guardian_not_found(): void
    {
        // User::where returns query builder that ->exists() returns false
        $result = $this->service->createAssignment(9999, 9998, 2);
        $this->assertFalse($result['success']);
    }

    // ── recordTraining ──

    public function test_recordTraining_rejects_invalid_type(): void
    {
        $result = $this->service->recordTraining(1, ['training_type' => 'invalid'], $this->testTenantId);
        $this->assertFalse($result);
    }

    public function test_recordTraining_accepts_valid_types(): void
    {
        // recordTraining() guards on activeUserBelongsToTenant() (a real
        // User::where()->exists() Eloquent query that bypasses the DB facade),
        // then inserts a real row. Seed an active user in the test tenant and
        // run against the real DB rather than stubbing the brittle DB chain.
        $userId = $this->seedActiveUser($this->testTenantId);

        $validTypes = ['children_first', 'vulnerable_adults', 'first_aid', 'manual_handling', 'other'];
        foreach ($validTypes as $type) {
            $result = $this->service->recordTraining(
                $userId,
                ['training_type' => $type, 'training_name' => 'Test'],
                $this->testTenantId
            );
            $this->assertIsArray($result, "Valid training type '{$type}' should be accepted");
            $this->assertSame($type, $result['training_type'] ?? null);
        }
    }

    // ── reportIncident ──

    public function test_reportIncident_rejects_invalid_severity(): void
    {
        $result = $this->service->reportIncident(1, ['severity' => 'extreme'], $this->testTenantId);
        $this->assertFalse($result);
    }

    public function test_reportIncident_rejects_invalid_incident_type(): void
    {
        $result = $this->service->reportIncident(1, [
            'severity' => 'high',
            'incident_type' => 'invalid_type',
        ], $this->testTenantId);
        $this->assertFalse($result);
    }

    // ── updateIncident ──

    public function test_updateIncident_with_nothing_to_change_changes_nothing(): void
    {
        // An empty update is a no-op: accepted, and nothing is written —
        // not the row, and not the incident's timeline.
        $staffId = $this->seedActiveUser($this->testTenantId);
        $incidentId = $this->seedIncident($this->testTenantId, $staffId, 'open');

        $result = $this->service->updateIncident($incidentId, [], $staffId, $this->testTenantId);

        $this->assertTrue($result->ok);
        $this->assertSame(0, DB::table('vol_incident_events')->where('incident_id', $incidentId)->count());
    }

    public function test_updateIncident_for_an_unknown_incident_is_not_found(): void
    {
        $result = $this->service->updateIncident(999999999, ['status' => 'investigating'], 1, $this->testTenantId);
        $this->assertTrue($result->notFound);
    }

    public function test_updateIncident_sets_resolved_at_for_closed_status(): void
    {
        // updateIncident() now enforces a status state machine
        // (INCIDENT_STATUS_TRANSITIONS): the current incident must be in a
        // state from which the target status is reachable. 'open' -> 'resolved'
        // is valid. Seed a real open incident and verify the transition + the
        // resolved_at timestamp it sets. The notification side-effects are
        // wrapped in try/catch inside the service so they cannot fail the call.
        $reporterId = $this->seedActiveUser($this->testTenantId);
        $incidentId = $this->seedIncident($this->testTenantId, $reporterId, 'open');

        $result = $this->service->updateIncident(
            $incidentId,
            // Resolving needs a reason since the incident timeline was added.
            ['status' => 'resolved', 'reason' => 'Dealt with by the organisation.'],
            $reporterId,
            $this->testTenantId
        );

        $this->assertTrue($result->ok);

        $row = DB::table('vol_safeguarding_incidents')
            ->where('id', $incidentId)
            ->where('tenant_id', $this->testTenantId)
            ->first();
        $this->assertSame('resolved', $row->status);
        $this->assertNotNull($row->resolved_at);
    }

    // ── getErrors ──

    public function test_getErrors_initially_empty(): void
    {
        $this->assertEquals([], $this->service->getErrors());
    }

    // ── helpers ──

    /**
     * Seed an active user in the given tenant and return its id.
     */
    private function seedActiveUser(int $tenantId): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Safeguarding Test User',
            'first_name' => 'Safeguarding',
            'last_name' => 'User',
            'email' => 'safeguarding-' . uniqid('', true) . '@example.test',
            'role' => 'member',
            'status' => 'active',
            'preferred_language' => 'en',
            'created_at' => now(),
        ]);
    }

    /**
     * Seed a safeguarding incident in the given tenant and return its id.
     */
    private function seedIncident(int $tenantId, int $reporterId, string $status): int
    {
        return (int) DB::table('vol_safeguarding_incidents')->insertGetId([
            'tenant_id' => $tenantId,
            'reported_by' => $reporterId,
            'incident_type' => 'concern',
            'severity' => 'low',
            'description' => 'Test incident',
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
