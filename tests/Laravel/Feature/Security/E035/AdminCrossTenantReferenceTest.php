<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-035 F-155 — cross-community PII disclosure through admin record references.
 *
 * A community admin could name an account from ANOTHER community as the subject
 * of a GDPR request, CRM task, or deliverable and then read back that account's
 * name / email / avatar (and, for a deliverable, fan a notification out to it).
 * The subject id was inserted without a tenant check, and the display joins had
 * no tenant condition. Both are now closed: the referenced id must belong to the
 * caller's community, and the joins are tenant-scoped so even a historic
 * cross-tenant row discloses nothing.
 */
class AdminCrossTenantReferenceTest extends TestCase
{
    use DatabaseTransactions;

    private const FOREIGN_TENANT = 999;

    private function foreignVictim(): User
    {
        return User::factory()->forTenant(self::FOREIGN_TENANT)->create([
            'email' => 'e035-foreign-' . uniqid() . '@example.test',
            'first_name' => 'Foreign',
            'last_name' => 'Victim',
            'name' => 'Foreign Victim',
        ]);
    }

    private function actingAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        return $admin;
    }

    // ── GDPR requests ────────────────────────────────────────────────────────

    public function test_gdpr_request_cannot_be_raised_for_a_foreign_member(): void
    {
        $victim = $this->foreignVictim();
        $this->actingAdmin();

        $this->apiPost('/v2/admin/enterprise/gdpr/requests', [
            'user_id' => $victim->id,
            'type' => 'access',
        ])->assertStatus(422);

        $this->assertSame(
            0,
            (int) DB::table('gdpr_requests')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $victim->id)
                ->count(),
            'a request row referencing a foreign account must not be created'
        );
    }

    public function test_gdpr_request_show_does_not_leak_a_foreign_members_email(): void
    {
        // A historic row that already references a foreign account (created before
        // the create-time guard existed) must still not disclose the email.
        $victim = $this->foreignVictim();
        $this->actingAdmin();

        $id = (int) DB::table('gdpr_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $victim->id,
            'request_type' => 'access',
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $body = (string) $this->apiGet('/v2/admin/enterprise/gdpr/requests/' . $id)->getContent();
        $this->assertStringNotContainsString($victim->email, $body);
        $this->assertStringNotContainsString('Foreign Victim', $body);
    }

    public function test_gdpr_request_can_be_raised_for_an_own_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $this->actingAdmin();

        $this->apiPost('/v2/admin/enterprise/gdpr/requests', [
            'user_id' => $member->id,
            'type' => 'access',
        ])->assertStatus(201);
    }

    // ── CRM tasks ──────────────────────────────────────────────────────────────

    public function test_crm_task_cannot_reference_a_foreign_member(): void
    {
        $victim = $this->foreignVictim();
        $this->actingAdmin();

        $response = $this->apiPost('/v2/admin/crm/tasks', [
            'title' => 'Follow up',
            'user_id' => $victim->id,
        ]);

        $response->assertStatus(404);
        $body = (string) $response->getContent();
        $this->assertStringNotContainsString('Foreign Victim', $body);
    }

    public function test_crm_task_can_reference_an_own_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $this->actingAdmin();

        $this->apiPost('/v2/admin/crm/tasks', [
            'title' => 'Follow up',
            'user_id' => $member->id,
        ])->assertSuccessful();
    }

    // ── Deliverables ────────────────────────────────────────────────────────────

    public function test_deliverable_cannot_be_assigned_to_a_foreign_member(): void
    {
        $victim = $this->foreignVictim();
        $this->actingAdmin();

        $this->apiPost('/v2/admin/deliverability', [
            'title' => 'Ship it',
            'assigned_to' => $victim->id,
        ])->assertStatus(422);

        $this->assertSame(
            0,
            (int) DB::table('deliverables')
                ->where('tenant_id', $this->testTenantId)
                ->where('assigned_to', $victim->id)
                ->count()
        );
    }

    public function test_deliverable_can_be_assigned_to_an_own_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $this->actingAdmin();

        $this->apiPost('/v2/admin/deliverability', [
            'title' => 'Ship it',
            'assigned_to' => $member->id,
        ])->assertSuccessful();
    }
}
