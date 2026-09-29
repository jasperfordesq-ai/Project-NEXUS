<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E064;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-325 (E-062 N-3): closing a subject-access or erasure request as
 * `rejected` or `cancelled` recorded no actor, no time, no reason and wrote
 * no audit row — `processed_at` / `processed_by` were set only for
 * `completed`. A closed request must say who closed it, when, why (when a
 * reason is given), and leave a gdpr_audit_log entry.
 */
class F325GdprRequestClosureIsRecordedTest extends TestCase
{
    use DatabaseTransactions;

    private function request(int $subjectId, string $type): int
    {
        return (int) DB::table('gdpr_requests')->insertGetId([
            'user_id' => $subjectId,
            'tenant_id' => $this->testTenantId,
            'request_type' => $type,
            'status' => 'pending',
            'requested_at' => now()->subDays(3),
            'created_at' => now()->subDays(3),
            'updated_at' => now()->subDays(3),
        ]);
    }

    private function actingAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        return $admin;
    }

    public function test_rejecting_an_erasure_request_records_actor_time_reason_and_audit(): void
    {
        $admin = $this->actingAdmin();
        $subject = User::factory()->forTenant($this->testTenantId)->create();
        $requestId = $this->request((int) $subject->id, 'erasure');

        $this->apiPut("/v2/admin/enterprise/gdpr/requests/{$requestId}", [
            'status' => 'rejected',
            'notes' => 'Identity could not be confirmed.',
        ])->assertStatus(200);

        $row = DB::table('gdpr_requests')->where('id', $requestId)->first();
        $this->assertSame('rejected', (string) $row->status);
        $this->assertSame((int) $admin->id, (int) $row->processed_by, 'who closed it');
        $this->assertNotNull($row->processed_at, 'when it was closed');
        $this->assertSame('Identity could not be confirmed.', (string) $row->rejection_reason, 'why');

        $audit = DB::table('gdpr_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('entity_type', 'gdpr_request')
            ->where('entity_id', $requestId)
            ->where('action', 'request_rejected')
            ->first();
        $this->assertNotNull($audit, 'a gdpr_audit_log row for the rejection');
        $this->assertSame((int) $admin->id, (int) $audit->admin_id);
        $this->assertSame((int) $subject->id, (int) $audit->user_id);

        // A rejection never erases.
        $this->assertSame('active', (string) DB::table('users')->where('id', $subject->id)->value('status'));
    }

    public function test_cancelling_an_access_request_records_actor_time_and_audit(): void
    {
        $admin = $this->actingAdmin();
        $subject = User::factory()->forTenant($this->testTenantId)->create();
        $requestId = $this->request((int) $subject->id, 'access');

        $this->apiPut("/v2/admin/enterprise/gdpr/requests/{$requestId}", [
            'status' => 'cancelled',
            'reason' => 'Withdrawn by the member by phone.',
        ])->assertStatus(200);

        $row = DB::table('gdpr_requests')->where('id', $requestId)->first();
        $this->assertSame('cancelled', (string) $row->status);
        $this->assertSame((int) $admin->id, (int) $row->processed_by);
        $this->assertNotNull($row->processed_at);
        $this->assertSame('Withdrawn by the member by phone.', (string) $row->rejection_reason);

        $this->assertTrue(DB::table('gdpr_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('entity_type', 'gdpr_request')
            ->where('entity_id', $requestId)
            ->where('action', 'request_cancelled')
            ->where('admin_id', $admin->id)
            ->exists());
    }

    public function test_control_moving_to_processing_does_not_stamp_a_closure(): void
    {
        $this->actingAdmin();
        $subject = User::factory()->forTenant($this->testTenantId)->create();
        $requestId = $this->request((int) $subject->id, 'access');

        $this->apiPut("/v2/admin/enterprise/gdpr/requests/{$requestId}", ['status' => 'processing'])
            ->assertStatus(200);

        $row = DB::table('gdpr_requests')->where('id', $requestId)->first();
        $this->assertSame('processing', (string) $row->status);
        $this->assertNull($row->processed_at);
        $this->assertNull($row->processed_by);
        $this->assertNull($row->rejection_reason);
    }

    public function test_control_another_communitys_request_cannot_be_closed(): void
    {
        $this->actingAdmin();
        $otherTenant = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        $otherSubject = User::factory()->forTenant($otherTenant)->create();
        $requestId = (int) DB::table('gdpr_requests')->insertGetId([
            'user_id' => $otherSubject->id,
            'tenant_id' => $otherTenant,
            'request_type' => 'erasure',
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->apiPut("/v2/admin/enterprise/gdpr/requests/{$requestId}", ['status' => 'rejected']);

        $row = DB::table('gdpr_requests')->where('id', $requestId)->first();
        $this->assertSame('pending', (string) $row->status);
        $this->assertNull($row->processed_by);
        $this->assertFalse(DB::table('gdpr_audit_log')
            ->where('entity_type', 'gdpr_request')
            ->where('entity_id', $requestId)
            ->exists());
    }
}
