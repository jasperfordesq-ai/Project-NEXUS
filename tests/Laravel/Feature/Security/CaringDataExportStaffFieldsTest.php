<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-133 — the caring "my data" export must not dump staff-only working fields
 * (investigators' resolution notes, assignees, escalation notes) that the
 * member-facing views deliberately withhold. The member's own content stays.
 */
class CaringDataExportStaffFieldsTest extends TestCase
{
    use DatabaseTransactions;

    private function enableCaring(): void
    {
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

    /** @return array<string,mixed> */
    private function exportFor(User $user): array
    {
        Sanctum::actingAs($user);
        $response = $this->apiGet('/v2/caring-community/me/data-export');
        $response->assertStatus(200);
        $payload = json_decode($response->streamedContent(), true);
        $this->assertIsArray($payload);

        return is_array($payload['data'] ?? null) && isset($payload['data']['profile']) ? $payload['data'] : $payload;
    }

    public function test_export_omits_staff_fields_from_safeguarding_reports_but_keeps_members_own_report(): void
    {
        if (! Schema::hasTable('safeguarding_reports')) {
            $this->markTestSkipped('safeguarding_reports table missing');
        }
        $this->enableCaring();

        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $investigator = User::factory()->forTenant($this->testTenantId)->admin()->create();

        DB::table('safeguarding_reports')->insert([
            'tenant_id' => $this->testTenantId,
            'reporter_user_id' => $member->id,
            'category' => 'other',
            'severity' => 'high',
            'description' => 'My own account of what happened.',
            'status' => 'investigating',
            'assigned_to_user_id' => $investigator->id,
            'escalated' => 1,
            'escalated_at' => now(),
            'resolution_notes' => 'INTERNAL: investigator working notes',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $export = $this->exportFor($member);
        $reports = $export['safeguarding_reports'] ?? null;
        $this->assertIsArray($reports);
        $this->assertCount(1, $reports);
        $report = $reports[0];

        // Control: the member's own submission is present.
        $this->assertSame('My own account of what happened.', $report['description'] ?? null);
        $this->assertSame('investigating', $report['status'] ?? null);
        $this->assertSame('high', $report['severity'] ?? null);

        // Staff-only working fields are withheld.
        $this->assertArrayNotHasKey('resolution_notes', $report);
        $this->assertArrayNotHasKey('assigned_to_user_id', $report);
        $this->assertStringNotContainsString('INTERNAL: investigator working notes', json_encode($export));
    }

    public function test_export_omits_coordinator_fields_from_vol_logs_but_keeps_logged_hours(): void
    {
        if (! Schema::hasTable('vol_logs') || ! Schema::hasColumn('vol_logs', 'escalation_note')) {
            $this->markTestSkipped('vol_logs coordinator columns missing');
        }
        $this->enableCaring();

        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $coordinator = User::factory()->forTenant($this->testTenantId)->admin()->create();

        DB::table('vol_logs')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'date_logged' => now()->toDateString(),
            'hours' => 2.5,
            'description' => 'Shopping run for a neighbour.',
            'status' => 'pending',
            'assigned_to' => $coordinator->id,
            'assigned_at' => now(),
            'escalated_at' => now(),
            'escalation_note' => 'INTERNAL: coordinator escalation note',
            'creation_idempotency_key_hash' => str_repeat('a', 64),
            'creation_request_hash' => str_repeat('b', 64),
            'created_at' => now(),
        ]);

        $export = $this->exportFor($member);
        $logs = $export['vol_logs'] ?? null;
        $this->assertIsArray($logs);
        $this->assertCount(1, $logs);
        $log = $logs[0];

        // Control: the member's own log is present.
        $this->assertSame('Shopping run for a neighbour.', $log['description'] ?? null);
        $this->assertEquals(2.5, (float) ($log['hours'] ?? 0));
        $this->assertSame('pending', $log['status'] ?? null);

        foreach (['assigned_to', 'assigned_at', 'escalated_at', 'escalation_note', 'creation_idempotency_key_hash', 'creation_request_hash'] as $column) {
            $this->assertArrayNotHasKey($column, $log);
        }
        $this->assertStringNotContainsString('INTERNAL: coordinator escalation note', json_encode($export));
    }
}
