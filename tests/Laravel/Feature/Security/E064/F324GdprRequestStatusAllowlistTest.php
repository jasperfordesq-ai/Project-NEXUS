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
 * F-324 (E-062 N-2): PUT /v2/admin/enterprise/gdpr/requests/{id} wrote any
 * non-empty `status` straight into `gdpr_requests.status`, an
 * enum('pending','processing','completed','rejected','cancelled'). With the
 * connection's strict mode off, an unknown value is stored as '' — the request
 * then matches neither 'pending' nor 'processing', drops off the
 * gdpr:check-overdue-requests alarm, and nothing is ever actioned, while the
 * endpoint answers 200 echoing the value it was sent.
 *
 * The endpoint must refuse anything outside the column's own enum with 422 and
 * leave the stored status untouched; every real status must still work.
 */
class F324GdprRequestStatusAllowlistTest extends TestCase
{
    use DatabaseTransactions;

    private function erasureRequest(int $subjectId, string $status = 'pending'): int
    {
        return (int) DB::table('gdpr_requests')->insertGetId([
            'user_id' => $subjectId,
            'tenant_id' => $this->testTenantId,
            'request_type' => 'erasure',
            'status' => $status,
            'requested_at' => now()->subDays(40),
            'created_at' => now()->subDays(40),
            'updated_at' => now()->subDays(40),
        ]);
    }

    private function actingAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        return $admin;
    }

    /**
     * @return array<string, array{0: mixed}>
     */
    public static function invalidStatuses(): array
    {
        return [
            'unknown word' => ['closed'],
            'case variant' => ['Rejected'],
            'plausible typo' => ['in_progress'],
            'array' => [['completed']],
            'integer' => [1],
        ];
    }

    /**
     * @dataProvider invalidStatuses
     */
    public function test_a_status_outside_the_column_enum_is_refused_and_nothing_changes(mixed $status): void
    {
        $this->actingAdmin();
        $subject = User::factory()->forTenant($this->testTenantId)->create();
        $requestId = $this->erasureRequest((int) $subject->id);

        $response = $this->apiPut("/v2/admin/enterprise/gdpr/requests/{$requestId}", [
            'status' => $status,
            'notes' => 'should not be written',
        ]);

        $response->assertStatus(422);

        $row = DB::table('gdpr_requests')->where('id', $requestId)->first();
        $this->assertSame('pending', (string) $row->status, 'the request must stay open for the overdue alarm');
        $this->assertNull($row->notes);
        $this->assertNull($row->processed_at);

        // The subject was not erased either.
        $this->assertSame('active', (string) DB::table('users')->where('id', $subject->id)->value('status'));
    }

    public function test_control_real_statuses_are_still_accepted(): void
    {
        $admin = $this->actingAdmin();
        $subject = User::factory()->forTenant($this->testTenantId)->create();

        foreach (['processing', 'rejected', 'cancelled', 'pending'] as $status) {
            $requestId = $this->erasureRequest((int) $subject->id);

            $response = $this->apiPut("/v2/admin/enterprise/gdpr/requests/{$requestId}", [
                'status' => $status,
            ]);

            $response->assertStatus(200);
            $response->assertJsonPath('data.status', $status);
            $this->assertSame($status, (string) DB::table('gdpr_requests')->where('id', $requestId)->value('status'));
        }

        // 'completed' on an access request still records who completed it.
        $accessId = (int) DB::table('gdpr_requests')->insertGetId([
            'user_id' => $subject->id,
            'tenant_id' => $this->testTenantId,
            'request_type' => 'access',
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->apiPut("/v2/admin/enterprise/gdpr/requests/{$accessId}", ['status' => 'completed'])
            ->assertStatus(200);
        $row = DB::table('gdpr_requests')->where('id', $accessId)->first();
        $this->assertSame('completed', (string) $row->status);
        $this->assertSame((int) $admin->id, (int) $row->processed_by);
    }
}
