<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-035 F-159 — the member who reported a volunteering safeguarding incident
 * must not read the investigators' record of it (action taken, resolution
 * notes, authority referral, assigned lead) through the detail endpoint. The
 * reporter's list view already returns a whitelist; the detail view must match
 * it. Admins keep the full record.
 */
class VolunteerIncidentReporterViewTest extends TestCase
{
    use DatabaseTransactions;

    private const INVESTIGATOR_FIELDS = [
        'action_taken',
        'resolution_notes',
        'authority_notified',
        'authority_reference',
        'assigned_to',
        'assigned_to_name',
        'dlp_user_id',
        'dlp_user_name',
        'dlp_notified_at',
        'subject_user_id',
        'subject_user_name',
        'involved_user_id',
        'involved_user_name',
    ];

    private int $incidentId;
    private User $reporter;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        if (!TenantContext::hasFeature('volunteering')) {
            $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
            $features = json_decode((string) ($row->features ?? '{}'), true) ?: [];
            $features['volunteering'] = true;
            DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
            TenantContext::setById($this->testTenantId);
        }

        $this->reporter = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'member',
        ]);
        $subject = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'name' => 'E035 Subject Person',
        ]);
        $this->admin = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'admin', 'name' => 'E035 Investigator',
        ]);

        // The factory derives name from first/last; pin it for the assertions.
        DB::table('users')->where('id', $subject->id)->update(['name' => 'E035 Subject Person']);
        DB::table('users')->where('id', $this->admin->id)->update(['name' => 'E035 Investigator']);

        $this->incidentId = (int) DB::table('vol_safeguarding_incidents')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'reported_by' => $this->reporter->id,
            'title' => 'E035 incident',
            'subject_user_id' => $subject->id,
            'incident_type' => 'concern',
            'category' => 'general',
            'severity' => 'high',
            'description' => 'A description that is certainly longer than twenty characters.',
            'action_taken' => 'SECRET-ACTION-TAKEN',
            'resolution_notes' => 'SECRET-RESOLUTION-NOTES',
            'assigned_to' => $this->admin->id,
            'authority_notified' => 1,
            'authority_reference' => 'SECRET-AUTH-REF',
            'status' => 'investigating',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_reporter_detail_excludes_investigator_fields(): void
    {
        Sanctum::actingAs($this->reporter, ['*']);
        $response = $this->apiGet("/v2/volunteering/incidents/{$this->incidentId}");

        $response->assertStatus(200);
        $data = $response->json('data');
        $this->assertSame($this->incidentId, (int) $data['id']);
        $this->assertSame('investigating', $data['status']);
        $this->assertSame('E035 incident', $data['title']);

        foreach (self::INVESTIGATOR_FIELDS as $field) {
            $this->assertArrayNotHasKey($field, $data, "reporter detail must not expose {$field}");
        }
        $body = (string) $response->getContent();
        $this->assertStringNotContainsString('SECRET-', $body);
        $this->assertStringNotContainsString('E035 Investigator', $body);
        $this->assertStringNotContainsString('E035 Subject Person', $body);
    }

    public function test_admin_detail_keeps_investigator_fields(): void
    {
        Sanctum::actingAs($this->admin, ['*']);
        $response = $this->apiGet("/v2/volunteering/incidents/{$this->incidentId}");

        $response->assertStatus(200);
        $data = $response->json('data');
        $this->assertSame('SECRET-ACTION-TAKEN', $data['action_taken']);
        $this->assertSame('SECRET-RESOLUTION-NOTES', $data['resolution_notes']);
        $this->assertSame('SECRET-AUTH-REF', $data['authority_reference']);
        $this->assertSame('E035 Investigator', $data['assigned_to_name']);
    }

    public function test_other_member_still_refused(): void
    {
        $other = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'member',
        ]);
        Sanctum::actingAs($other, ['*']);
        $this->apiGet("/v2/volunteering/incidents/{$this->incidentId}")->assertStatus(403);
    }
}
